const { getDb } = require('../db/database');
const { classifySlotDemand } = require('./fairnessEngine');
const { generateSlotsFromSchedule, parseTimeToMinutes, getTodayDateString } = require('../db/seed');
const { getEffectiveDaySchedule, checkIntervalScheduleStatus } = require('./scheduleService');

// Short-TTL in-memory cache + monotonic version counter for WebSocket event ordering
const availabilityCache = new Map();
const CACHE_TTL_MS = 5000;
let stateVersion = 1;

function invalidateAvailabilityCache() {
  availabilityCache.clear();
  stateVersion += 1;
  return stateVersion;
}

function getStateVersion() {
  return stateVersion;
}

function getCache(key) {
  const entry = availabilityCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    availabilityCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  availabilityCache.set(key, { value, ts: Date.now() });
}

function getOccupancyBand(occupancyPct, isMaintenance) {
  if (isMaintenance) return 'OFFLINE';
  if (occupancyPct >= 100) return 'FULL';
  if (occupancyPct >= 71) return 'HIGH';
  if (occupancyPct >= 50) return 'MEDIUM';
  return 'LOW';
}

function getSlotDurationMinutes(slot) {
  if (slot.duration_minutes && Number(slot.duration_minutes) > 0) {
    return Number(slot.duration_minutes);
  }
  const diff = parseTimeToMinutes(slot.end_time) - parseTimeToMinutes(slot.start_time);
  return diff > 0 ? diff : 60;
}

/**
 * Strictly validates that a YYYY-MM-DD string represents a real calendar date
 * (rejects impossible dates like 2026-02-31 or 2026-13-01).
 */
function isValidCalendarDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Parses either HH:MM or ISO-8601 datetime string (e.g. 2026-11-20T10:30:00+05:30)
 * into { date: 'YYYY-MM-DD' | null, time: 'HH:MM' }
 */
function parseTimeInput(raw) {
  if (!raw) return { date: null, time: null };
  const str = String(raw).trim();
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (isoMatch) {
    return { date: isoMatch[1], time: isoMatch[2] };
  }
  const hhmmMatch = str.match(/^(\d{2}:\d{2})/);
  if (hhmmMatch) {
    return { date: null, time: hhmmMatch[1] };
  }
  return { date: null, time: null };
}

/**
 * Resolves either machine_id ('L106-PC-05') or permanent display_label ('A-R1-PC05')
 */
function resolveWorkstation(identifier) {
  if (!identifier) return null;
  const db = getDb();
  return db.prepare(`
    SELECT * FROM workstations WHERE machine_id = ? OR display_label = ? LIMIT 1
  `).get(identifier, identifier);
}

/**
 * Validates a custom half-open time interval [start, end) against lab hours & duration limits
 */
function validateCustomInterval(startTime, endTime, policy) {
  const openTime = (policy && policy.lab_open_time) || '09:00';
  const closeTime = (policy && policy.lab_close_time) || '18:00';
  const minDur = Number(policy && policy.min_duration_minutes) || 30;
  const maxDur = Math.min(120, Number(policy && policy.max_duration_minutes) || 120);

  const sMin = parseTimeToMinutes(startTime);
  const eMin = parseTimeToMinutes(endTime);
  const openMin = parseTimeToMinutes(openTime);
  const closeMin = parseTimeToMinutes(closeTime);

  if (eMin <= sMin) {
    throw new Error(`Invalid interval: end time (${endTime}) must be after start time (${startTime}).`);
  }
  if (sMin < openMin || eMin > closeMin) {
    throw new Error(`Interval ${startTime}–${endTime} is outside Lab L-106 operating hours (${openTime}–${closeTime}).`);
  }
  const durationMinutes = eMin - sMin;
  if (durationMinutes < minDur) {
    throw new Error(`Interval duration (${durationMinutes}m) is shorter than the minimum allowed (${minDur}m).`);
  }
  if (durationMinutes > maxDur) {
    throw new Error(`Interval duration (${durationMinutes}m) exceeds the maximum single-booking limit (${maxDur}m).`);
  }

  return { startTime, endTime, durationMinutes };
}

/**
 * Synchronizes active lab_slots whenever admin updates lab_open_time, lab_close_time, or slot_interval_minutes.
 */
