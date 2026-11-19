const { getDb } = require('../db/database');
const { parseTimeToMinutes, formatMinutesToTime, getTodayDateString, getCurrentTimeMinutes } = require('../db/seed');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayOfWeek(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}

function intervalsOverlap(s1, e1, s2, e2) {
  return parseTimeToMinutes(s1) < parseTimeToMinutes(e2) && parseTimeToMinutes(s2) < parseTimeToMinutes(e1);
}

function intervalCovers(outerStart, outerEnd, innerStart, innerEnd) {
  return parseTimeToMinutes(outerStart) <= parseTimeToMinutes(innerStart) &&
    parseTimeToMinutes(outerEnd) >= parseTimeToMinutes(innerEnd);
}

function logScheduleAudit(db, actorId, action, targetType, targetId, details) {
  const actor = db.prepare('SELECT name, role FROM users WHERE user_id = ?').get(actorId) || {
    name: 'Lab Coordinator',
    role: 'admin'
  };
  db.prepare(`
    INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    actorId || 'usr-admin-sharma',
    actor.name,
    actor.role,
    action,
    targetType,
    targetId,
    details
  );
}

/**
 * Computes effective day schedule for Lab L-106 on a given YYYY-MM-DD date:
 *  - Holidays / Extra Days / Custom Hours overrides
 *  - Active Monday–Friday Academic Lab Timetable blocks (unless ignore_timetable=1)
 *  - Admin Ticket Releases & remaining ticket counts
 */
function getEffectiveDaySchedule(labId = 'lab-l106', dateStr, policy = null) {
  const db = getDb();
  const pol = policy || db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    lab_open_time: '09:00',
    lab_close_time: '18:00',
    min_duration_minutes: 30,
    max_duration_minutes: 120,
    max_daily_hours: 2.0,
    require_ticket_release: 0
  };

  const dayOfWeek = getDayOfWeek(dateStr);
  const dayName = DAY_NAMES[dayOfWeek];

  const override = db.prepare(`
    SELECT * FROM lab_date_overrides
    WHERE lab_id = ? AND override_date = ?
    LIMIT 1
  `).get(labId, dateStr) || null;

  let isOpen = true;
  let openTime = pol.lab_open_time || '09:00';
  let closeTime = pol.lab_close_time || '18:00';
  let ignoreTimetable = false;
  let closureReason = null;

  if (override) {
    if (override.override_type === 'HOLIDAY' || override.is_open === 0) {
      isOpen = false;
      closureReason = override.reason || 'Institute Holiday';
    } else {
      isOpen = true;
      if (override.open_time) openTime = override.open_time;
      if (override.close_time) closeTime = override.close_time;
      ignoreTimetable = Boolean(override.ignore_timetable);
    }
  }

  const blockedSessions = (!isOpen || ignoreTimetable)
    ? []
    : db.prepare(`
        SELECT entry_id, day_of_week, start_time, end_time, title, course_code, instructor
        FROM lab_timetable
        WHERE lab_id = ? AND day_of_week = ? AND is_active = 1
        ORDER BY start_time ASC
      `).all(labId, dayOfWeek);

  const rawReleases = db.prepare(`
    SELECT * FROM ticket_releases
    WHERE lab_id = ? AND release_date = ?
    ORDER BY start_time ASC, created_at DESC
  `).all(labId, dateStr);

  const ticketReleases = rawReleases.map(rel => {
    // Count distinct machines currently booked in this release window (concurrent capacity view)
    const bookedRow = db.prepare(`
      SELECT COUNT(DISTINCT b.machine_id) as cnt
      FROM bookings b
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      WHERE b.booking_date = ?
        AND b.status IN ('CONFIRMED', 'CHECKED_IN')
        AND COALESCE(b.start_time, s.start_time) < ?
        AND ? < COALESCE(b.end_time, s.end_time)
    `).get(dateStr, rel.end_time, rel.start_time);

    const claimed = Number(bookedRow?.cnt || 0);
    const total = Number(rel.total_tickets || 84);
    return {
      ...rel,
      claimed_tickets: claimed,
      remaining_tickets: Math.max(0, total - claimed)
    };
  });

  return {
    date: dateStr,
    dayOfWeek,
    dayName,
    isOpen,
    closureReason,
    openTime,
    closeTime,
    override,
    blockedSessions,
    requireTicketRelease: Boolean(pol.require_ticket_release),
    ticketReleases,
    maxDurationMinutes: Math.min(120, Number(pol.max_duration_minutes || 120))
  };
}

/**
 * Evaluates whether a specific [startTime, endTime) interval on dateStr is bookable
 * against Holidays, Extra Day Hours, Mon–Fri Academic Timetable, Max 2h Limit, and Ticket Releases.
 * Returns { allowed: true, daySchedule, matchingRelease } OR { allowed: false, code, reason, daySchedule }.
 */
function checkIntervalScheduleStatus(labId, dateStr, startTime, endTime, policy = null, { isExplicitSlot = false, bypassPastCheck = false } = {}) {
  const daySchedule = getEffectiveDaySchedule(labId, dateStr, policy);

  // 0. Past Date Check
  const todayStr = getTodayDateString();
  if (!bypassPastCheck && dateStr < todayStr) {
    return {
      allowed: false,
      code: 'PAST_DATE',
      reason: `Cannot book workstations for past date (${dateStr}). Please select today or an upcoming date.`,
      daySchedule
    };
  }

  // 1. Holiday / Closed Day check
  if (!daySchedule.isOpen) {
    return {
      allowed: false,
      code: 'LAB_CLOSED_HOLIDAY',
      reason: `Lab L-106 is closed on ${dateStr} (${daySchedule.closureReason || 'Holiday'}).`,
      daySchedule
    };
  }

  // 2. Operating Hours & Strict 2-Hour Duration Limit
  const sMin = parseTimeToMinutes(startTime);
  const eMin = parseTimeToMinutes(endTime);
  const openMin = parseTimeToMinutes(daySchedule.openTime);
  const closeMin = parseTimeToMinutes(daySchedule.closeTime);

  // Check if date is today and interval or operating day has already elapsed
  if (!bypassPastCheck && dateStr === todayStr) {
    const nowMin = getCurrentTimeMinutes();
    if (nowMin >= closeMin) {
      return {
        allowed: false,
        code: 'LAB_CLOSED_FOR_TODAY',
        reason: `Lab L-106 operating hours for today (${daySchedule.openTime}–${daySchedule.closeTime}) have concluded. Please select tomorrow or an upcoming date.`,
        daySchedule
      };
    }
    if (eMin <= nowMin) {
      return {
        allowed: false,
        code: 'PAST_TIME_INTERVAL',
        reason: `Requested interval ${startTime}–${endTime} has already passed for today. Please select an upcoming interval.`,
        daySchedule
      };
    }
    // Reservations are prospective; do not allow even a short retroactive start.
    if (sMin < nowMin) {
      return {
        allowed: false,
        code: 'PAST_START_TIME',
        reason: `Requested start time ${startTime} has already passed for today. Please select a time starting after ${formatMinutesToTime(nowMin)}.`,
        daySchedule
      };
    }
  }

  if (eMin <= sMin) {
    return {
      allowed: false,
      code: 'INVALID_INTERVAL',
      reason: `End time (${endTime}) must be after start time (${startTime}).`,
      daySchedule
    };
  }

  if (!isExplicitSlot && (sMin < openMin || eMin > closeMin)) {
    return {
      allowed: false,
      code: 'OUTSIDE_HOURS',
      reason: `Interval ${startTime}–${endTime} is outside Lab L-106 hours on ${dateStr} (${daySchedule.openTime}–${daySchedule.closeTime}).`,
      daySchedule
    };
  }

  const durMins = eMin - sMin;
  const maxDur = daySchedule.maxDurationMinutes;
  if (durMins > maxDur) {
    return {
      allowed: false,
      code: 'MAX_DURATION_EXCEEDED',
      reason: `Maximum booking limit is ${Math.round(maxDur / 60 * 10) / 10} hours (${maxDur} min). Requested interval is ${durMins} min.`,
      daySchedule
    };
  }

  // 3. Mon–Fri Academic Lab Timetable overlap check
  const academicConflict = daySchedule.blockedSessions.find(cls =>
    intervalsOverlap(startTime, endTime, cls.start_time, cls.end_time)
  );
  if (academicConflict) {
    const label = academicConflict.course_code
      ? `${academicConflict.course_code} · ${academicConflict.title}`
      : academicConflict.title;
    return {
      allowed: false,
      code: 'ACADEMIC_LAB_BLOCKED',
      reason: `Blocked for academic lab session: ${label} (${academicConflict.start_time}–${academicConflict.end_time}). Please select another interval.`,
      conflict: academicConflict,
      daySchedule
    };
  }

  // 4. Admin Ticket Release checks
  const coveringReleases = daySchedule.ticketReleases.filter(rel =>
    intervalCovers(rel.start_time, rel.end_time, startTime, endTime)
  );
  const activeRelease = coveringReleases.find(r => r.status === 'RELEASED') || null;
  const blockedRelease = coveringReleases.find(r => r.status === 'PAUSED' || r.status === 'CLOSED') || null;

  if (!activeRelease && blockedRelease) {
    return {
      allowed: false,
      code: 'TICKETS_PAUSED_OR_CLOSED',
      reason: `Tickets for "${blockedRelease.title}" (${dateStr}, ${blockedRelease.start_time}–${blockedRelease.end_time}) are currently ${blockedRelease.status.toLowerCase()} by the Lab Admin.`,
      daySchedule
    };
  }

  if (daySchedule.requireTicketRelease && !activeRelease) {
    return {
      allowed: false,
      code: 'TICKETS_NOT_RELEASED',
      reason: `Tickets for ${dateStr} (${startTime}–${endTime}) have not been released by the Lab Admin yet.`,
      daySchedule
    };
  }

  if (activeRelease) {
    // Enforce concurrent ticket quota for the requested [startTime, endTime) interval
    const db = getDb();
    const intervalClaimed = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM bookings b
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      WHERE b.booking_date = ?
        AND b.status IN ('CONFIRMED', 'CHECKED_IN')
        AND COALESCE(b.start_time, s.start_time) < ?
        AND ? < COALESCE(b.end_time, s.end_time)
    `).get(dateStr, endTime, startTime);

    const claimedInInterval = Number(intervalClaimed?.cnt || 0);
    const remainingInInterval = Math.max(0, Number(activeRelease.total_tickets || 84) - claimedInInterval);
    const enrichedRelease = {
      ...activeRelease,
      claimed_tickets: claimedInInterval,
      remaining_tickets: remainingInInterval
    };

    if (remainingInInterval <= 0) {
      return {
        allowed: false,
        code: 'TICKETS_SOLD_OUT',
        reason: `All ${activeRelease.total_tickets} released tickets for "${activeRelease.title}" (${startTime}–${endTime}) have been booked.`,
        daySchedule,
        matchingRelease: enrichedRelease
      };
    }

    return {
      allowed: true,
      code: 'OPEN',
      reason: null,
      daySchedule,
      matchingRelease: enrichedRelease
    };
  }

  return {
    allowed: true,
    code: 'OPEN',
    reason: null,
    daySchedule,
    matchingRelease: null
  };
}

