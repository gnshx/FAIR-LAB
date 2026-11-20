const { getDb } = require('../db/database');
const {
  rankBookingRequests,
  classifySlotDemand,
  checkDailyBookingLimit,
  calculateHoursDemandScore
} = require('./fairnessEngine');
const { generateAccessPass } = require('./passService');
const {
  invalidateAvailabilityCache,
  validateCustomInterval,
  isValidCalendarDate,
  parseTimeInput,
  resolveWorkstation
} = require('./availabilityService');
const { getEffectiveDaySchedule, checkIntervalScheduleStatus } = require('./scheduleService');
const { parseTimeToMinutes, getTodayDateString } = require('../db/seed');

function computeDurationMinutes(startTime, endTime, fallback = 60) {
  if (startTime && endTime) {
    const diff = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
    if (diff > 0) return diff;
  }
  return Number(fallback) || 60;
}

/**
 * Resolves either a slotId OR arbitrary custom [startTime, endTime) into a canonical interval descriptor
 */
function resolveIntervalInput(db, { slotId, bookingDate, startTime, endTime, policy }) {
  if (slotId) {
    const slot = db.prepare('SELECT * FROM lab_slots WHERE slot_id = ?').get(slotId);
    if (!slot) throw new Error('Target time interval not found');
    return {
      slotId: slot.slot_id,
      slotName: slot.slot_name,
      labId: slot.lab_id || 'lab-l106',
      bookingDate: bookingDate || getTodayDateString(),
      startTime: slot.start_time,
      endTime: slot.end_time,
      durationMinutes: computeDurationMinutes(slot.start_time, slot.end_time, slot.duration_minutes),
      capacity: slot.capacity || 84
    };
  }

  const parsedStart = parseTimeInput(startTime);
  const parsedEnd = parseTimeInput(endTime);
  if (!parsedStart.time || !parsedEnd.time) {
    throw new Error('Provide either a slotId or valid startTime and endTime (HH:MM or ISO-8601).');
  }

  const targetDate = bookingDate || parsedStart.date || getTodayDateString();
  const daySched = getEffectiveDaySchedule('lab-l106', targetDate, policy);
  const effPolicy = {
    ...policy,
    lab_open_time: daySched.openTime,
    lab_close_time: daySched.closeTime,
    max_duration_minutes: Math.min(120, Number(policy?.max_duration_minutes) || 120)
  };
  const validated = validateCustomInterval(parsedStart.time, parsedEnd.time, effPolicy);

  // If custom times happen to match an active preset slot exactly, link slot_id for convenience
  const matchingSlot = db.prepare(`
    SELECT * FROM lab_slots WHERE lab_id = 'lab-l106' AND is_active = 1 AND start_time = ? AND end_time = ? LIMIT 1
  `).get(validated.startTime, validated.endTime);

  return {
    slotId: matchingSlot ? matchingSlot.slot_id : null,
    slotName: matchingSlot ? matchingSlot.slot_name : `Custom (${validated.startTime} – ${validated.endTime})`,
    labId: 'lab-l106',
    bookingDate: targetDate,
    startTime: validated.startTime,
    endTime: validated.endTime,
    durationMinutes: validated.durationMinutes,
    capacity: 84
  };
}

/**
 * Resolves and validates up to 3 ranked workstation preferences (accepts L106-PC-05 OR A-R1-PC05)
 */
function resolvePreferences(preferredWorkstations, preferredMachineId, maxPrefs = 3) {
  const rawList = [];
  if (Array.isArray(preferredWorkstations) && preferredWorkstations.length > 0) {
    for (const item of preferredWorkstations) {
      if (item && !rawList.includes(item)) rawList.push(item);
    }
  } else if (preferredMachineId) {
    rawList.push(preferredMachineId);
  }

  if (rawList.length > maxPrefs) {
    throw new Error(`You can select at most ${maxPrefs} ranked workstation preferences per request.`);
  }

  const resolved = [];
  const seenIds = new Set();
  for (const idOrLabel of rawList) {
    const rig = resolveWorkstation(idOrLabel);
    if (!rig) throw new Error(`Workstation "${idOrLabel}" does not exist in Lab L-106.`);
    if (rig.status === 'MAINTENANCE') {
      throw new Error(`Workstation ${rig.display_label || rig.machine_id} is offline for maintenance. Remove it from your preferences.`);
    }
    if (!seenIds.has(rig.machine_id)) {
      seenIds.add(rig.machine_id);
      resolved.push(rig);
    }
  }
  return resolved;
}

/**
 * Checks whether a workstation has any active overlapping booking in [startTime, endTime) on bookingDate
 */
function isWorkstationBusyForWindow(db, machineId, bookingDate, startTime, endTime) {
  const conflict = db.prepare(`
    SELECT b.booking_id
    FROM bookings b
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    WHERE b.machine_id = ?
      AND b.booking_date = ?
      AND b.status IN ('CONFIRMED', 'CHECKED_IN')
      AND COALESCE(b.start_time, s.start_time) < ?
      AND ? < COALESCE(b.end_time, s.end_time)
    LIMIT 1
  `).get(machineId, bookingDate, endTime, startTime);
  return Boolean(conflict);
}

/**
 * Submits a booking request (supports both preset slotId AND arbitrary custom [startTime, endTime),
 * up to 3 ranked preferences, idempotencyKey, and daily quota + overlap protection).
 */