function syncLabSlotsFromPolicy(labId = 'lab-l106') {
  const db = getDb();
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    lab_open_time: '09:00',
    lab_close_time: '18:00',
    slot_interval_minutes: 60
  };

  const lab = db.prepare('SELECT * FROM labs WHERE lab_id = ?').get(labId);
  const capacity = lab ? lab.total_nodes : 84;
  const generated = generateSlotsFromSchedule(
    policy.lab_open_time || '09:00',
    policy.lab_close_time || '18:00',
    policy.slot_interval_minutes || 60
  );

  const tx = db.transaction(() => {
    db.prepare('UPDATE lab_slots SET is_active = 0 WHERE lab_id = ?').run(labId);

    const upsertSlot = db.prepare(`
      INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, duration_minutes, capacity, round_number, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(slot_id) DO UPDATE SET
        slot_name = excluded.slot_name,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        duration_minutes = excluded.duration_minutes,
        capacity = excluded.capacity,
        round_number = excluded.round_number,
        is_active = 1
    `);

    for (const s of generated) {
      upsertSlot.run(s.id, labId, s.name, s.start, s.end, s.durationMinutes, capacity, s.round);
    }
  });

  tx();
  invalidateAvailabilityCache();
  return db.prepare('SELECT * FROM lab_slots WHERE lab_id = ? AND is_active = 1 ORDER BY round_number ASC').all(labId);
}

/**
 * Returns complete interval-based availability + daily occupancy map for all 84 workstations.
 * Supports BOTH preset slotId AND arbitrary custom half-open intervals [start, end) (e.g. 10:30 to 12:15)!
 */
