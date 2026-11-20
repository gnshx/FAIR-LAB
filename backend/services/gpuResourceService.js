const crypto = require('crypto');
const { getDb } = require('../db/database');
const { invalidateAvailabilityCache } = require('./availabilityService');

/**
 * Retrieves all 84 physical workstations in L-106 grouped by Block A (6x10) and Block B (4x6).
 */
function getWorkstations(labId = 'lab-l106') {
  const db = getDb();
  return db.prepare(`
    SELECT w.machine_id, w.lab_id, w.block_code, w.row_num, w.seat_num, w.block_seat_num, w.display_label,
           w.status, w.active_job, w.current_user_id, w.gpu_model, w.vram_gb, w.ram_gb, w.cpu_model,
           u.name as current_user_name, u.roll_no as current_user_roll,
           b.booking_id, b.slot_id, b.booking_date, s.slot_name, s.start_time, s.end_time
    FROM workstations w
    LEFT JOIN users u ON w.current_user_id = u.user_id
    LEFT JOIN bookings b ON b.booking_id = (
      SELECT b2.booking_id FROM bookings b2
      WHERE b2.machine_id = w.machine_id AND b2.status IN ('CONFIRMED', 'CHECKED_IN')
      ORDER BY b2.booked_at DESC LIMIT 1
    )
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    WHERE w.lab_id = ?
    ORDER BY w.block_code ASC, w.row_num ASC, w.seat_num ASC, w.machine_id ASC
  `).all(labId);
}

/**
 * Toggles maintenance status on a workstation.
 * When a workstation goes OFFLINE/MAINTENANCE, any upcoming CONFIRMED bookings on it are
 * atomically reallocated to an available replacement workstation for the exact same slot & date
 * (or returned to QUEUED waitlist with priority preserved if lab is at 100% capacity).
 */