// ---------- Admin CRUD: Mon–Fri Timetable ----------
function listTimetable(labId = 'lab-l106') {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM lab_timetable
    WHERE lab_id = ?
    ORDER BY day_of_week ASC, start_time ASC
  `).all(labId);
}

function createTimetableEntry({ labId = 'lab-l106', dayOfWeek, startTime, endTime, title, courseCode = '', instructor = '', actorId = 'usr-admin-sharma' }) {
  if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
    throw new Error('Class end time must be after start time.');
  }
  const db = getDb();
  const entryId = `tt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO lab_timetable (entry_id, lab_id, day_of_week, start_time, end_time, title, course_code, instructor, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(entryId, labId, Number(dayOfWeek), startTime, endTime, title.trim(), courseCode.trim(), instructor.trim());

  logScheduleAudit(db, actorId, 'TIMETABLE_ADD', 'lab_timetable', entryId,
    `Added academic lab block: ${DAY_NAMES[dayOfWeek]} ${startTime}–${endTime} (${courseCode ? `${courseCode} ` : ''}${title})`);

  return db.prepare('SELECT * FROM lab_timetable WHERE entry_id = ?').get(entryId);
}

function updateTimetableEntry(entryId, updates, actorId = 'usr-admin-sharma') {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM lab_timetable WHERE entry_id = ?').get(entryId);
  if (!existing) throw new Error('Timetable entry not found.');

  const startTime = updates.startTime ?? existing.start_time;
  const endTime = updates.endTime ?? existing.end_time;
  if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
    throw new Error('Class end time must be after start time.');
  }
  const dayOfWeek = updates.dayOfWeek != null ? Number(updates.dayOfWeek) : existing.day_of_week;
  const title = updates.title != null ? String(updates.title).trim() : existing.title;
  const courseCode = updates.courseCode != null ? String(updates.courseCode).trim() : existing.course_code;
  const instructor = updates.instructor != null ? String(updates.instructor).trim() : existing.instructor;
  const isActive = updates.isActive != null ? (updates.isActive ? 1 : 0) : existing.is_active;

  db.prepare(`
    UPDATE lab_timetable
    SET day_of_week = ?, start_time = ?, end_time = ?, title = ?, course_code = ?, instructor = ?, is_active = ?
    WHERE entry_id = ?
  `).run(dayOfWeek, startTime, endTime, title, courseCode, instructor, isActive, entryId);

  logScheduleAudit(db, actorId, 'TIMETABLE_UPDATE', 'lab_timetable', entryId,
    `Updated ${DAY_NAMES[dayOfWeek]} ${startTime}–${endTime} (${title}) [active=${isActive}]`);

  return db.prepare('SELECT * FROM lab_timetable WHERE entry_id = ?').get(entryId);
}