function submitBookingRequest({
  userId,
  slotId = null,
  bookingDate = null,
  startTime = null,
  endTime = null,
  preferredMachineId = null,
  preferredWorkstations = null,
  computePurpose,
  researchField,
  idempotencyKey = null,
  allocationMode = 'SCHEDULED'
}) {
  const db = getDb();

  const tx = db.transaction(() => {
    // 0. Idempotency replay check
    if (idempotencyKey) {
      const prev = db.prepare('SELECT * FROM booking_requests WHERE idempotency_key = ?').get(idempotencyKey);
      if (prev) {
        const existingPrefs = db.prepare(`
          SELECT bp.preference_rank, bp.machine_id, w.display_label
          FROM booking_preferences bp
          JOIN workstations w ON bp.machine_id = w.machine_id
          WHERE bp.request_id = ? ORDER BY bp.preference_rank ASC
        `).all(prev.request_id);
        return {
          requestId: prev.request_id,
          userId: prev.user_id,
          slotId: prev.slot_id,
          bookingDate: prev.booking_date,
          startTime: prev.start_time,
          endTime: prev.end_time,
          durationMinutes: prev.duration_minutes,
          preferredMachineId: prev.preferred_machine_id,
          preferredWorkstations: existingPrefs.map(p => p.display_label || p.machine_id),
          priorityScore: prev.priority_score_snapshot,
          allocationMode: prev.allocation_mode || 'SCHEDULED',
          status: prev.status,
          idempotentReplay: true
        };
      }
    }

    // 0b. Verify registered user exists (prevents forged user IDs or FK crashes)
    const userExists = db.prepare('SELECT user_id, role FROM users WHERE user_id = ?').get(userId);
    if (!userExists) {
      const err = new Error('User account not found. Valid institute registration is required.');
      err.statusCode = 401;
      throw err;
    }

    // 1. Active semester & policy
    const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' ORDER BY start_date DESC LIMIT 1").get();
    if (!activeSem) throw new Error('No active academic semester configured');

    const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
      policy_version: 'fairlab-v2',
      base_score: 100,
      slot_interval_minutes: 60,
      min_duration_minutes: 30,
      max_duration_minutes: 240,
      max_preferences_per_request: 3
    };

    // 2. Ensure student fairness profile exists
    let fairness = db.prepare(`
      SELECT * FROM student_fairness WHERE user_id = ? AND semester_id = ?
    `).get(userId, activeSem.semester_id);

    if (!fairness) {
      const fairnessId = `fair-${userId}-${activeSem.semester_id}`;
      db.prepare(`
        INSERT INTO student_fairness (
          fairness_id, user_id, semester_id, initial_score, current_score,
          booking_count, total_hours_used, high_demand_count, high_demand_hours,
          cumulative_wait_seconds, penalty_points
        )
        VALUES (?, ?, ?, ?, ?, 0, 0.0, 0, 0.0, 0, 0)
      `).run(fairnessId, userId, activeSem.semester_id, policy.base_score, policy.base_score);
      fairness = { current_score: policy.base_score, booking_count: 0, cumulative_wait_seconds: 0, penalty_points: 0 };
    }

    // 3. Resolve & validate interval + real calendar date + up to 3 ranked workstation preferences
    const interval = resolveIntervalInput(db, { slotId, bookingDate, startTime, endTime, policy });
    if (!isValidCalendarDate(interval.bookingDate)) {
      throw new Error(`Invalid booking date "${interval.bookingDate}". Provide a valid YYYY-MM-DD calendar date.`);
    }
    if (interval.bookingDate < getTodayDateString()) {
      throw new Error(`Cannot book workstations in the past (${interval.bookingDate}). Choose today or a future date.`);
    }

    // 3b. Enforce Holidays, Extra Day Hours, Mon–Fri Academic Lab Timetable, Max 2h Limit, and Admin Ticket Releases
    const schedStatus = checkIntervalScheduleStatus(
      interval.labId || 'lab-l106',
      interval.bookingDate,
      interval.startTime,
      interval.endTime,
      policy,
      { isExplicitSlot: Boolean(slotId) }
    );
    if (!schedStatus.allowed) {
      const err = new Error(schedStatus.reason);
      err.statusCode = 400;
      err.code = schedStatus.code;
      throw err;
    }
    const prefRigs = resolvePreferences(
      preferredWorkstations,
      preferredMachineId,
      Number(policy.max_preferences_per_request) || 3
    );
    const primaryPrefId = prefRigs.length > 0 ? prefRigs[0].machine_id : null;

    // 4. Student half-open [start, end) overlap check across queued requests and active bookings
    const existingReq = db.prepare(`
      SELECT r.request_id, r.status,
             COALESCE(r.start_time, s.start_time) as eff_start,
             COALESCE(r.end_time, s.end_time) as eff_end,
             COALESCE(s.slot_name, 'Custom Window') as slot_name
      FROM booking_requests r
      LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
      WHERE r.user_id = ?
        AND r.booking_date = ?
        AND r.status = 'QUEUED'
        AND COALESCE(r.start_time, s.start_time) < ?
        AND ? < COALESCE(r.end_time, s.end_time)
      LIMIT 1
    `).get(userId, interval.bookingDate, interval.endTime, interval.startTime);

    if (existingReq) {
      throw new Error(`You already have a pending booking request overlapping ${existingReq.eff_start} – ${existingReq.eff_end} (${existingReq.slot_name}) on ${interval.bookingDate}`);
    }

    const existingBooking = db.prepare(`
      SELECT b.booking_id,
             COALESCE(b.start_time, s.start_time) as eff_start,
             COALESCE(b.end_time, s.end_time) as eff_end
      FROM bookings b
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      WHERE b.user_id = ?
        AND b.booking_date = ?
        AND b.status IN ('CONFIRMED', 'CHECKED_IN')
        AND COALESCE(b.start_time, s.start_time) < ?
        AND ? < COALESCE(b.end_time, s.end_time)
      LIMIT 1
    `).get(userId, interval.bookingDate, interval.endTime, interval.startTime);

    if (existingBooking) {
      throw new Error(`You already hold a confirmed booking overlapping ${existingBooking.eff_start} – ${existingBooking.eff_end} on ${interval.bookingDate}`);
    }

    // 5. Configurable daily max hours & max bookings check
    const dailyCheck = checkDailyBookingLimit(userId, interval.bookingDate, interval.durationMinutes);
    if (!dailyCheck.allowed) {
      throw new Error(dailyCheck.reason);
    }

    // 6. Insert booking request
    const requestId = `req-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    db.prepare(`
      INSERT INTO booking_requests (
        request_id, user_id, slot_id, booking_date, start_time, end_time, duration_minutes,
        preferred_machine_id, compute_purpose, research_field,
        priority_score_snapshot, wait_time_seconds, allocation_mode, policy_version, idempotency_key, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED')
    `).run(
      requestId,
      userId,
      interval.slotId,
      interval.bookingDate,
      interval.startTime,
      interval.endTime,
      interval.durationMinutes,
      primaryPrefId,
      computePurpose || 'Academic Lab Session',
      researchField || 'Computer Science',
      fairness.current_score,
      fairness.cumulative_wait_seconds || 0,
      allocationMode,
      policy.policy_version || 'fairlab-v2',
      idempotencyKey || null
    );

    // 7. Insert ranked preferences (1..3)
    const insertPref = db.prepare(`
      INSERT INTO booking_preferences (request_id, machine_id, preference_rank)
      VALUES (?, ?, ?)
    `);
    prefRigs.forEach((rig, idx) => {
      insertPref.run(requestId, rig.machine_id, idx + 1);
    });

    // 8. Insert waitlist tracking entry
    const wlCount = db.prepare(`
      SELECT COUNT(*) as c FROM waitlist_entries
      WHERE booking_date = ? AND status = 'WAITING'
        AND COALESCE(start_time, '00:00') < ? AND ? < COALESCE(end_time, '23:59')
    `).get(interval.bookingDate, interval.endTime, interval.startTime).c;

    db.prepare(`
      INSERT INTO waitlist_entries (waitlist_id, request_id, user_id, slot_id, booking_date, start_time, end_time, priority_score, position, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING')
    `).run(
      `wl-${requestId}`,
      requestId,
      userId,
      interval.slotId,
      interval.bookingDate,
      interval.startTime,
      interval.endTime,
      fairness.current_score,
      wlCount + 1
    );

    return {
      requestId,
      userId,
      slotId: interval.slotId,
      slotName: interval.slotName,
      bookingDate: interval.bookingDate,
      startTime: interval.startTime,
      endTime: interval.endTime,
      durationMinutes: interval.durationMinutes,
      preferredMachineId: primaryPrefId,
      preferredWorkstations: prefRigs.map(r => r.display_label || r.machine_id),
      priorityScore: fairness.current_score,
      allocationMode,
      dailyQuota: dailyCheck,
      status: 'QUEUED'
    };
  }).immediate;

  const res = tx();
  invalidateAvailabilityCache();
  return res;
}

/**
 * Hybrid Reservation Decision Flow (Spec Section 5.1 & 6):
 * - Validates and inserts the request (with idempotency + up to 3 ranked preferences)
 * - If allocationMode === 'AUTO':
 *     - Checks whether any other pending QUEUED request overlaps this [startTime, endTime)
 *     - If UNCONTESTED and an eligible preferred (or available) workstation is free:
 *         -> Immediately confirms inside a single atomic transaction & generates QR pass!
 *     - If CONTESTED (competing requests exist):
 *         -> Keeps request in PENDING/QUEUED state for fairness ranking!
 */
async function submitHybridBookingRequest(params) {
  const db = getDb();
  const requestedMode = params.allocationMode || 'AUTO';

  // Step 1: Validate & record request (handles idempotency, overlap, daily quota, preferences)
  const reqResult = submitBookingRequest({
    ...params,
    allocationMode: requestedMode === 'SCHEDULED' ? 'SCHEDULED' : 'AUTO'
  });

  // If idempotent replay already allocated, return existing booking cleanly
  if (reqResult.idempotentReplay) {
    const existingBooking = db.prepare('SELECT * FROM bookings WHERE request_id = ?').get(reqResult.requestId);
    return {
      ...reqResult,
      status: existingBooking ? 'CONFIRMED' : 'PENDING',
      booking: existingBooking || null
    };
  }

  if (requestedMode === 'SCHEDULED') {
    return {
      ...reqResult,
      status: 'PENDING',
      allocationMode: 'SCHEDULED',
      message: 'Queued for the Fairness Allocation Round.'
    };
  }

  // Step 2 & 3: Atomically verify contention (no competing QUEUED requests & no RUNNING round)
  // AND immediately confirm on first available ranked preference inside ONE DB transaction!
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || { policy_version: 'fairlab-v2' };
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(reqResult.userId);

  const prefs = db.prepare(`
    SELECT w.* FROM booking_preferences bp
    JOIN workstations w ON bp.machine_id = w.machine_id
    WHERE bp.request_id = ? ORDER BY bp.preference_rank ASC
  `).all(reqResult.requestId);

  let confirmedBooking = null;
  let contentionInfo = null;

  const immediateTx = db.transaction(() => {
    // SECURITY & CONCURRENCY INVARIANT: Checked INSIDE the same transaction as INSERT booking
    const runningRound = db.prepare(`
      SELECT round_id FROM allocation_rounds
      WHERE booking_date = ? AND status = 'RUNNING'
      LIMIT 1
    `).get(reqResult.bookingDate);

    const competingCount = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM booking_requests r
      LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
      WHERE r.request_id != ?
        AND r.booking_date = ?
        AND r.status = 'QUEUED'
        AND COALESCE(r.start_time, s.start_time) < ?
        AND ? < COALESCE(r.end_time, s.end_time)
    `).get(reqResult.requestId, reqResult.bookingDate, reqResult.endTime, reqResult.startTime).cnt;

    if (runningRound || competingCount > 0) {
      db.prepare("UPDATE booking_requests SET allocation_mode = 'SCHEDULED' WHERE request_id = ?").run(reqResult.requestId);
      contentionInfo = { competingCount, activeRound: Boolean(runningRound) };
      return null;
    }

    let assignedRig = null;
    let preferenceRankHonored = null;

    for (let i = 0; i < prefs.length; i++) {
      const rig = prefs[i];
      if (rig.status !== 'MAINTENANCE' && !isWorkstationBusyForWindow(db, rig.machine_id, reqResult.bookingDate, reqResult.startTime, reqResult.endTime)) {
        assignedRig = rig;
        preferenceRankHonored = i + 1;
        break;
      }
    }

    // Fallback to any available seat in lab if preferences were busy or none specified
    if (!assignedRig) {
      const fallbackRigs = db.prepare(`
        SELECT w.* FROM workstations w
        WHERE w.lab_id = 'lab-l106' AND w.status != 'MAINTENANCE'
        ORDER BY w.block_code ASC, w.row_num ASC, w.seat_num ASC
      `).all();
      for (const cand of fallbackRigs) {
        if (!isWorkstationBusyForWindow(db, cand.machine_id, reqResult.bookingDate, reqResult.startTime, reqResult.endTime)) {
          assignedRig = cand;
          break;
        }
      }
    }

    if (!assignedRig) return null;

    const bookingId = `L106-2026-${Date.now()}-IMM-${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO bookings (
        booking_id, request_id, user_id, machine_id, slot_id, booking_date,
        start_time, end_time, duration_minutes, demand_level, demand_ratio,
        priority_snapshot, policy_version, allocation_mode, semester_id, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NORMAL', 0.01, ?, ?, 'IMMEDIATE', ?, 'CONFIRMED')
    `).run(
      bookingId,
      reqResult.requestId,
      reqResult.userId,
      assignedRig.machine_id,
      reqResult.slotId,
      reqResult.bookingDate,
      reqResult.startTime,
      reqResult.endTime,
      reqResult.durationMinutes,
      reqResult.priorityScore,
      policy.policy_version || 'fairlab-v2',
      activeSem.semester_id
    );

    db.prepare("UPDATE booking_requests SET status = 'ALLOCATED', allocation_mode = 'IMMEDIATE' WHERE request_id = ?").run(reqResult.requestId);
    db.prepare("UPDATE waitlist_entries SET status = 'PROMOTED', updated_at = datetime('now') WHERE request_id = ?").run(reqResult.requestId);

    // Transactional notification & PENDING outbox event (published after commit with crash retry)
    db.prepare(`
      INSERT INTO notifications (notification_id, user_id, type, title, message)
      VALUES (?, ?, 'BOOKING_CONFIRMED', ?, ?)
    `).run(
      `notif-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      reqResult.userId,
      `Booking Confirmed: ${assignedRig.display_label || assignedRig.machine_id}`,
      `Reserved ${assignedRig.display_label || assignedRig.machine_id} on ${reqResult.bookingDate} (${reqResult.startTime}–${reqResult.endTime}).`
    );
    db.prepare(`
      INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload, status)
      VALUES (?, 'booking.confirmed', ?, ?, 'PENDING')
    `).run(
      `evt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      bookingId,
      JSON.stringify({ bookingId, machineId: assignedRig.machine_id, userId: reqResult.userId, date: reqResult.bookingDate, start: reqResult.startTime, end: reqResult.endTime })
    );

    if (reqResult.bookingDate === getTodayDateString()) {
      db.prepare(`
        UPDATE workstations
        SET status = CASE WHEN status = 'OCCUPIED' THEN 'OCCUPIED' ELSE 'BOOKED' END,
            current_user_id = COALESCE(current_user_id, ?),
            active_job = COALESCE(active_job, ?)
        WHERE machine_id = ?
      `).run(reqResult.userId, `Confirmed (${reqResult.startTime}–${reqResult.endTime})`, assignedRig.machine_id);
    }

    confirmedBooking = {
      bookingId,
      requestId: reqResult.requestId,
      userId: reqResult.userId,
      machineId: assignedRig.machine_id,
      displayLabel: assignedRig.display_label || assignedRig.machine_id,
      blockCode: assignedRig.block_code || 'A',
      preferenceRankHonored,
      bookingDate: reqResult.bookingDate,
      startTime: reqResult.startTime,
      endTime: reqResult.endTime,
      timeSlot: `${reqResult.startTime} – ${reqResult.endTime}`,
      durationMinutes: reqResult.durationMinutes,
      demandLevel: 'NORMAL',
      allocationMode: 'IMMEDIATE'
    };
    return confirmedBooking;
  }).immediate;

  immediateTx();
  invalidateAvailabilityCache();

  if (!confirmedBooking) {
    if (contentionInfo) {
      return {
        ...reqResult,
        status: 'PENDING',
        allocationMode: 'SCHEDULED',
        competingRequests: contentionInfo.competingCount,
        message: contentionInfo.activeRound
          ? 'An allocation round is currently running for this date. Queued for fairness ranking.'
          : `${contentionInfo.competingCount} competing request(s) detected for this window. Queued for fairness ranking.`
      };
    }
    return {
      ...reqResult,
      status: 'PENDING',
      allocationMode: 'SCHEDULED',
      message: 'All workstations are currently booked for this interval. You have been placed on the waitlist.'
    };
  }

  // Post-commit resilient QR pass generation
  let pass = null;
  try {
    pass = await generateAccessPass(
      confirmedBooking.bookingId,
      reqResult.userId,
      user ? user.roll_no : 'STUDENT',
      confirmedBooking.machineId,
      reqResult.slotName || 'Custom Window',
      confirmedBooking.timeSlot
    );
  } catch (err) {
    console.warn(`[PassService] Deferred pass generation for ${confirmedBooking.bookingId}: ${err.message}`);
  }

  return {
    ...reqResult,
    status: 'CONFIRMED',
    allocationMode: 'IMMEDIATE',
    booking: confirmedBooking,
    pass,
    message: `Immediately confirmed ${confirmedBooking.displayLabel} (${confirmedBooking.timeSlot}).`
  };
}

