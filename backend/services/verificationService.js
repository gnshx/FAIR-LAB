const { getDb } = require('../db/database');
const { calculateHoursDemandScore } = require('./fairnessEngine');
const { invalidateAvailabilityCache } = require('./availabilityService');
const { parseTimeToMinutes } = require('../db/seed');

/**
 * Validates a pass token presented to the watchman
 */
function verifyToken(rawInput) {
  const db = getDb();
  let queryTarget = rawInput ? rawInput.trim() : '';

  if (queryTarget.startsWith('{') && queryTarget.endsWith('}')) {
    try {
      const parsed = JSON.parse(queryTarget);
      queryTarget = parsed.token || parsed.bookingId || queryTarget;
    } catch (e) {
      // ignore, use as raw
    }
  }

  const pass = db.prepare(`
    SELECT p.*, b.status as booking_status, b.machine_id, b.slot_id, b.semester_id,
           b.booking_date, b.duration_minutes, b.demand_level, b.demand_ratio,
           u.name as student_name, u.roll_no, u.department, u.avatar_url,
           COALESCE(s.slot_name, 'Custom Window') as slot_name,
           COALESCE(b.start_time, s.start_time) as start_time,
           COALESCE(b.end_time, s.end_time) as end_time,
           w.block_code, w.row_num, w.seat_num, w.display_label, w.status as machine_status,
           br.compute_purpose, br.research_field
    FROM access_passes p
    JOIN bookings b ON p.booking_id = b.booking_id
    JOIN users u ON p.user_id = u.user_id
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    JOIN workstations w ON b.machine_id = w.machine_id
    LEFT JOIN booking_requests br ON b.request_id = br.request_id
    WHERE p.signed_token = ?
       OR p.booking_id = ?
       OR u.roll_no = ?
       OR p.token_hash LIKE ?
    ORDER BY p.issued_at DESC
    LIMIT 1
  `).get(queryTarget, queryTarget, queryTarget, `%${queryTarget}%`);

  if (!pass) {
    return {
      authorized: false,
      code: 'TOKEN_NOT_FOUND',
      message: 'Token not found or unrecognized institute credentials'
    };
  }

  if (pass.status === 'CHECKED_IN') {
    return {
      authorized: false,
      code: 'ALREADY_CHECKED_IN',
      message: 'Pass already checked in at turnstile. Re-entry requires supervisor clearance.',
      pass,
      student: { name: pass.student_name, roll_no: pass.roll_no, department: pass.department, avatar: pass.avatar_url },
      workstation: {
        machine_id: pass.machine_id,
        display_label: pass.display_label || pass.machine_id,
        block_code: pass.block_code || 'A',
        row_num: pass.row_num || 1,
        seat_num: pass.seat_num || 1
      },
      slot: { name: pass.slot_name, time: `${pass.start_time} – ${pass.end_time}`, date: pass.booking_date, demandLevel: pass.demand_level || 'NORMAL' }
    };
  }

  if (pass.status === 'USED') {
    return {
      authorized: false,
      code: 'ALREADY_USED',
      message: 'This session has already ended and student checked out.',
      pass,
      student: { name: pass.student_name, roll_no: pass.roll_no, department: pass.department, avatar: pass.avatar_url }
    };
  }

  if (pass.status === 'REVOKED' || pass.booking_status === 'CANCELLED') {
    return {
      authorized: false,
      code: 'BOOKING_CANCELLED',
      message: 'Booking was cancelled or revoked by administrator.',
      pass,
      student: { name: pass.student_name, roll_no: pass.roll_no, department: pass.department, avatar: pass.avatar_url }
    };
  }

  const now = new Date();
  if (pass.status === 'EXPIRED' || new Date(pass.expires_at) < now) {
    return {
      authorized: false,
      code: 'PASS_EXPIRED',
      message: 'Pass has expired. Request renewed laboratory slot authorization.',
      pass,
      student: { name: pass.student_name, roll_no: pass.roll_no, department: pass.department, avatar: pass.avatar_url }
    };
  }

  return {
    authorized: true,
    code: 'ENTRY_AUTHORIZED',
    message: 'ENTRY AUTHORIZED · ACCESS GRANTED',
    pass,
    student: {
      user_id: pass.user_id,
      name: pass.student_name,
      roll_no: pass.roll_no,
      department: pass.department,
      avatar: pass.avatar_url
    },
    workstation: {
      machine_id: pass.machine_id,
      display_label: pass.display_label || pass.machine_id,
      block_code: pass.block_code || 'A',
      row_num: pass.row_num || 1,
      seat_num: pass.seat_num || 1
    },
    slot: {
      name: pass.slot_name,
      time: `${pass.start_time} – ${pass.end_time}`,
      date: pass.booking_date,
      durationMinutes: pass.duration_minutes || 60,
      demandLevel: pass.demand_level || 'NORMAL'
    },
    purpose: pass.compute_purpose || 'Academic Lab Session'
  };
}