function deleteTimetableEntry(entryId, actorId = 'usr-admin-sharma') {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM lab_timetable WHERE entry_id = ?').get(entryId);
  if (!existing) throw new Error('Timetable entry not found.');
  db.prepare('DELETE FROM lab_timetable WHERE entry_id = ?').run(entryId);
  logScheduleAudit(db, actorId, 'TIMETABLE_DELETE', 'lab_timetable', entryId,
    `Removed academic lab block: ${DAY_NAMES[existing.day_of_week]} ${existing.start_time}–${existing.end_time} (${existing.title})`);
  return { deleted: true, entryId };
}

// ---------- Admin CRUD: Date Overrides (Holidays / Extra Days / Custom Hours) ----------
function listDateOverrides(labId = 'lab-l106') {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM lab_date_overrides
    WHERE lab_id = ?
    ORDER BY override_date ASC
  `).all(labId);
}

function upsertDateOverride({
  labId = 'lab-l106',
  overrideDate,
  overrideType,
  isOpen = false,
  openTime = null,
  closeTime = null,
  ignoreTimetable = false,
  reason,
  actorId = 'usr-admin-sharma'
}) {
  if (overrideType !== 'HOLIDAY' && openTime && closeTime) {
    if (parseTimeToMinutes(closeTime) <= parseTimeToMinutes(openTime)) {
      throw new Error('Custom close time must be after open time.');
    }
  }
  const db = getDb();
  const effectiveOpen = overrideType === 'HOLIDAY' ? 0 : (isOpen ? 1 : 1);
  const overrideId = `ovr-${overrideDate}`;
  db.prepare(`
    INSERT INTO lab_date_overrides
      (override_id, lab_id, override_date, override_type, is_open, open_time, close_time, ignore_timetable, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(override_date) DO UPDATE SET
      override_type = excluded.override_type,
      is_open = excluded.is_open,
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      ignore_timetable = excluded.ignore_timetable,
      reason = excluded.reason,
      created_by = excluded.created_by
  `).run(
    overrideId,
    labId,
    overrideDate,
    overrideType,
    effectiveOpen,
    overrideType === 'HOLIDAY' ? null : (openTime || '09:00'),
    overrideType === 'HOLIDAY' ? null : (closeTime || '18:00'),
    ignoreTimetable ? 1 : 0,
    reason.trim(),
    actorId
  );

  logScheduleAudit(db, actorId, 'DATE_OVERRIDE_SAVE', 'lab_date_overrides', overrideDate,
    `Set ${overrideType} on ${overrideDate}: ${reason}${overrideType !== 'HOLIDAY' ? ` (${openTime || '09:00'}–${closeTime || '18:00'})` : ' (Lab Closed)'}`);

  return db.prepare('SELECT * FROM lab_date_overrides WHERE override_date = ?').get(overrideDate);
}

function deleteDateOverride(overrideDate, actorId = 'usr-admin-sharma') {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM lab_date_overrides WHERE override_date = ?').get(overrideDate);
  if (!existing) throw new Error('Date override not found.');
  db.prepare('DELETE FROM lab_date_overrides WHERE override_date = ?').run(overrideDate);
  logScheduleAudit(db, actorId, 'DATE_OVERRIDE_DELETE', 'lab_date_overrides', overrideDate,
    `Removed ${existing.override_type} override for ${overrideDate}`);
  return { deleted: true, overrideDate };
}

// ---------- Admin CRUD: Ticket Releases ----------
function listTicketReleases(labId = 'lab-l106') {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM ticket_releases
    WHERE lab_id = ?
    ORDER BY release_date ASC, start_time ASC
  `).all(labId);

  return rows.map(rel => {
    const bookedRow = db.prepare(`
      SELECT COUNT(DISTINCT b.machine_id) as cnt
      FROM bookings b
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      WHERE b.booking_date = ?
        AND b.status IN ('CONFIRMED', 'CHECKED_IN')
        AND COALESCE(b.start_time, s.start_time) < ?
        AND ? < COALESCE(b.end_time, s.end_time)
    `).get(rel.release_date, rel.end_time, rel.start_time);

    const claimed = Number(bookedRow?.cnt || 0);
    return {
      ...rel,
      claimed_tickets: claimed,
      remaining_tickets: Math.max(0, Number(rel.total_tickets || 84) - claimed)
    };
  });
}