/**
 * Cancels a QUEUED / WAITING booking request with zero penalty
 */
function cancelBookingRequest(requestId, userId) {
  const db = getDb();

  const tx = db.transaction(() => {
    const reqRow = db.prepare('SELECT * FROM booking_requests WHERE request_id = ?').get(requestId);
    if (!reqRow) throw new Error('Booking request not found');

    // Ownership / RBAC authorization check (blocks cross-user IDOR cancellation)
    const actor = db.prepare('SELECT user_id, role FROM users WHERE user_id = ?').get(userId);
    if (!actor || (reqRow.user_id !== userId && actor.role !== 'admin')) {
      const err = new Error('Forbidden: You can only withdraw your own booking requests.');
      err.statusCode = 403;
      throw err;
    }

    if (reqRow.status !== 'QUEUED') {
      throw new Error(`Request is already ${reqRow.status} and cannot be withdrawn from the queue`);
    }

    db.prepare("UPDATE booking_requests SET status = 'CANCELLED' WHERE request_id = ?").run(requestId);
    db.prepare("UPDATE waitlist_entries SET status = 'CANCELLED', updated_at = datetime('now') WHERE request_id = ?").run(requestId);

    db.prepare(`
      INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
      VALUES (?, ?, 'Student', 'student', 'REQUEST_CANCELLED', 'booking_requests', ?, ?)
    `).run(`audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`, userId, requestId, `Withdrew queued request (${reqRow.start_time || reqRow.slot_id} on ${reqRow.booking_date}, 0 penalty).`);

    return { success: true, requestId, penaltyApplied: 0 };
  });

  const res = tx();
  invalidateAvailabilityCache();
  return res;
}