/**
 * Confirms physical check-in at gate
 */
function recordCheckIn(passId, operatorId = 'usr-watchman-ram', notes = 'Turnstile opened') {
  const db = getDb();

  const tx = db.transaction(() => {
    const pass = db.prepare(`
      SELECT p.*, b.machine_id, b.slot_id, b.user_id, b.semester_id, b.status as booking_status, u.name, u.roll_no
      FROM access_passes p
      JOIN bookings b ON p.booking_id = b.booking_id
      JOIN users u ON b.user_id = u.user_id
      WHERE p.pass_id = ?
    `).get(passId);

    if (!pass) throw new Error('Pass not found');
    if (pass.status === 'CHECKED_IN') throw new Error('Pass already checked in');
    if (pass.status !== 'VALID') throw new Error(`Cannot check in pass with status "${pass.status}"`);
    if (pass.booking_status !== 'CONFIRMED') throw new Error(`Cannot check in booking with status "${pass.booking_status}"`);
    if (new Date(pass.expires_at) < new Date()) throw new Error('Pass has expired and cannot be checked in');

    db.prepare("UPDATE access_passes SET status = 'CHECKED_IN' WHERE pass_id = ?").run(passId);
    db.prepare("UPDATE bookings SET status = 'CHECKED_IN' WHERE booking_id = ?").run(pass.booking_id);

    db.prepare(`
      UPDATE workstations
      SET status = 'OCCUPIED', current_user_id = ?, active_job = 'Active Lab Session (Verified Entry)'
      WHERE machine_id = ?
    `).run(pass.user_id, pass.machine_id);

    // Reset cumulative wait upon successful entry
    db.prepare(`
      UPDATE student_fairness
      SET cumulative_wait_seconds = 0, updated_at = datetime('now')
      WHERE user_id = ? AND semester_id = ?
    `).run(pass.user_id, pass.semester_id);

    const entryId = `entry-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO entry_logs (entry_id, pass_id, booking_id, user_id, checked_by, check_in_time, gate_node, status, notes)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 'Edge Node Alpha', 'AUTHORIZED', ?)
    `).run(entryId, passId, pass.booking_id, pass.user_id, operatorId, notes);

    return {
      entryId,
      passId,
      bookingId: pass.booking_id,
      machineId: pass.machine_id,
      studentName: pass.name,
      status: 'CHECKED_IN',
      timestamp: new Date().toISOString()
    };
  });

  const res = tx();
  invalidateAvailabilityCache();
  return res;
}

/**
 * Confirms physical check-out and applies hours-based + high-demand fairness score deduction:
 *   P_u = max(minFloor, round(BaseScore - deductionPerHour * T_u - highDemandDeductionPerHour * T_{H,u} - Penalties))
 */