function toggleWorkstationMaintenance(machineId, isMaintenance, actorId = 'usr-admin-sharma', actorName = 'Lab Coordinator') {
  const db = getDb();

  const tx = db.transaction(() => {
    const current = db.prepare('SELECT * FROM workstations WHERE machine_id = ? OR display_label = ? LIMIT 1').get(machineId, machineId);
    if (!current) throw new Error(`Workstation "${machineId}" not found`);

    const targetMachineId = current.machine_id;
    const newStatus = isMaintenance ? 'MAINTENANCE' : 'AVAILABLE';
    const activeJob = isMaintenance ? 'Offline for Maintenance' : null;

    db.prepare(`
      UPDATE workstations
      SET status = ?, active_job = ?, current_user_id = CASE WHEN ? = 'MAINTENANCE' THEN NULL ELSE current_user_id END
      WHERE machine_id = ?
    `).run(newStatus, activeJob, newStatus, targetMachineId);

    const reallocated = [];
    const waitlisted = [];

    if (isMaintenance) {
      // Find upcoming CONFIRMED bookings on this offline machine
      const impacted = db.prepare(`
        SELECT b.*, s.start_time, s.end_time, s.lab_id
        FROM bookings b
        JOIN lab_slots s ON b.slot_id = s.slot_id
        WHERE b.machine_id = ? AND b.status = 'CONFIRMED'
      `).all(targetMachineId);

      for (const b of impacted) {
        // Find a replacement workstation free for the same slot/overlapping time & date (prefer same block)
        const replacement = db.prepare(`
          SELECT w.* FROM workstations w
          WHERE w.lab_id = ?
            AND w.machine_id != ?
            AND w.status != 'MAINTENANCE'
            AND w.machine_id NOT IN (
              SELECT b2.machine_id FROM bookings b2
              JOIN lab_slots s2 ON b2.slot_id = s2.slot_id
              WHERE b2.booking_date = ?
                AND b2.status IN ('CONFIRMED', 'CHECKED_IN')
                AND (b2.slot_id = ? OR (s2.start_time < ? AND s2.end_time > ?))
            )
          ORDER BY CASE WHEN w.block_code = ? THEN 0 ELSE 1 END, w.block_code ASC, w.row_num ASC, w.seat_num ASC
          LIMIT 1
        `).get(b.lab_id, targetMachineId, b.booking_date, b.slot_id, b.end_time, b.start_time, current.block_code || 'A');

        if (replacement) {
          db.prepare('UPDATE bookings SET machine_id = ? WHERE booking_id = ?').run(replacement.machine_id, b.booking_id);
          db.prepare(`
            UPDATE workstations SET status = 'BOOKED', current_user_id = ?, active_job = ?
            WHERE machine_id = ? AND status = 'AVAILABLE'
          `).run(b.user_id, `Reallocated from ${targetMachineId}`, replacement.machine_id);

          reallocated.push({
            bookingId: b.booking_id,
            userId: b.user_id,
            slotId: b.slot_id,
            bookingDate: b.booking_date,
            fromMachineId: targetMachineId,
            toMachineId: replacement.machine_id
          });

          db.prepare(`
            INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
            VALUES (?, ?, ?, 'admin', 'OFFLINE_REALLOCATION', 'bookings', ?, ?)
          `).run(
            `audit-realloc-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            actorId,
            actorName,
            b.booking_id,
            `Automatically reallocated booking from offline ${targetMachineId} to ${replacement.machine_id} for slot ${b.slot_id} (${b.booking_date}).`
          );

          db.prepare(`
            INSERT INTO notifications (notification_id, user_id, type, title, message)
            VALUES (?, ?, 'WORKSTATION_REALLOCATED', ?, ?)
          `).run(
            `notif-realloc-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            b.user_id,
            `Workstation Reallocated: ${replacement.display_label || replacement.machine_id}`,
            `Your booking for ${b.booking_date} (${b.start_time || '10:00'}–${b.end_time || '11:00'}) was automatically moved from ${current.display_label || targetMachineId} (offline for maintenance) to ${replacement.display_label || replacement.machine_id}.`
          );
        } else {
          // Lab 100% full: cancel booking with 0 penalty and return request to top of queue
          db.prepare("UPDATE bookings SET status = 'CANCELLED', cancelled_at = datetime('now') WHERE booking_id = ?").run(b.booking_id);
          db.prepare("UPDATE access_passes SET status = 'REVOKED' WHERE booking_id = ?").run(b.booking_id);
          if (b.request_id) {
            db.prepare("UPDATE booking_requests SET status = 'QUEUED', wait_time_seconds = wait_time_seconds + 3600 WHERE request_id = ?").run(b.request_id);
          }
          db.prepare(`
            INSERT INTO notifications (notification_id, user_id, type, title, message)
            VALUES (?, ?, 'BOOKING_CANCELLED', ?, ?)
          `).run(
            `notif-realloc-cancel-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            b.user_id,
            `Reservation Cancelled: Workstation Offline`,
            `Your booking on ${current.display_label || targetMachineId} for ${b.booking_date} was cancelled because all replacement workstations are fully occupied. You have been placed at the top of the queue with 0 penalty.`
          );
          waitlisted.push({ bookingId: b.booking_id, userId: b.user_id, slotId: b.slot_id });
        }
      }
    }

    // Update lab active_nodes count
    const onlineCnt = db.prepare("SELECT COUNT(*) as c FROM workstations WHERE lab_id = ? AND status != 'MAINTENANCE'").get(current.lab_id).c;
    db.prepare('UPDATE labs SET active_nodes = ? WHERE lab_id = ?').run(onlineCnt, current.lab_id);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'admin', 'MAINTENANCE_TOGGLE', 'workstations', ?, ?)
    `).run(
      `audit-${Date.now()}-${crypto.randomUUID()}`,
      actorId,
      actorName,
      targetMachineId,
      `Workstation ${current.display_label || targetMachineId} (${targetMachineId}) status changed from ${current.status} to ${newStatus}. Reallocated: ${reallocated.length}, Waitlisted: ${waitlisted.length}.`
    );

    // Cross-replica transactional outbox events
    const eventId = `evt-ws-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    db.prepare(`
      INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload, status)
      VALUES (?, 'workstation.status_changed', ?, ?, 'PENDING')
    `).run(
      eventId,
      targetMachineId,
      JSON.stringify({
        eventId,
        machineId: targetMachineId,
        display_label: current.display_label,
        isMaintenance,
        status: newStatus,
        hardware_state: isMaintenance ? 'MAINTENANCE' : 'ONLINE',
        reallocatedCount: reallocated.length,
        timestamp: new Date().toISOString()
      })
    );

    const slotEventId = `evt-slot-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    db.prepare(`
      INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload, status)
      VALUES (?, 'SLOT_UPDATED', ?, ?, 'PENDING')
    `).run(
      slotEventId,
      targetMachineId,
      JSON.stringify({
        eventId: slotEventId,
        type: 'WORKSTATION_MAINTENANCE',
        machineId: targetMachineId,
        display_label: current.display_label,
        isMaintenance,
        status: newStatus,
        timestamp: new Date().toISOString()
      })
    );

    return {
      machineId: targetMachineId,
      display_label: current.display_label,
      previousStatus: current.status,
      newStatus,
      reallocatedCount: reallocated.length,
      reallocated,
      waitlistedCount: waitlisted.length
    };
  });

  const res = tx();
  invalidateAvailabilityCache();
  return res;
}

module.exports = {
  getWorkstations,
  toggleWorkstationMaintenance
};