/**
 * Multi-Preference Window Allocation Worker (supports both preset slotId AND arbitrary custom time windows):
 * 1. Collects all eligible QUEUED requests overlapping [startTime, endTime) on bookingDate (or matching slotId)
 * 2. Computes DemandRatio = EligibleRequests / AvailableCapacity -> NORMAL vs HIGH_DEMAND
 * 3. Ranks via 4-tier deterministic fairness order (Score DESC -> Wait DESC -> Timestamp ASC -> ID ASC)
 * 4. For each winning student, honors their 1st, 2nd, or 3rd ranked preference from booking_preferences
 *    (falling back to same block / any free seat if allowFallback=true)
 * 5. Records allocation_rounds audit row + policy_version snapshot
 */
async function runWindowAllocationRound({
  slotId = null,
  bookingDate = null,
  startTime = null,
  endTime = null,
  maxLimit = null,
  allowFallback = true
} = {}) {
  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  if (!activeSem) throw new Error('No active semester');

  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    policy_version: 'fairlab-v2',
    base_score: 100,
    min_priority_floor: 10,
    deduction_per_hour: 5.0,
    high_demand_deduction_per_hour: 0.0,
    high_demand_threshold: 1.5
  };

  let slot = null;
  if (slotId) {
    slot = db.prepare('SELECT * FROM lab_slots WHERE slot_id = ?').get(slotId);
    if (!slot) throw new Error('Slot not found');
  }

  // Determine booking date
  let targetDate = bookingDate;
  if (!targetDate) {
    const firstReq = slotId
      ? db.prepare("SELECT booking_date FROM booking_requests WHERE slot_id = ? AND status = 'QUEUED' ORDER BY requested_at ASC LIMIT 1").get(slotId)
      : db.prepare("SELECT booking_date FROM booking_requests WHERE status = 'QUEUED' ORDER BY requested_at ASC LIMIT 1").get();
    targetDate = firstReq ? firstReq.booking_date : getTodayDateString();
  }

  const winStart = startTime || (slot ? slot.start_time : '09:00');
  const winEnd = endTime || (slot ? slot.end_time : '18:00');

  // Fetch pending queued requests
  const rawRequests = slotId
    ? db.prepare(`
        SELECT r.*, u.name as student_name, u.roll_no, u.department, u.avatar_url,
               COALESCE(r.start_time, s.start_time) as eff_start,
               COALESCE(r.end_time, s.end_time) as eff_end,
               COALESCE(s.slot_name, 'Custom Window') as eff_slot_name
        FROM booking_requests r
        JOIN users u ON r.user_id = u.user_id
        LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
        WHERE r.slot_id = ? AND r.booking_date = ? AND r.status = 'QUEUED'
      `).all(slotId, targetDate)
    : db.prepare(`
        SELECT r.*, u.name as student_name, u.roll_no, u.department, u.avatar_url,
               COALESCE(r.start_time, s.start_time) as eff_start,
               COALESCE(r.end_time, s.end_time) as eff_end,
               COALESCE(s.slot_name, 'Custom Window') as eff_slot_name
        FROM booking_requests r
        JOIN users u ON r.user_id = u.user_id
        LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
        WHERE r.booking_date = ?
          AND r.status = 'QUEUED'
          AND COALESCE(r.start_time, s.start_time) < ?
          AND ? < COALESCE(r.end_time, s.end_time)
      `).all(targetDate, winEnd, winStart);

  if (rawRequests.length === 0) {
    return {
      roundId: null,
      allocatedCount: 0,
      waitlistedCount: 0,
      demandLevel: 'NORMAL',
      demandRatio: 0,
      bookingDate: targetDate,
      allocations: []
    };
  }

  // Load ranked preferences (1..3) for all candidate requests
  const prefStmt = db.prepare(`
    SELECT bp.preference_rank, w.*
    FROM booking_preferences bp
    JOIN workstations w ON bp.machine_id = w.machine_id
    WHERE bp.request_id = ?
    ORDER BY bp.preference_rank ASC
  `);
  const enrichedRequests = rawRequests.map(r => ({
    ...r,
    preferences: prefStmt.all(r.request_id)
  }));

  const rankedRequests = rankBookingRequests(enrichedRequests);

  const onlineRigs = db.prepare(`
    SELECT w.* FROM workstations w
    WHERE w.lab_id = 'lab-l106' AND w.status != 'MAINTENANCE'
    ORDER BY w.block_code ASC, w.row_num ASC, w.seat_num ASC, w.machine_id ASC
  `).all();

  const freeForWindowCount = onlineRigs.filter(r =>
    !isWorkstationBusyForWindow(db, r.machine_id, targetDate, winStart, winEnd)
  ).length;

  const capacityCap = maxLimit != null ? maxLimit : (slot ? (slot.capacity || freeForWindowCount) : freeForWindowCount);
  const maxToAllocate = Math.min(freeForWindowCount, capacityCap);

  const demandMetrics = classifySlotDemand(rankedRequests.length, maxToAllocate, policy.high_demand_threshold);
  const roundId = `rnd-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const policySnapshot = JSON.stringify({
    policy_version: policy.policy_version || 'fairlab-v2',
    base_score: policy.base_score,
    min_priority_floor: policy.min_priority_floor,
    deduction_per_hour: policy.deduction_per_hour,
    high_demand_deduction_per_hour: policy.high_demand_deduction_per_hour,
    high_demand_threshold: policy.high_demand_threshold
  });

  const allocations = [];
  const remainingWaitlist = [];

  const matchTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO allocation_rounds (
        round_id, lab_id, slot_id, booking_date, start_time, end_time,
        demand_ratio, demand_level, eligible_requests, allocated_count, waitlisted_count,
        policy_version, policy_snapshot, status
      )
      VALUES (?, 'lab-l106', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'RUNNING')
    `).run(
      roundId,
      slotId,
      targetDate,
      winStart,
      winEnd,
      demandMetrics.demandRatio,
      demandMetrics.demandLevel,
      rankedRequests.length,
      policy.policy_version || 'fairlab-v2',
      policySnapshot
    );

    for (const req of rankedRequests) {
      // Re-verify still QUEUED inside transaction
      const currentReq = db.prepare('SELECT status FROM booking_requests WHERE request_id = ?').get(req.request_id);
      if (!currentReq || currentReq.status !== 'QUEUED') continue;

      const reqStart = req.eff_start || winStart;
      const reqEnd = req.eff_end || winEnd;
      const reqDuration = computeDurationMinutes(reqStart, reqEnd, req.duration_minutes);

      // CRITICAL OVERLAP INVARIANT: Check if student already holds a CONFIRMED or CHECKED_IN booking
      // overlapping [reqStart, reqEnd) on targetDate. If so, auto-resolve/cancel this queued request
      // without aborting the entire round for other students!
      const userOverlap = db.prepare(`
        SELECT booking_id, machine_id, start_time, end_time
        FROM bookings
        WHERE user_id = ?
          AND booking_date = ?
          AND status IN ('CONFIRMED', 'CHECKED_IN')
          AND start_time IS NOT NULL AND end_time IS NOT NULL
          AND start_time < ? AND ? < end_time
        LIMIT 1
      `).get(req.user_id, targetDate, reqEnd, reqStart);

      if (userOverlap) {
        db.prepare("UPDATE booking_requests SET status = 'CANCELLED' WHERE request_id = ?").run(req.request_id);
        db.prepare("UPDATE waitlist_entries SET status = 'CANCELLED', updated_at = datetime('now') WHERE request_id = ?").run(req.request_id);
        continue;
      }

      if (allocations.length >= maxToAllocate) {
        remainingWaitlist.push(req);
        continue;
      }

      let assignedRig = null;
      let preferenceRankHonored = null;

      // 1. Try student's ranked workstation preferences (1 -> 2 -> 3)
      if (req.preferences && req.preferences.length > 0) {
        for (const pref of req.preferences) {
          if (pref.status !== 'MAINTENANCE' && !isWorkstationBusyForWindow(db, pref.machine_id, targetDate, reqStart, reqEnd)) {
            assignedRig = pref;
            preferenceRankHonored = pref.preference_rank;
            break;
          }
        }
      } else if (req.preferred_machine_id) {
        const pref = onlineRigs.find(r => r.machine_id === req.preferred_machine_id);
        if (pref && !isWorkstationBusyForWindow(db, pref.machine_id, targetDate, reqStart, reqEnd)) {
          assignedRig = pref;
          preferenceRankHonored = 1;
        }
      }

      // 2. Fallback to same preferred block, then any available workstation
      if (!assignedRig && allowFallback) {
        const prefBlock = req.preferences?.[0]?.block_code || null;
        if (prefBlock) {
          for (const cand of onlineRigs) {
            if (cand.block_code === prefBlock && !isWorkstationBusyForWindow(db, cand.machine_id, targetDate, reqStart, reqEnd)) {
              assignedRig = cand;
              break;
            }
          }
        }
        if (!assignedRig) {
          for (const cand of onlineRigs) {
            if (!isWorkstationBusyForWindow(db, cand.machine_id, targetDate, reqStart, reqEnd)) {
              assignedRig = cand;
              break;
            }
          }
        }
      }

      if (!assignedRig) {
        remainingWaitlist.push(req);
        continue;
      }

      const bookingId = `L106-2026-${Date.now()}-${allocations.length + 1}-${Math.floor(Math.random() * 1000)}`;

      try {
        db.prepare(`
          INSERT INTO bookings (
            booking_id, request_id, user_id, machine_id, slot_id, booking_date,
            start_time, end_time, duration_minutes, demand_level, demand_ratio,
            priority_snapshot, policy_version, allocation_mode, round_id, semester_id, status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, 'CONFIRMED')
        `).run(
          bookingId,
          req.request_id,
          req.user_id,
          assignedRig.machine_id,
          req.slot_id || slotId,
          targetDate,
          reqStart,
          reqEnd,
          reqDuration,
          demandMetrics.demandLevel,
          demandMetrics.demandRatio,
          req.priority_score_snapshot,
          policy.policy_version || 'fairlab-v2',
          roundId,
          activeSem.semester_id
        );
      } catch (insertErr) {
        console.warn(`[AllocationRound] Candidate ${req.user_id} (${req.request_id}) insert skipped: ${insertErr.message}`);
        db.prepare("UPDATE booking_requests SET status = 'CANCELLED' WHERE request_id = ?").run(req.request_id);
        continue;
      }

      db.prepare("UPDATE booking_requests SET status = 'ALLOCATED' WHERE request_id = ?").run(req.request_id);
      db.prepare("UPDATE waitlist_entries SET status = 'PROMOTED', updated_at = datetime('now') WHERE request_id = ?").run(req.request_id);

      if (targetDate === getTodayDateString()) {
        db.prepare(`
          UPDATE workstations
          SET status = CASE WHEN status = 'OCCUPIED' THEN 'OCCUPIED' ELSE 'BOOKED' END,
              current_user_id = COALESCE(current_user_id, ?),
              active_job = COALESCE(active_job, ?)
          WHERE machine_id = ?
        `).run(req.user_id, `Allocated (${reqStart}–${reqEnd})`, assignedRig.machine_id);
      }

      allocations.push({
        bookingId,
        requestId: req.request_id,
        userId: req.user_id,
        studentName: req.student_name,
        rollNo: req.roll_no,
        machineId: assignedRig.machine_id,
        displayLabel: assignedRig.display_label || assignedRig.machine_id,
        blockCode: assignedRig.block_code || 'A',
        preferredMachineId: req.preferred_machine_id || null,
        preferenceHonored: preferenceRankHonored != null,
        preferenceRankHonored,
        slotName: req.eff_slot_name || `Custom (${reqStart} – ${reqEnd})`,
        bookingDate: targetDate,
        startTime: reqStart,
        endTime: reqEnd,
        timeSlot: `${reqStart} – ${reqEnd}`,
        durationMinutes: reqDuration,
        demandLevel: demandMetrics.demandLevel,
        demandRatio: demandMetrics.demandRatio,
        policyVersion: policy.policy_version || 'fairlab-v2',
        priorityScore: req.priority_score_snapshot
      });
    }

    // Update waitlisted candidates' wait time & position
    remainingWaitlist.forEach((req, idx) => {
      db.prepare('UPDATE booking_requests SET wait_time_seconds = wait_time_seconds + 300 WHERE request_id = ?').run(req.request_id);
      db.prepare(`
        UPDATE student_fairness SET cumulative_wait_seconds = cumulative_wait_seconds + 300
        WHERE user_id = ? AND semester_id = ?
      `).run(req.user_id, activeSem.semester_id);
      db.prepare(`
        UPDATE waitlist_entries SET position = ?, status = 'WAITING', updated_at = datetime('now')
        WHERE request_id = ?
      `).run(idx + 1, req.request_id);
    });

    db.prepare(`
      UPDATE allocation_rounds
      SET allocated_count = ?, waitlisted_count = ?, status = 'COMPLETED'
      WHERE round_id = ?
    `).run(allocations.length, remainingWaitlist.length, roundId);

    // Transactional Outbox entry committed atomically with allocation round
    db.prepare(`
      INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload, status)
      VALUES (?, 'allocation.completed', ?, ?, 'PENDING')
    `).run(
      `evt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      roundId,
      JSON.stringify({ roundId, bookingDate: targetDate, allocatedCount: allocations.length, waitlistedCount: remainingWaitlist.length })
    );
  }).immediate;

  matchTx();
  invalidateAvailabilityCache();

  // Resilient post-commit QR pass generation
  for (const alloc of allocations) {
    try {
      await generateAccessPass(
        alloc.bookingId,
        alloc.userId,
        alloc.rollNo,
        alloc.machineId,
        alloc.slotName,
        alloc.timeSlot
      );
    } catch (passErr) {
      console.warn(`[PassService] Deferred pass generation for booking ${alloc.bookingId}: ${passErr.message}`);
    }
  }

  return {
    roundId,
    allocatedCount: allocations.length,
    waitlistedCount: remainingWaitlist.length,
    bookingDate: targetDate,
    demandLevel: demandMetrics.demandLevel,
    demandRatio: demandMetrics.demandRatio,
    demandThreshold: demandMetrics.threshold,
    policyVersion: policy.policy_version || 'fairlab-v2',
    allocations
  };
}

/**
 * Backward-compatible wrapper for slot-based allocation rounds
 */
async function runAllocationRound(slotId, maxLimit = null, bookingDate = null) {
  return runWindowAllocationRound({ slotId, maxLimit, bookingDate });
}

/**
 * Autonomous Allocation Engine:
 * Continuously evaluates and resolves contested booking queues across all active slots and dates
 * using the institutional fairness formula (P = max(10, 100 - 5T - 8H)) and deterministic tie-breaking.
 * Eliminates the need for manual administrative queue commitments.
 */
async function autoProcessQueues({ broadcast = null } = {}) {
  const db = getDb();
  let totalAllocated = 0;
  let processedQueues = 0;

  try {
    const activeQueues = db.prepare(`
      SELECT DISTINCT booking_date, COALESCE(slot_id, 'custom') as slot_id,
             start_time, end_time
      FROM booking_requests
      WHERE status = 'QUEUED'
      ORDER BY booking_date ASC, start_time ASC
    `).all();

    if (!activeQueues || activeQueues.length === 0) {
      return { processedQueues: 0, totalAllocated: 0 };
    }

    for (const q of activeQueues) {
      try {
        const res = await runWindowAllocationRound({
          slotId: q.slot_id !== 'custom' ? q.slot_id : null,
          bookingDate: q.booking_date,
          startTime: q.start_time,
          endTime: q.end_time
        });

        processedQueues++;
        if (res && res.allocatedCount > 0) {
          totalAllocated += res.allocatedCount;
          if (broadcast) {
            broadcast('allocation.completed', {
              roundId: res.roundId,
              bookingDate: res.bookingDate,
              allocatedCount: res.allocatedCount,
              automated: true
            });
            broadcast('QUEUE_CHANGED', { bookingDate: res.bookingDate });
            broadcast('SLOT_UPDATED', { bookingDate: res.bookingDate });
          }
        }
      } catch (err) {
        console.warn(`[AutonomousEngine] Error auto-allocating queue for ${q.booking_date} (${q.start_time}–${q.end_time}):`, err.message);
      }
    }
  } catch (err) {
    console.warn('[AutonomousEngine] Error querying active queues:', err.message);
  }

  return { processedQueues, totalAllocated };
}

/**
 * Cancels a confirmed booking without penalizing points (Zero-Penalty Voluntary Cancellation Invariant)
 */
function cancelBooking(bookingId, userId, reason = 'Student voluntary cancellation') {
  const db = getDb();

  const cancelTx = db.transaction(() => {
    const booking = db.prepare(`
      SELECT b.*, p.pass_id, COALESCE(b.start_time, s.start_time) as eff_start
      FROM bookings b
      LEFT JOIN access_passes p ON b.booking_id = p.booking_id
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      WHERE b.booking_id = ?
    `).get(bookingId);

    if (!booking) throw new Error('Booking not found');

    // Ownership / RBAC authorization check (blocks cross-user IDOR booking cancellation!)
    const actor = db.prepare('SELECT user_id, role FROM users WHERE user_id = ?').get(userId);
    if (!actor || (booking.user_id !== userId && actor.role !== 'admin')) {
      const err = new Error('Forbidden: You can only cancel your own reservations.');
      err.statusCode = 403;
      throw err;
    }

    if (booking.status === 'COMPLETED' || booking.status === 'CHECKED_IN' || booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
      throw new Error(`Bookings with status "${booking.status}" cannot be cancelled`);
    }

    db.prepare("UPDATE bookings SET status = 'CANCELLED', cancelled_at = datetime('now') WHERE booking_id = ?").run(bookingId);
    if (booking.request_id) {
      db.prepare("UPDATE booking_requests SET status = 'CANCELLED' WHERE request_id = ?").run(booking.request_id);
    }
    if (booking.pass_id) {
      db.prepare("UPDATE access_passes SET status = 'REVOKED' WHERE pass_id = ?").run(booking.pass_id);
    }

    const otherActive = db.prepare(`
      SELECT booking_id FROM bookings
      WHERE machine_id = ? AND booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN') AND booking_id != ?
      LIMIT 1
    `).get(booking.machine_id, booking.booking_date, bookingId);

    if (!otherActive) {
      db.prepare(`
        UPDATE workstations
        SET status = CASE WHEN status = 'MAINTENANCE' THEN 'MAINTENANCE' ELSE 'AVAILABLE' END,
            current_user_id = NULL, active_job = NULL
        WHERE machine_id = ?
      `).run(booking.machine_id);
    }

    db.prepare(`
      INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'student', 'BOOKING_CANCELLED', 'bookings', ?, ?)
    `).run(
      `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId,
      'Student',
      bookingId,
      `Cancelled booking for ${booking.machine_id}. Reason: ${reason}`
    );

    db.prepare(`
      INSERT INTO notifications (notification_id, user_id, type, title, message)
      VALUES (?, ?, 'BOOKING_CANCELLED', ?, ?)
    `).run(
      `notif-cancel-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      booking.user_id,
      `Reservation Cancelled: ${booking.display_label || booking.machine_id}`,
      `Reservation on ${booking.booking_date} (${booking.eff_start || '10:00'}) was cancelled. Reason: ${reason}`
    );

    recordOutboxEvent('booking.cancelled', bookingId, {
      bookingId,
      userId: booking.user_id,
      machineId: booking.machine_id,
      bookingDate: booking.booking_date
    });

    return {
      success: true,
      bookingId,
      freedMachineId: booking.machine_id,
      slotId: booking.slot_id,
      bookingDate: booking.booking_date,
      penaltyApplied: 0
    };
  }).immediate;

  const res = cancelTx();
  invalidateAvailabilityCache();
  return res;
}

/**
 * Processes confirmed bookings that exceeded the grace period without check-in
 */
async function processNoShows({ bookingId = null, slotId = null, bookingDate = null, force = false, actorId = 'usr-admin-sharma' } = {}) {
  const db = getDb();
  const targetDate = bookingDate || getTodayDateString();
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    policy_version: 'fairlab-v2',
    base_score: 100,
    min_priority_floor: 10,
    deduction_per_hour: 5.0,
    high_demand_deduction_per_hour: 0.0,
    no_show_penalty: 5,
    grace_period_minutes: 15
  };

  let candidates = [];
  if (bookingId) {
    const b = db.prepare(`
      SELECT b.*, p.pass_id,
             COALESCE(b.start_time, s.start_time) as eff_start,
             COALESCE(b.end_time, s.end_time) as eff_end,
             u.name as student_name, u.roll_no
      FROM bookings b
      LEFT JOIN access_passes p ON b.booking_id = p.booking_id
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      JOIN users u ON b.user_id = u.user_id
      WHERE b.booking_id = ? AND b.status = 'CONFIRMED'
    `).get(bookingId);
    if (b) candidates = [b];
  } else {
    const query = slotId
      ? `SELECT b.*, p.pass_id, COALESCE(b.start_time, s.start_time) as eff_start, COALESCE(b.end_time, s.end_time) as eff_end, u.name as student_name, u.roll_no
         FROM bookings b LEFT JOIN access_passes p ON b.booking_id = p.booking_id LEFT JOIN lab_slots s ON b.slot_id = s.slot_id JOIN users u ON b.user_id = u.user_id
         WHERE b.slot_id = ? AND b.booking_date = ? AND b.status = 'CONFIRMED'`
      : `SELECT b.*, p.pass_id, COALESCE(b.start_time, s.start_time) as eff_start, COALESCE(b.end_time, s.end_time) as eff_end, u.name as student_name, u.roll_no
         FROM bookings b LEFT JOIN access_passes p ON b.booking_id = p.booking_id LEFT JOIN lab_slots s ON b.slot_id = s.slot_id JOIN users u ON b.user_id = u.user_id
         WHERE b.booking_date = ? AND b.status = 'CONFIRMED'`;

    candidates = slotId ? db.prepare(query).all(slotId, targetDate) : db.prepare(query).all(targetDate);
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const grace = Number(policy.grace_period_minutes) || 15;
  const penalty = policy.no_show_penalty != null ? Number(policy.no_show_penalty) : 5;

  const processed = [];
  const affectedWindows = new Map();

  const tx = db.transaction(() => {
    for (const b of candidates) {
      const slotStartMin = parseTimeToMinutes(b.eff_start || '09:00');
      const isPastGrace = force || (b.booking_date < getTodayDateString()) || (b.booking_date === getTodayDateString() && nowMinutes >= slotStartMin + grace);
      if (!isPastGrace) continue;

      db.prepare("UPDATE bookings SET status = 'NO_SHOW' WHERE booking_id = ?").run(b.booking_id);
      if (b.pass_id) {
        db.prepare("UPDATE access_passes SET status = 'EXPIRED' WHERE pass_id = ?").run(b.pass_id);
      }

      const otherActive = db.prepare(`
        SELECT booking_id FROM bookings
        WHERE machine_id = ? AND booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN') AND booking_id != ?
        LIMIT 1
      `).get(b.machine_id, b.booking_date, b.booking_id);

      if (!otherActive) {
        db.prepare(`
          UPDATE workstations
          SET status = CASE WHEN status = 'MAINTENANCE' THEN 'MAINTENANCE' ELSE 'AVAILABLE' END,
              current_user_id = NULL, active_job = NULL
          WHERE machine_id = ?
        `).run(b.machine_id);
      }

      const sf = db.prepare('SELECT * FROM student_fairness WHERE user_id = ? AND semester_id = ?').get(b.user_id, b.semester_id);
      let scoreBefore = sf ? sf.current_score : policy.base_score;
      let scoreAfter = scoreBefore;
      if (sf) {
        const newPenalty = (sf.penalty_points || 0) + penalty;
        scoreAfter = calculateHoursDemandScore({
          baseScore: policy.base_score,
          minFloor: policy.min_priority_floor || 10,
          totalHoursUsed: sf.total_hours_used || 0,
          highDemandHours: sf.high_demand_hours || 0,
          deductionPerHour: policy.deduction_per_hour != null ? Number(policy.deduction_per_hour) : 5,
          highDemandDeductionPerHour: policy.high_demand_deduction_per_hour != null ? Number(policy.high_demand_deduction_per_hour) : 0,
          penaltyPoints: newPenalty
        });
        db.prepare(`
          UPDATE student_fairness
          SET penalty_points = ?, current_score = ?, updated_at = datetime('now')
          WHERE user_id = ? AND semester_id = ?
        `).run(newPenalty, scoreAfter, b.user_id, b.semester_id);
      }

      db.prepare(`
        INSERT INTO allocation_history (
          allocation_id, user_id, semester_id, booking_id, machine_id, slot_id,
          demand_level, demand_ratio, duration_hours, policy_version, completed, score_before, score_after, reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        `alloc-ns-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        b.user_id,
        b.semester_id,
        b.booking_id,
        b.machine_id,
        b.slot_id,
        b.demand_level || 'NORMAL',
        b.demand_ratio || 0,
        (Number(b.duration_minutes) || 60) / 60,
        policy.policy_version || 'fairlab-v2',
        scoreBefore,
        scoreAfter,
        `Confirmed NO_SHOW after ${grace}m grace period on ${b.machine_id}. -${penalty} penalty pts applied.`
      );

      db.prepare(`
        INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
        VALUES (?, ?, 'FairLab Scheduler', 'admin', 'NO_SHOW_RECOVERY', 'bookings', ?, ?)
      `).run(
        `audit-ns-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        actorId,
        b.booking_id,
        `Released ${b.machine_id} from ${b.student_name} (${b.roll_no}) after ${grace}m grace period. Penalty -${penalty} pts.`
      );

      processed.push({
        bookingId: b.booking_id,
        userId: b.user_id,
        studentName: b.student_name,
        freedMachineId: b.machine_id,
        slotId: b.slot_id,
        bookingDate: b.booking_date,
        penaltyApplied: penalty,
        scoreBefore,
        scoreAfter
      });
      affectedWindows.set(`${b.slot_id || 'custom'}::${b.booking_date}::${b.eff_start}::${b.eff_end}`, {
        slotId: b.slot_id,
        bookingDate: b.booking_date,
        startTime: b.eff_start,
        endTime: b.eff_end
      });
    }
  }).immediate;

  tx();
  invalidateAvailabilityCache();

  const promotions = [];
  for (const win of affectedWindows.values()) {
    const roundRes = await runWindowAllocationRound(win);
    if (roundRes.allocatedCount > 0) {
      promotions.push(...roundRes.allocations);
    }
  }

  return {
    noShowCount: processed.length,
    processed,
    promotedCount: promotions.length,
    promotions
  };
}