function recordCheckOut(bookingOrPassId, operatorId = 'usr-watchman-ram', notes = 'Session concluded cleanly') {
  const db = getDb();

  const tx = db.transaction(() => {
    const booking = db.prepare(`
      SELECT b.*, p.pass_id, u.name, u.roll_no,
             COALESCE(b.start_time, s.start_time) as start_time,
             COALESCE(b.end_time, s.end_time) as end_time,
             s.duration_minutes as slot_duration,
             sf.current_score, sf.booking_count, sf.total_hours_used,
             sf.high_demand_count, sf.high_demand_hours, sf.penalty_points
      FROM bookings b
      LEFT JOIN access_passes p ON b.booking_id = p.booking_id
      JOIN users u ON b.user_id = u.user_id
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      LEFT JOIN student_fairness sf ON (b.user_id = sf.user_id AND b.semester_id = sf.semester_id)
      WHERE b.booking_id = ? OR p.pass_id = ?
    `).get(bookingOrPassId, bookingOrPassId);

    if (!booking) throw new Error('Booking not found');
    if (booking.status === 'COMPLETED') throw new Error('Booking has already been checked out and completed (duplicate check-out blocked)');
    if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
      throw new Error(`Cannot check out booking with status "${booking.status}"`);
    }

    const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
      base_score: 100,
      min_priority_floor: 10,
      deduction_per_hour: 5.0,
      high_demand_deduction_per_hour: 10.0
    };

    if (booking.pass_id) {
      db.prepare("UPDATE access_passes SET status = 'USED' WHERE pass_id = ?").run(booking.pass_id);
    }

    db.prepare("UPDATE bookings SET status = 'COMPLETED' WHERE booking_id = ?").run(booking.booking_id);

    // Free workstation if no other active booking today
    const otherActive = db.prepare(`
      SELECT booking_id FROM bookings
      WHERE machine_id = ? AND booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN') AND booking_id != ?
      LIMIT 1
    `).get(booking.machine_id, booking.booking_date, booking.booking_id);

    if (!otherActive) {
      db.prepare(`
        UPDATE workstations
        SET status = CASE WHEN status = 'MAINTENANCE' THEN 'MAINTENANCE' ELSE 'AVAILABLE' END,
            current_user_id = NULL, active_job = NULL
        WHERE machine_id = ?
      `).run(booking.machine_id);
    }

    db.prepare(`
      UPDATE entry_logs
      SET check_out_time = datetime('now'), status = 'CHECKED_OUT', notes = ?
      WHERE booking_id = ? AND check_out_time IS NULL
    `).run(notes, booking.booking_id);

    // Calculate duration in hours from booking / slot
    const durationMinutes = Number(booking.duration_minutes)
      || Number(booking.slot_duration)
      || Math.max(30, parseTimeToMinutes(booking.end_time) - parseTimeToMinutes(booking.start_time))
      || 60;
    const durationHours = parseFloat((durationMinutes / 60).toFixed(2));
    const isHighDemand = (booking.demand_level === 'HIGH_DEMAND');

    const newBookingCount = (Number(booking.booking_count) || 0) + 1;
    const newTotalHours = parseFloat(((Number(booking.total_hours_used) || 0) + durationHours).toFixed(2));
    const newHighDemandCount = (Number(booking.high_demand_count) || 0) + (isHighDemand ? 1 : 0);
    const newHighDemandHours = parseFloat(((Number(booking.high_demand_hours) || 0) + (isHighDemand ? durationHours : 0)).toFixed(2));

    const scoreBefore = booking.current_score != null ? booking.current_score : policy.base_score;
    const scoreAfter = calculateHoursDemandScore({
      baseScore: policy.base_score || 100,
      minFloor: policy.min_priority_floor || 10,
      totalHoursUsed: newTotalHours,
      highDemandHours: newHighDemandHours,
      deductionPerHour: Number(policy.deduction_per_hour) || 5.0,
      highDemandDeductionPerHour: Number(policy.high_demand_deduction_per_hour) || 10.0,
      penaltyPoints: Number(booking.penalty_points) || 0
    });

    db.prepare(`
      UPDATE student_fairness
      SET booking_count = ?,
          total_hours_used = ?,
          high_demand_count = ?,
          high_demand_hours = ?,
          current_score = ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND semester_id = ?
    `).run(
      newBookingCount,
      newTotalHours,
      newHighDemandCount,
      newHighDemandHours,
      scoreAfter,
      booking.user_id,
      booking.semester_id
    );

    const deduction = Math.max(0, scoreBefore - scoreAfter);
    const allocId = `alloc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO allocation_history (
        allocation_id, user_id, semester_id, booking_id, machine_id, slot_id,
        demand_level, demand_ratio, duration_hours, completed, score_before, score_after, reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      allocId,
      booking.user_id,
      booking.semester_id,
      booking.booking_id,
      booking.machine_id,
      booking.slot_id,
      booking.demand_level || 'NORMAL',
      booking.demand_ratio || 0,
      durationHours,
      scoreBefore,
      scoreAfter,
      `Completed ${durationHours}h ${booking.demand_level || 'NORMAL'} session on ${booking.machine_id}. -${deduction} pts applied.`
    );

    return {
      bookingId: booking.booking_id,
      machineId: booking.machine_id,
      studentName: booking.name,
      durationHours,
      demandLevel: booking.demand_level || 'NORMAL',
      scoreBefore,
      scoreAfter,
      deduction,
      totalCompletedBookings: newBookingCount,
      totalHoursUsed: newTotalHours,
      highDemandCount: newHighDemandCount,
      highDemandHours: newHighDemandHours,
      status: 'COMPLETED'
    };
  });

  const res = tx();
  invalidateAvailabilityCache();
  return res;
}

/**
 * Returns today's activity stream
 */
function getGateActivityLog(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT el.*, u.name as student_name, u.roll_no, u.department, u.avatar_url,
           b.machine_id, b.demand_level, b.duration_minutes, s.slot_name,
           w.display_label, w.block_code
    FROM entry_logs el
    JOIN users u ON el.user_id = u.user_id
    LEFT JOIN bookings b ON el.booking_id = b.booking_id
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    LEFT JOIN workstations w ON b.machine_id = w.machine_id
    ORDER BY el.check_in_time DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  verifyToken,
  recordCheckIn,
  recordCheckOut,
  getGateActivityLog
};