function createTicketRelease({
  labId = 'lab-l106',
  releaseDate,
  startTime = '09:00',
  endTime = '18:00',
  title = 'Lab L-106 Open Access Tickets',
  totalTickets = 84,
  status = 'RELEASED',
  actorId = 'usr-admin-sharma'
}) {
  if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
    throw new Error('Ticket window end time must be after start time.');
  }
  const db = getDb();
  const releaseId = `rel-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO ticket_releases (release_id, lab_id, release_date, start_time, end_time, title, total_tickets, status, released_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(releaseId, labId, releaseDate, startTime, endTime, title.trim(), Number(totalTickets), status, actorId);

  logScheduleAudit(db, actorId, 'TICKET_RELEASE_CREATE', 'ticket_releases', releaseId,
    `Created ticket release "${title}" on ${releaseDate} (${startTime}–${endTime}, ${totalTickets} tickets, status=${status})`);

  return db.prepare('SELECT * FROM ticket_releases WHERE release_id = ?').get(releaseId);
}

function updateTicketReleaseStatus(releaseId, { status, totalTickets, title }, actorId = 'usr-admin-sharma') {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM ticket_releases WHERE release_id = ?').get(releaseId);
  if (!existing) throw new Error('Ticket release not found.');

  const nextStatus = status || existing.status;
  const nextTotal = totalTickets != null ? Number(totalTickets) : existing.total_tickets;
  const nextTitle = title != null ? String(title).trim() : existing.title;

  db.prepare(`
    UPDATE ticket_releases
    SET status = ?, total_tickets = ?, title = ?, released_at = CASE WHEN ? = 'RELEASED' THEN datetime('now') ELSE released_at END
    WHERE release_id = ?
  `).run(nextStatus, nextTotal, nextTitle, nextStatus, releaseId);

  logScheduleAudit(db, actorId, 'TICKET_RELEASE_UPDATE', 'ticket_releases', releaseId,
    `Updated ticket release "${nextTitle}" (${existing.release_date}) -> status=${nextStatus}, quota=${nextTotal}`);

  return db.prepare('SELECT * FROM ticket_releases WHERE release_id = ?').get(releaseId);
}

function deleteTicketRelease(releaseId, actorId = 'usr-admin-sharma') {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM ticket_releases WHERE release_id = ?').get(releaseId);
  if (!existing) throw new Error('Ticket release not found.');
  db.prepare('DELETE FROM ticket_releases WHERE release_id = ?').run(releaseId);
  logScheduleAudit(db, actorId, 'TICKET_RELEASE_DELETE', 'ticket_releases', releaseId,
    `Deleted ticket release "${existing.title}" on ${existing.release_date}`);
  return { deleted: true, releaseId };
}

module.exports = {
  DAY_NAMES,
  getDayOfWeek,
  getEffectiveDaySchedule,
  checkIntervalScheduleStatus,
  listTimetable,
  createTimetableEntry,
  updateTimetableEntry,
  deleteTimetableEntry,
  listDateOverrides,
  upsertDateOverride,
  deleteDateOverride,
  listTicketReleases,
  createTicketRelease,
  updateTicketReleaseStatus,
  deleteTicketRelease
};