/**
 * Returns ranked queue for a slot or date (with all ranked preferences attached)
 */
function getQueueForSlot(slotId, bookingDate = null) {
  const db = getDb();
  const activeSem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();
  const semId = activeSem ? activeSem.semester_id : '';

  const requests = bookingDate
    ? db.prepare(`
        SELECT r.*, u.name as student_name, u.roll_no, u.department, u.avatar_url,
               sf.current_score, sf.booking_count, sf.total_hours_used, sf.high_demand_count, sf.high_demand_hours,
               w.display_label as preferred_label,
               COALESCE(r.start_time, s.start_time) as eff_start,
               COALESCE(r.end_time, s.end_time) as eff_end
        FROM booking_requests r
        JOIN users u ON r.user_id = u.user_id
        LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
        LEFT JOIN student_fairness sf ON (r.user_id = sf.user_id AND sf.semester_id = ?)
        LEFT JOIN workstations w ON r.preferred_machine_id = w.machine_id
        WHERE (r.slot_id = ? OR ? = 'ALL') AND r.booking_date = ? AND r.status IN ('QUEUED', 'ALLOCATED')
        ORDER BY r.requested_at ASC
      `).all(semId, slotId, slotId, bookingDate)
    : db.prepare(`
        SELECT r.*, u.name as student_name, u.roll_no, u.department, u.avatar_url,
               sf.current_score, sf.booking_count, sf.total_hours_used, sf.high_demand_count, sf.high_demand_hours,
               w.display_label as preferred_label,
               COALESCE(r.start_time, s.start_time) as eff_start,
               COALESCE(r.end_time, s.end_time) as eff_end
        FROM booking_requests r
        JOIN users u ON r.user_id = u.user_id
        LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
        LEFT JOIN student_fairness sf ON (r.user_id = sf.user_id AND sf.semester_id = ?)
        LEFT JOIN workstations w ON r.preferred_machine_id = w.machine_id
        WHERE (r.slot_id = ? OR ? = 'ALL') AND r.status IN ('QUEUED', 'ALLOCATED')
        ORDER BY r.requested_at ASC
      `).all(semId, slotId, slotId);

  const prefStmt = db.prepare(`
    SELECT bp.preference_rank, bp.machine_id, w.display_label
    FROM booking_preferences bp
    JOIN workstations w ON bp.machine_id = w.machine_id
    WHERE bp.request_id = ? ORDER BY bp.preference_rank ASC
  `);

  const withPrefs = requests.map(r => ({
    ...r,
    preferences: prefStmt.all(r.request_id)
  }));

  const queuedOnly = withPrefs.filter(r => r.status === 'QUEUED');
  const ranked = rankBookingRequests(queuedOnly);

  const allocated = withPrefs.filter(r => r.status === 'ALLOCATED').map(r => ({
    ...r,
    queue_rank: 0,
    tie_break_reason: 'Allocated Workstation'
  }));

  return [...allocated, ...ranked];
}