function getLabAvailability(labId = 'lab-l106', dateStr = null, slotId = null, rawStart = null, rawEnd = null) {
  const parsedStart = parseTimeInput(rawStart);
  const parsedEnd = parseTimeInput(rawEnd);
  const targetDate = dateStr || parsedStart.date || getTodayDateString();
  if (!isValidCalendarDate(targetDate)) {
    throw new Error(`Invalid calendar date "${targetDate}". Expected a real YYYY-MM-DD date.`);
  }
  const customStart = parsedStart.time;
  const customEnd = parsedEnd.time;

  const cacheKey = `lab:${labId}:${targetDate}:${slotId || ''}:${customStart || ''}:${customEnd || ''}`;
  const cached = getCache(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const db = getDb();

  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    policy_version: 'fairlab-v2',
    lab_open_time: '09:00',
    lab_close_time: '18:00',
    slot_interval_minutes: 60,
    min_duration_minutes: 30,
    max_duration_minutes: 240,
    cutoff_minutes_before_start: 15,
    max_preferences_per_request: 3,
    max_daily_hours: 2.0,
    max_daily_bookings: 2,
    high_demand_threshold: 1.5,
    deduction_per_hour: 5.0,
    high_demand_deduction_per_hour: 0.0,
    min_priority_floor: 10
  };

  const lab = db.prepare('SELECT * FROM labs WHERE lab_id = ?').get(labId) || {
    lab_id: labId,
    name: 'Computer Lab L-106',
    code: 'L-106',
    location: 'Academic Block 1, Ground Floor',
    total_nodes: 84
  };

  const activeSlots = db.prepare(`
    SELECT * FROM lab_slots
    WHERE lab_id = ? AND is_active = 1
    ORDER BY round_number ASC
  `).all(labId);

  // Effective day schedule (Holidays, Extra Days, Mon–Fri Academic Timetable, Ticket Releases)
  const daySchedule = getEffectiveDaySchedule(labId, targetDate, policy);
  const effectivePolicy = {
    ...policy,
    lab_open_time: daySchedule.openTime,
    lab_close_time: daySchedule.closeTime,
    max_duration_minutes: Math.min(120, Number(policy.max_duration_minutes) || 120)
  };

  // Determine target [start, end) interval
  let selectedSlot = null;
  let isCustomInterval = false;

  if (customStart && customEnd) {
    const validated = validateCustomInterval(customStart, customEnd, effectivePolicy);
    const exactMatch = activeSlots.find(s => s.start_time === validated.startTime && s.end_time === validated.endTime);
    if (exactMatch) {
      selectedSlot = exactMatch;
    } else {
      isCustomInterval = true;
      selectedSlot = {
        slot_id: null,
        slot_name: `Custom Window (${validated.startTime} – ${validated.endTime})`,
        start_time: validated.startTime,
        end_time: validated.endTime,
        duration_minutes: validated.durationMinutes
      };
    }
  } else if (slotId) {
    selectedSlot = activeSlots.find(s => s.slot_id === slotId) || db.prepare('SELECT * FROM lab_slots WHERE slot_id = ?').get(slotId);
  }
  if (!selectedSlot && activeSlots.length > 0) {
    selectedSlot = activeSlots[0];
  }

  const intervalSchedule = selectedSlot
    ? checkIntervalScheduleStatus(labId, targetDate, selectedSlot.start_time, selectedSlot.end_time, effectivePolicy)
    : { allowed: daySchedule.isOpen, code: daySchedule.isOpen ? 'OPEN' : 'LAB_CLOSED_HOLIDAY', reason: daySchedule.closureReason };

  const totalBookableMinutes =
    Math.max(60, parseTimeToMinutes(daySchedule.closeTime || '18:00') - parseTimeToMinutes(daySchedule.openTime || '09:00'));

  const workstations = db.prepare(`
    SELECT machine_id, lab_id, block_code, row_num, seat_num, block_seat_num, display_label,
           status, active_job, current_user_id
    FROM workstations
    WHERE lab_id = ?
    ORDER BY block_code ASC, row_num ASC, seat_num ASC, machine_id ASC
  `).all(labId);

  // Fetch all active bookings for this date (supports both slot-based and arbitrary custom-interval bookings!)
  const dayBookings = db.prepare(`
    SELECT b.booking_id, b.machine_id, b.slot_id, b.status, b.duration_minutes, b.demand_level,
           COALESCE(b.start_time, s.start_time) as eff_start,
           COALESCE(b.end_time, s.end_time) as eff_end,
           s.duration_minutes as slot_duration
    FROM bookings b
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    JOIN workstations w ON b.machine_id = w.machine_id
    WHERE b.booking_date = ?
      AND w.lab_id = ?
      AND b.status IN ('CONFIRMED', 'CHECKED_IN')
  `).all(targetDate, labId);

  // Fetch pending queued requests for this date (including multi-seat preferences) to highlight PENDING seats
  const dayPending = db.prepare(`
    SELECT r.request_id, r.slot_id, r.preferred_machine_id,
           COALESCE(r.start_time, s.start_time) as eff_start,
           COALESCE(r.end_time, s.end_time) as eff_end
    FROM booking_requests r
    LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
    WHERE r.booking_date = ? AND r.status = 'QUEUED'
  `).all(targetDate);

  const prefRows = db.prepare(`
    SELECT bp.request_id, bp.machine_id
    FROM booking_preferences bp
    JOIN booking_requests r ON bp.request_id = r.request_id
    WHERE r.booking_date = ? AND r.status = 'QUEUED'
  `).all(targetDate);

  const prefsByReq = new Map();
  for (const p of prefRows) {
    if (!prefsByReq.has(p.request_id)) prefsByReq.set(p.request_id, []);
    prefsByReq.get(p.request_id).push(p.machine_id);
  }

  // Index bookings by machine_id
  const bookingsByMachine = new Map();
  for (const b of dayBookings) {
    if (!bookingsByMachine.has(b.machine_id)) bookingsByMachine.set(b.machine_id, []);
    bookingsByMachine.get(b.machine_id).push(b);
  }

  // Find which machines have overlapping pending requests for the selected [start, end)
  const pendingMachineCounts = new Map();
  let overlappingPendingTotal = 0;
  if (selectedSlot) {
    for (const r of dayPending) {
      if (r.eff_start && r.eff_end && r.eff_start < selectedSlot.end_time && selectedSlot.start_time < r.eff_end) {
        overlappingPendingTotal++;
        const targets = prefsByReq.get(r.request_id) || (r.preferred_machine_id ? [r.preferred_machine_id] : []);
        for (const mId of targets) {
          pendingMachineCounts.set(mId, (pendingMachineCounts.get(mId) || 0) + 1);
        }
      }
    }
  }

  let onlineCount = 0;
  let maintenanceCount = 0;
  let slotAvailableCount = 0;
  let slotPendingCount = 0;
  let slotBookedCount = 0;

  const enrichedWorkstations = workstations.map(w => {
    const isMaintenance = w.status === 'MAINTENANCE';
    if (isMaintenance) maintenanceCount++;
    else onlineCount++;

    const mBookings = bookingsByMachine.get(w.machine_id) || [];

    // Daily occupancy percentage
    let bookedMinutes = 0;
    for (const b of mBookings) {
      const mins = Number(b.duration_minutes) || Number(b.slot_duration) || (parseTimeToMinutes(b.eff_end) - parseTimeToMinutes(b.eff_start)) || 60;
      bookedMinutes += Math.max(0, mins);
    }
    const dailyOccupancyPct = isMaintenance
      ? 0
      : Math.min(100, Math.round((bookedMinutes / totalBookableMinutes) * 100));

    // Half-open [start, end) overlap check: A_start < B_end AND B_start < A_end
    let selectedSlotBooking = null;
    if (selectedSlot) {
      selectedSlotBooking = mBookings.find(b =>
        b.eff_start && b.eff_end &&
        b.eff_start < selectedSlot.end_time &&
        selectedSlot.start_time < b.eff_end
      ) || null;
    }

    const pendingCount = pendingMachineCounts.get(w.machine_id) || 0;
    const slotAvailable = !isMaintenance && !selectedSlotBooking;
    const availabilityStatus = isMaintenance
      ? 'MAINTENANCE'
      : selectedSlotBooking
      ? (selectedSlotBooking.status === 'CHECKED_IN' ? 'OCCUPIED' : 'BOOKED')
      : pendingCount > 0
      ? 'PENDING'
      : 'AVAILABLE';

    if (availabilityStatus === 'AVAILABLE') slotAvailableCount++;
    else if (availabilityStatus === 'PENDING') {
      slotAvailableCount++;
      slotPendingCount++;
    } else if (!isMaintenance) {
      slotBookedCount++;
    }

    // Next available preset interval on this date
    let nextAvailableSlot = null;
    if (!isMaintenance) {
      const startIndex = selectedSlot && selectedSlot.slot_id
        ? Math.max(0, activeSlots.findIndex(s => s.slot_id === selectedSlot.slot_id))
        : 0;

      for (let offset = 0; offset < activeSlots.length; offset++) {
        const cand = activeSlots[(startIndex + offset) % activeSlots.length];
        const busy = mBookings.some(b =>
          b.eff_start && b.eff_end && b.eff_start < cand.end_time && cand.start_time < b.eff_end
        );
        if (!busy) {
          nextAvailableSlot = {
            slotId: cand.slot_id,
            startTime: cand.start_time,
            endTime: cand.end_time,
            label: `${cand.start_time} – ${cand.end_time}`
          };
          break;
        }
      }
    }

    return {
      id: w.display_label || w.machine_id,
      machine_id: w.machine_id,
      block_code: w.block_code || 'A',
      row_num: w.row_num || 1,
      seat_num: w.seat_num || 1,
      block_seat_num: w.block_seat_num || 1,
      display_label: w.display_label || w.machine_id,
      operational_status: isMaintenance ? 'MAINTENANCE' : 'ONLINE',
      daily_booked_minutes: bookedMinutes,
      total_bookable_minutes: totalBookableMinutes,
      daily_occupancy_pct: dailyOccupancyPct,
      occupancy_band: getOccupancyBand(dailyOccupancyPct, isMaintenance),
      slot_available: slotAvailable,
      slot_status: availabilityStatus,
      availability: availabilityStatus,
      pending_requests_count: pendingCount,
      next_available_slot: nextAvailableSlot
    };
  });

  // Per-slot summary for the preset interval bar
  const slotsSummary = activeSlots.map(s => {
    let busyMachines = 0;
    for (const w of workstations) {
      if (w.status === 'MAINTENANCE') continue;
      const mBookings = bookingsByMachine.get(w.machine_id) || [];
      if (mBookings.some(b => b.eff_start && b.eff_end && b.eff_start < s.end_time && s.start_time < b.eff_end)) {
        busyMachines++;
      }
    }
    const availableInSlot = Math.max(0, onlineCount - busyMachines);
    const queuedInSlot = dayPending.filter(r =>
      r.eff_start && r.eff_end && r.eff_start < s.end_time && s.start_time < r.eff_end
    ).length;
    const contention = classifySlotDemand(queuedInSlot, availableInSlot, policy.high_demand_threshold);

    return {
      slot_id: s.slot_id,
      slot_name: s.slot_name,
      start_time: s.start_time,
      end_time: s.end_time,
      duration_minutes: getSlotDurationMinutes(s),
      round_number: s.round_number,
      available_count: availableInSlot,
      booked_count: busyMachines,
      queued_count: queuedInSlot,
      demand_ratio: contention.demandRatio,
      demand_level: contention.demandLevel
    };
  });

  const intervalDemand = classifySlotDemand(overlappingPendingTotal, slotAvailableCount, policy.high_demand_threshold);

  const blockA = enrichedWorkstations.filter(w => w.block_code === 'A');
  const blockB = enrichedWorkstations.filter(w => w.block_code === 'B');

  const result = {
    version: stateVersion,
    lab,
    date: targetDate,
    isCustomInterval,
    interval: selectedSlot ? {
      date: targetDate,
      start: selectedSlot.start_time,
      end: selectedSlot.end_time,
      durationMinutes: getSlotDurationMinutes(selectedSlot)
    } : null,
    schedule: {
      policyVersion: policy.policy_version || 'fairlab-v2',
      openTime: daySchedule.openTime || '09:00',
      closeTime: daySchedule.closeTime || '18:00',
      intervalMinutes: Number(policy.slot_interval_minutes) || 60,
      minDurationMinutes: Number(policy.min_duration_minutes) || 30,
      maxDurationMinutes: Math.min(120, Number(policy.max_duration_minutes) || 120),
      cutoffMinutesBeforeStart: Number(policy.cutoff_minutes_before_start) || 15,
      maxPreferencesPerRequest: Number(policy.max_preferences_per_request) || 3,
      maxDailyHours: Number(policy.max_daily_hours) || 2.0,
      maxDailyBookings: Number(policy.max_daily_bookings) || 2,
      deductionPerHour: policy.deduction_per_hour != null ? Number(policy.deduction_per_hour) : 5.0,
      highDemandDeductionPerHour: policy.high_demand_deduction_per_hour != null ? Number(policy.high_demand_deduction_per_hour) : 0.0,
      highDemandThreshold: Number(policy.high_demand_threshold) || 1.5,
      requireTicketRelease: Boolean(policy.require_ticket_release),
      totalBookableMinutes
    },
    daySchedule: {
      date: daySchedule.date,
      dayOfWeek: daySchedule.dayOfWeek,
      dayName: daySchedule.dayName,
      isOpen: daySchedule.isOpen,
      closureReason: daySchedule.closureReason,
      openTime: daySchedule.openTime,
      closeTime: daySchedule.closeTime,
      override: daySchedule.override,
      blockedSessions: daySchedule.blockedSessions,
      requireTicketRelease: daySchedule.requireTicketRelease,
      ticketReleases: daySchedule.ticketReleases
    },
    intervalSchedule: {
      allowed: intervalSchedule.allowed,
      code: intervalSchedule.code,
      reason: intervalSchedule.reason,
      conflict: intervalSchedule.conflict || null,
      matchingRelease: intervalSchedule.matchingRelease || null
    },
    selectedSlot: selectedSlot ? {
      slot_id: selectedSlot.slot_id,
      slot_name: selectedSlot.slot_name,
      start_time: selectedSlot.start_time,
      end_time: selectedSlot.end_time,
      duration_minutes: getSlotDurationMinutes(selectedSlot),
      demand_ratio: intervalDemand.demandRatio,
      demand_level: intervalDemand.demandLevel,
      queued_count: overlappingPendingTotal
    } : null,
    summary: {
      totalWorkstations: enrichedWorkstations.length,
      blockACount: blockA.length,
      blockBCount: blockB.length,
      onlineCount,
      maintenanceCount,
      slotAvailableCount,
      slotPendingCount,
      slotBookedCount
    },
    blocks: [
      {
        code: 'A',
        name: 'Block A',
        dimensions: '6 rows × 10 systems',
        rows: 6,
        cols: 10,
        total: blockA.length,
        availableInSlot: blockA.filter(w => w.slot_available).length
      },
      {
        code: 'B',
        name: 'Block B',
        dimensions: '4 rows × 6 systems',
        rows: 4,
        cols: 6,
        total: blockB.length,
        availableInSlot: blockB.filter(w => w.slot_available).length
      }
    ],
    slots: slotsSummary,
    workstations: enrichedWorkstations,
    fromCache: false
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Detailed availability timeline for a single workstation (accepts L106-PC-05 OR A-R1-PC05)
 */
function getWorkstationAvailability(identifier, dateStr = null) {
  const targetDate = dateStr || getTodayDateString();
  const ws = resolveWorkstation(identifier);
  if (!ws) return null;

  const cacheKey = `ws:${ws.machine_id}:${targetDate}`;
  const cached = getCache(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const db = getDb();
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    lab_open_time: '09:00',
    lab_close_time: '18:00'
  };

  const activeSlots = db.prepare(`
    SELECT * FROM lab_slots
    WHERE lab_id = ? AND is_active = 1
    ORDER BY round_number ASC
  `).all(ws.lab_id);

  const bookings = db.prepare(`
    SELECT b.booking_id, b.slot_id, b.status, b.duration_minutes, b.demand_level,
           COALESCE(b.start_time, s.start_time) as eff_start,
           COALESCE(b.end_time, s.end_time) as eff_end,
           s.duration_minutes as slot_duration
    FROM bookings b
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    WHERE b.machine_id = ?
      AND b.booking_date = ?
      AND b.status IN ('CONFIRMED', 'CHECKED_IN')
    ORDER BY eff_start ASC
  `).all(ws.machine_id, targetDate);

  const isMaintenance = ws.status === 'MAINTENANCE';
  const totalBookableMinutes = Math.max(
    60,
    parseTimeToMinutes(policy.lab_close_time || '18:00') - parseTimeToMinutes(policy.lab_open_time || '09:00')
  );

  let bookedMinutes = 0;
  for (const b of bookings) {
    if (!isMaintenance) {
      bookedMinutes += Number(b.duration_minutes) || (parseTimeToMinutes(b.eff_end) - parseTimeToMinutes(b.eff_start)) || 60;
    }
  }

  const intervals = activeSlots.map(s => {
    const dur = getSlotDurationMinutes(s);
    const conflict = bookings.find(b =>
      b.eff_start && b.eff_end && b.eff_start < s.end_time && s.start_time < b.eff_end
    );
    return {
      slot_id: s.slot_id,
      slot_name: s.slot_name,
      start_time: s.start_time,
      end_time: s.end_time,
      duration_minutes: dur,
      available: !isMaintenance && !conflict,
      status: isMaintenance
        ? 'MAINTENANCE'
        : conflict
        ? (conflict.status === 'CHECKED_IN' ? 'OCCUPIED' : 'BOOKED')
        : 'AVAILABLE'
    };
  });

  const dailyOccupancyPct = isMaintenance ? 0 : Math.min(100, Math.round((bookedMinutes / totalBookableMinutes) * 100));
  const nextAvailable = intervals.find(i => i.available) || null;

  const result = {
    version: stateVersion,
    workstation: {
      id: ws.display_label || ws.machine_id,
      machine_id: ws.machine_id,
      block_code: ws.block_code || 'A',
      row_num: ws.row_num || 1,
      seat_num: ws.seat_num || 1,
      block_seat_num: ws.block_seat_num || 1,
      display_label: ws.display_label || ws.machine_id,
      operational_status: isMaintenance ? 'MAINTENANCE' : 'ONLINE',
      maintenance_note: isMaintenance ? (ws.active_job || 'Scheduled hardware maintenance') : null
    },
    date: targetDate,
    daily_booked_minutes: bookedMinutes,
    total_bookable_minutes: totalBookableMinutes,
    daily_occupancy_pct: dailyOccupancyPct,
    occupancy_band: getOccupancyBand(dailyOccupancyPct, isMaintenance),
    booked_windows: bookings.map(b => ({ start: b.eff_start, end: b.eff_end, status: b.status })),
    next_available_interval: nextAvailable
      ? { slotId: nextAvailable.slot_id, startTime: nextAvailable.start_time, endTime: nextAvailable.end_time, label: `${nextAvailable.start_time} – ${nextAvailable.end_time}` }
      : null,
    intervals,
    fromCache: false
  };

  setCache(cacheKey, result);
  return result;
}

module.exports = {
  getLabAvailability,
  getWorkstationAvailability,
  syncLabSlotsFromPolicy,
  invalidateAvailabilityCache,
  getStateVersion,
  getOccupancyBand,
  validateCustomInterval,
  isValidCalendarDate,
  parseTimeInput,
  resolveWorkstation
};