/**
 * Transactional Outbox Publisher (Atomic Claim + At-Least-Once Delivery + Idempotent Event IDs):
 * Atomically claims PENDING events (`WHERE status = 'PENDING'`) so multiple replicas cannot
 * double-process the same pending row, emits them via WebSocket broadcast tagged with `eventId`,
 * and supports cross-replica event tailing via `tailOutboxEventsSince`.
 */
function publishPendingOutboxEvents(broadcastFn) {
  if (typeof broadcastFn !== 'function') return 0;
  const db = getDb();
  const pending = db.prepare(`
    SELECT event_id, event_type, payload
    FROM outbox_events
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT 100
  `).all();

  if (pending.length === 0) return 0;

  const claimStmt = db.prepare("UPDATE outbox_events SET status = 'PUBLISHED' WHERE event_id = ? AND status = 'PENDING'");
  const revertStmt = db.prepare("UPDATE outbox_events SET status = 'PENDING' WHERE event_id = ?");
  let count = 0;
  for (const evt of pending) {
    const claimed = claimStmt.run(evt.event_id);
    if (claimed.changes !== 1) continue; // Another replica already claimed this event
    try {
      const parsed = JSON.parse(evt.payload);
      broadcastFn(evt.event_type, { ...parsed, eventId: evt.event_id }, { eventId: evt.event_id });
      count++;
    } catch {
      revertStmt.run(evt.event_id); // Revert to PENDING for next retry sweep
    }
  }
  return count;
}

function getLatestOutboxRowId() {
  const db = getDb();
  const row = db.prepare('SELECT COALESCE(MAX(rowid), 0) AS maxId FROM outbox_events').get();
  return row ? Number(row.maxId) : 0;
}

/**
 * Cross-Replica Outbox Tailer:
 * Allows every backend replica sharing the database to observe newly committed events
 * from sibling replicas within ~1s, invalidate its local availability cache, and fan out
 * WebSocket updates to clients connected to that replica (deduplicated by `eventId`).
 */
function tailOutboxEventsSince(lastRowId, broadcastFn) {
  if (typeof broadcastFn !== 'function') return lastRowId;
  const db = getDb();
  const rows = db.prepare(`
    SELECT rowid, event_id, event_type, payload
    FROM outbox_events
    WHERE rowid > ?
    ORDER BY rowid ASC
    LIMIT 100
  `).all(lastRowId);

  if (rows.length === 0) return lastRowId;

  let cursor = lastRowId;
  invalidateAvailabilityCache();
  for (const evt of rows) {
    cursor = Number(evt.rowid);
    try {
      const parsed = JSON.parse(evt.payload);
      broadcastFn(evt.event_type, { ...parsed, eventId: evt.event_id }, { eventId: evt.event_id });
    } catch {
      // ignore malformed historical row
    }
  }
  return cursor;
}

/**
 * Persists an event into `outbox_events` so it is durably committed and
 * propagated across all backend replicas via the cross-replica outbox tailer.
 */
function recordOutboxEvent(eventType, aggregateId, payload = {}, dbInstance = null) {
  const db = dbInstance || getDb();
  const eventId = `evt-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const fullPayload = { ...payload, eventId, timestamp: new Date().toISOString() };
  try {
    db.prepare(`
      INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload, status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `).run(eventId, eventType, String(aggregateId || 'system'), JSON.stringify(fullPayload));
  } catch (err) {
    console.error('Failed to insert outbox event:', err.message);
  }
  return { eventId, fullPayload };
}

module.exports = {
  submitBookingRequest,
  submitHybridBookingRequest,
  cancelBookingRequest,
  runAllocationRound,
  runWindowAllocationRound,
  autoProcessQueues,
  cancelBooking,
  processNoShows,
  getQueueForSlot,
  publishPendingOutboxEvents,
  getLatestOutboxRowId,
  tailOutboxEventsSince,
  recordOutboxEvent
};
