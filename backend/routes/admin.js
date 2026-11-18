const express = require('express');
const router = express.Router();
const { validateBody, z } = require('../middleware/validation');
const { requireAdmin } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { executeSemesterReset, getFairnessLeaderboard } = require('../services/fairnessEngine');
const { getFairnessScoreSpectrum, getVramHoursByField } = require('../services/analyticsService');
const { toggleWorkstationMaintenance } = require('../services/gpuResourceService');
const {
  runAllocationRound,
  runWindowAllocationRound,
  processNoShows,
  publishPendingOutboxEvents
} = require('../services/bookingService');
const { syncLabSlotsFromPolicy, getLabAvailability, invalidateAvailabilityCache } = require('../services/availabilityService');
const {
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
} = require('../services/scheduleService');
const { generateAccessPass } = require('../services/passService');
const { getTodayDateString, parseTimeToMinutes } = require('../db/seed');

// Get Policy
router.get('/policy', (req, res) => {
  const db = getDb();
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get();
  res.json(policy);
});

const policyUpdateSchema = z.object({
  policy_version: z.string().min(2).max(32).optional(),
  base_score: z.number().int().min(50).max(200),
  min_priority_floor: z.number().int().min(0).max(50).optional(),
  deduction_per_booking: z.number().int().min(1).max(50).optional(),
  deduction_per_hour: z.number().min(0.5).max(50).optional(),
  high_demand_deduction_per_hour: z.number().min(0).max(50).optional(),
  high_demand_threshold: z.number().min(1.0).max(10.0).optional(),
  no_show_penalty: z.number().int().min(0).max(100),
  cancellation_window_hours: z.number().min(0.5).max(24),
  grace_period_minutes: z.number().int().min(0).max(60),
  lab_open_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  lab_close_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  slot_interval_minutes: z.number().int().min(15).max(240).optional(),
  min_duration_minutes: z.number().int().min(15).max(120).optional(),
  max_duration_minutes: z.number().int().min(30).max(120).optional(),
  cutoff_minutes_before_start: z.number().int().min(0).max(120).optional(),
  max_preferences_per_request: z.number().int().min(1).max(5).optional(),
  max_daily_hours: z.number().min(0.5).max(12).optional(),
  max_daily_bookings: z.number().int().min(1).max(12).optional(),
  require_ticket_release: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional()
});

// Update Policy & sync configurable lab schedule intervals (Admin RBAC enforced)
router.put('/policy', requireAdmin, validateBody(policyUpdateSchema), (req, res) => {
  const actorId = req.user.user_id;
  const db = getDb();

  const current = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {};
  const openTime = req.body.lab_open_time || current.lab_open_time || '09:00';
  const closeTime = req.body.lab_close_time || current.lab_close_time || '18:00';
  const intervalMins = req.body.slot_interval_minutes != null ? req.body.slot_interval_minutes : (current.slot_interval_minutes || 60);

  if (parseTimeToMinutes(closeTime) <= parseTimeToMinutes(openTime)) {
    return res.status(400).json({ error: 'Lab close time must be later than lab open time.' });
  }

  const scheduleChanged =
    openTime !== current.lab_open_time ||
    closeTime !== current.lab_close_time ||
    intervalMins !== current.slot_interval_minutes;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE policy_config
      SET policy_version = ?,
          base_score = ?,
          min_priority_floor = ?,
          deduction_per_booking = ?,
          deduction_per_hour = ?,
          high_demand_deduction_per_hour = ?,
          high_demand_threshold = ?,
          no_show_penalty = ?,
          cancellation_window_hours = ?,
          grace_period_minutes = ?,
          lab_open_time = ?,
          lab_close_time = ?,
          slot_interval_minutes = ?,
          min_duration_minutes = ?,
          max_duration_minutes = ?,
          cutoff_minutes_before_start = ?,
          max_preferences_per_request = ?,
          max_daily_hours = ?,
          max_daily_bookings = ?,
          require_ticket_release = ?,
          updated_at = datetime('now')
      WHERE id = 1
    `).run(
      req.body.policy_version || current.policy_version || 'fairlab-v2',
      req.body.base_score,
      req.body.min_priority_floor != null ? req.body.min_priority_floor : (current.min_priority_floor ?? 10),
      req.body.deduction_per_booking != null ? req.body.deduction_per_booking : (current.deduction_per_booking ?? 10),
      req.body.deduction_per_hour != null ? req.body.deduction_per_hour : (current.deduction_per_hour ?? 5.0),
      req.body.high_demand_deduction_per_hour != null ? req.body.high_demand_deduction_per_hour : (current.high_demand_deduction_per_hour ?? 10.0),
      req.body.high_demand_threshold != null ? req.body.high_demand_threshold : (current.high_demand_threshold ?? 1.5),
      req.body.no_show_penalty,
      req.body.cancellation_window_hours,
      req.body.grace_period_minutes,
      openTime,
      closeTime,
      intervalMins,
      req.body.min_duration_minutes != null ? req.body.min_duration_minutes : (current.min_duration_minutes ?? 30),
      req.body.max_duration_minutes != null ? Math.min(120, req.body.max_duration_minutes) : Math.min(120, current.max_duration_minutes ?? 120),
      req.body.cutoff_minutes_before_start != null ? req.body.cutoff_minutes_before_start : (current.cutoff_minutes_before_start ?? 15),
      req.body.max_preferences_per_request != null ? req.body.max_preferences_per_request : (current.max_preferences_per_request ?? 3),
      req.body.max_daily_hours != null ? req.body.max_daily_hours : (current.max_daily_hours ?? 2.0),
      req.body.max_daily_bookings != null ? req.body.max_daily_bookings : (current.max_daily_bookings ?? 2),
      req.body.require_ticket_release != null ? (req.body.require_ticket_release ? 1 : 0) : (current.require_ticket_release ?? 0)
    );

    db.prepare(`
      INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
      VALUES (?, ?, 'Lab Coordinator', 'admin', 'POLICY_UPDATE', 'policy_config', '1', ?)
    `).run(
      `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actorId,
      `Updated policy: Hours ${openTime}-${closeTime} (${intervalMins}m slots), DailyMax=${req.body.max_daily_hours ?? current.max_daily_hours}h/${req.body.max_daily_bookings ?? current.max_daily_bookings} bookings, Rate=-${req.body.deduction_per_hour ?? current.deduction_per_hour}pts/hr normal, -${req.body.high_demand_deduction_per_hour ?? current.high_demand_deduction_per_hour}pts/hr peak.`
    );

    return db.prepare('SELECT * FROM policy_config WHERE id = 1').get();
  });

  try {
    const updated = tx();
    let slots = null;
    if (scheduleChanged) {
      slots = syncLabSlotsFromPolicy('lab-l106');
    } else {
      invalidateAvailabilityCache();
    }

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('SLOT_UPDATED', { reason: 'POLICY_UPDATE' });
    }

    res.json({ success: true, policy: updated, slotsSynced: scheduleChanged, slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger window/slot allocation round: POST /api/admin/allocation-rounds
const allocRoundSchema = z.object({
  slotId: z.string().optional().nullable(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  maxLimit: z.number().int().positive().optional().nullable()
});

router.post('/allocation-rounds', requireAdmin, validateBody(allocRoundSchema), async (req, res) => {
  try {
    const result = await runWindowAllocationRound({
      slotId: req.body.slotId || null,
      bookingDate: req.body.bookingDate || getTodayDateString(),
      startTime: req.body.startTime || null,
      endTime: req.body.endTime || null,
      maxLimit: req.body.maxLimit || null
    });

    if (req.app.get('wssBroadcast')) {
      publishPendingOutboxEvents(req.app.get('wssBroadcast'));
      req.app.get('wssBroadcast')('QUEUE_CHANGED', { roundId: result.roundId });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { roundId: result.roundId });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List recent allocation rounds for auditability
router.get('/allocation-rounds', (req, res) => {
  const db = getDb();
  try {
    const rounds = db.prepare('SELECT * FROM allocation_rounds ORDER BY executed_at DESC LIMIT 30').all();
    res.json(rounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin batch allocation trigger alias: POST /api/admin/allocate/:slotId
router.post('/allocate/:slotId', requireAdmin, async (req, res) => {
  try {
    const bookingDate = (req.body && req.body.bookingDate) || req.query.date || null;
    const maxLimit = (req.body && req.body.maxLimit) ? Number(req.body.maxLimit) : null;
    const result = await runAllocationRound(req.params.slotId, maxLimit, bookingDate);

    if (req.app.get('wssBroadcast')) {
      publishPendingOutboxEvents(req.app.get('wssBroadcast'));
      req.app.get('wssBroadcast')('QUEUE_CHANGED', { slotId: req.params.slotId });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { slotId: req.params.slotId });
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Trigger No-Show grace period sweep & waitlist promotion
const noShowSchema = z.object({
  bookingId: z.string().optional(),
  slotId: z.string().optional(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  force: z.boolean().optional()
});

router.post('/process-no-shows', requireAdmin, validateBody(noShowSchema), async (req, res) => {
  const actorId = req.user.user_id;
  try {
    const result = await processNoShows({
      bookingId: req.body.bookingId || null,
      slotId: req.body.slotId || null,
      bookingDate: req.body.bookingDate || getTodayDateString(),
      force: Boolean(req.body.force),
      actorId
    });

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('workstation.status_changed', { reason: 'NO_SHOW_RECOVERY', count: result.noShowCount });
      req.app.get('wssBroadcast')('fairness.score_updated', { reason: 'NO_SHOW_PENALTY' });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { reason: 'NO_SHOW_RECOVERY' });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const semesterResetSchema = z.object({
  semesterName: z.string().min(3, 'Semester name required')
});

// Execute Semester Reset
router.post('/semester/reset', requireAdmin, validateBody(semesterResetSchema), (req, res) => {
  const actorId = req.user.user_id;
  try {
    const result = executeSemesterReset(actorId, 'Dr. A. K. Sharma', req.body.semesterName);

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('fairness.score_updated', { reason: 'SEMESTER_RESET' });
      req.app.get('wssBroadcast')('SCORE_CHANGED', { reason: 'SEMESTER_RESET' });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fairness Analytics Report (plus alias /api/admin/analytics)
function handleAnalyticsReport(req, res) {
  const db = getDb();
  try {
    const spectrum = getFairnessScoreSpectrum();
    const vramHours = getVramHoursByField();
    const leaderboard = getFairnessLeaderboard(10);
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const totalSessions = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'COMPLETED'").get().count;
    const highDemandSessions = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE demand_level = 'HIGH_DEMAND' AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')").get().count;
    const noShowCount = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'NO_SHOW'").get().count;
    const waitlistCount = db.prepare("SELECT COUNT(*) as count FROM booking_requests WHERE status = 'QUEUED'").get().count;
    const activeSemester = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();

    res.json({
      activeSemester,
      totalStudents,
      totalSessions,
      highDemandSessions,
      noShowCount,
      waitlistCount,
      liveMetrics: leaderboard.metrics,
      spectrum,
      vramHours
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/fairness-report', handleAnalyticsReport);
router.get('/analytics', handleAnalyticsReport);

// Workstation operational health overview by block
router.get('/workstation-health', (req, res) => {
  try {
    const date = req.query.date || getTodayDateString();
    const availability = getLabAvailability('lab-l106', date);

    const bands = { LOW: 0, MEDIUM: 0, HIGH: 0, FULL: 0, OFFLINE: 0 };
    for (const w of availability.workstations) {
      bands[w.occupancy_band] = (bands[w.occupancy_band] || 0) + 1;
    }

    res.json({
      date,
      summary: availability.summary,
      blocks: availability.blocks,
      occupancyDistribution: bands,
      schedule: availability.schedule,
      maintenanceMachines: availability.workstations.filter(w => w.operational_status === 'MAINTENANCE')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit Logs
router.get('/audit-logs', (req, res) => {
  const db = getDb();
  try {
    const logs = db.prepare(`
      SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60
    `).all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const toggleMaintenanceSchema = z.object({
  machineId: z.string().min(1),
  isMaintenance: z.boolean()
});

// Toggle Workstation Maintenance (with automatic booking reallocation if taken offline)
router.post('/workstation/toggle-maintenance', requireAdmin, validateBody(toggleMaintenanceSchema), (req, res) => {
  const actorId = req.user.user_id;
  try {
    const result = toggleWorkstationMaintenance(req.body.machineId, req.body.isMaintenance, actorId);

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('workstation.status_changed', {
        machineId: req.body.machineId,
        status: result.newStatus,
        reallocatedCount: result.reallocatedCount
      });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { machineId: req.body.machineId });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const overrideSchema = z.object({
  userId: z.string().min(1),
  slotId: z.string().min(1),
  machineId: z.string().min(1),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().min(5, 'Valid justification required for audit compliance')
});

// Administrative Override
router.post('/override', requireAdmin, validateBody(overrideSchema), async (req, res) => {
  const actorId = req.user.user_id;
  const db = getDb();
  const bookingDate = req.body.bookingDate || getTodayDateString();

  try {
    const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.body.userId);
    const slot = db.prepare('SELECT * FROM lab_slots WHERE slot_id = ?').get(req.body.slotId);
    const machine = db.prepare('SELECT * FROM workstations WHERE machine_id = ?').get(req.body.machineId);

    if (!user || !slot || !machine) {
      return res.status(400).json({ error: 'Invalid user, slot, or workstation identifier' });
    }

    const bookingId = `L106-OVERRIDE-${String(Date.now()).slice(-5)}`;

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, booking_date, duration_minutes, demand_level, semester_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'NORMAL', ?, 'CONFIRMED')
      `).run(bookingId, req.body.userId, req.body.machineId, req.body.slotId, bookingDate, slot.duration_minutes || 60, activeSem.semester_id);

      db.prepare(`
        UPDATE workstations
        SET status = 'BOOKED', current_user_id = ?, active_job = ?
        WHERE machine_id = ?
      `).run(req.body.userId, `Admin Override: ${req.body.reason}`, req.body.machineId);

      db.prepare(`
        INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
        VALUES (?, ?, 'Dr. A. K. Sharma', 'admin', 'ADMIN_OVERRIDE_BOOKING', 'bookings', ?, ?)
      `).run(
        `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        actorId,
        bookingId,
        `Emergency override granted to ${user.name} (${user.roll_no}) on ${machine.machine_id} (${bookingDate}). Reason: ${req.body.reason}`
      );
    });

    tx();
    invalidateAvailabilityCache();

    const pass = await generateAccessPass(
      bookingId,
      user.user_id,
      user.roll_no,
      machine.machine_id,
      slot.slot_name,
      `${slot.start_time} – ${slot.end_time}`
    );

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('booking.confirmed', { bookingId, machineId: machine.machine_id });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { bookingId });
    }

    res.json({ success: true, bookingId, pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// SCHEDULE MANAGEMENT: MON–FRI TIMETABLE, HOLIDAYS/EXTRA DAYS & TICKET RELEASES
// =========================================================================

// Read full schedule state (accessible to Admin & Student UI for transparency)
router.get('/schedule-overview', (req, res) => {
  try {
    const db = getDb();
    const policy = db.prepare('SELECT require_ticket_release, lab_open_time, lab_close_time, max_duration_minutes, max_daily_hours FROM policy_config WHERE id = 1').get() || {};
    res.json({
      timetable: listTimetable('lab-l106'),
      overrides: listDateOverrides('lab-l106'),
      ticketReleases: listTicketReleases('lab-l106'),
      requireTicketRelease: Boolean(policy.require_ticket_release),
      labOpenTime: policy.lab_open_time || '09:00',
      labCloseTime: policy.lab_close_time || '18:00',
      maxDurationMinutes: Math.min(120, Number(policy.max_duration_minutes || 120)),
      maxDailyHours: Number(policy.max_daily_hours || 2.0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle strict Ticket-Release Mode ON/OFF
const ticketModeSchema = z.object({
  requireTicketRelease: z.boolean()
});

router.put('/ticket-release-mode', requireAdmin, validateBody(ticketModeSchema), (req, res) => {
  try {
    const db = getDb();
    const val = req.body.requireTicketRelease ? 1 : 0;
    db.prepare(`UPDATE policy_config SET require_ticket_release = ?, updated_at = datetime('now') WHERE id = 1`).run(val);
    db.prepare(`
      INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'admin', 'TICKET_MODE_UPDATE', 'policy_config', '1', ?)
    `).run(
      `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      req.user.user_id,
      req.user.name,
      `Set require_ticket_release = ${val === 1 ? 'ENABLED (Students can book only released ticket drops)' : 'DISABLED (Open booking mode)'}`
    );
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TICKET_MODE' });
    res.json({ success: true, requireTicketRelease: Boolean(val) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mon–Fri Academic Lab Timetable CRUD
const timetableSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Start time must be HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'End time must be HH:MM'),
  title: z.string().min(2, 'Lab session title is required').max(120),
  courseCode: z.string().max(32).optional().default(''),
  instructor: z.string().max(80).optional().default('')
});

router.post('/timetable', requireAdmin, validateBody(timetableSchema), (req, res) => {
  try {
    const entry = createTimetableEntry({ ...req.body, actorId: req.user.user_id });
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TIMETABLE' });
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const timetablePatchSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  title: z.string().min(2).max(120).optional(),
  courseCode: z.string().max(32).optional(),
  instructor: z.string().max(80).optional(),
  isActive: z.boolean().optional()
});

router.put('/timetable/:id', requireAdmin, validateBody(timetablePatchSchema), (req, res) => {
  try {
    const updated = updateTimetableEntry(req.params.id, req.body, req.user.user_id);
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TIMETABLE' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/timetable/:id', requireAdmin, (req, res) => {
  try {
    const out = deleteTimetableEntry(req.params.id, req.user.user_id);
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TIMETABLE' });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Date Overrides: Holidays, Extra Days & Custom Open/Close Hours
const dateOverrideSchema = z.object({
  overrideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  overrideType: z.enum(['HOLIDAY', 'EXTRA_DAY', 'CUSTOM_HOURS']),
  isOpen: z.boolean().optional(),
  openTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  ignoreTimetable: z.boolean().optional().default(false),
  reason: z.string().min(2, 'Reason is required').max(140)
});

router.post('/date-overrides', requireAdmin, validateBody(dateOverrideSchema), (req, res) => {
  try {
    const row = upsertDateOverride({ ...req.body, actorId: req.user.user_id });
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'DATE_OVERRIDE' });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/date-overrides/:date', requireAdmin, (req, res) => {
  try {
    const out = deleteDateOverride(req.params.date, req.user.user_id);
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'DATE_OVERRIDE' });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ticket Releases (Movie-Ticket Style Booking Drops)
const ticketReleaseSchema = z.object({
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  title: z.string().min(2, 'Release title is required').max(120),
  totalTickets: z.number().int().min(1).max(84).default(84),
  status: z.enum(['DRAFT', 'RELEASED', 'PAUSED', 'CLOSED']).default('RELEASED')
});

router.post('/ticket-releases', requireAdmin, validateBody(ticketReleaseSchema), (req, res) => {
  try {
    const row = createTicketRelease({ ...req.body, actorId: req.user.user_id });
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TICKET_RELEASE' });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const bulkReleaseSchema = z.object({
  days: z.number().int().min(1).max(14).default(5),
  totalTickets: z.number().int().min(1).max(84).default(84),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('18:00')
});

router.post('/ticket-releases/bulk', requireAdmin, validateBody(bulkReleaseSchema), (req, res) => {
  try {
    const today = getTodayDateString();
    const created = [];
    for (let i = 0; i < req.body.days; i++) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().split('T')[0];
      const existing = getDb()
        .prepare('SELECT release_id FROM ticket_releases WHERE release_date = ? AND start_time = ? AND end_time = ?')
        .get(iso, req.body.startTime, req.body.endTime);
      if (!existing) {
        created.push(createTicketRelease({
          releaseDate: iso,
          startTime: req.body.startTime,
          endTime: req.body.endTime,
          title: `Lab L-106 Open Access Tickets (${iso})`,
          totalTickets: req.body.totalTickets,
          status: 'RELEASED',
          actorId: req.user.user_id
        }));
      }
    }
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TICKET_RELEASE' });
    res.status(201).json({ createdCount: created.length, releases: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const ticketPatchSchema = z.object({
  status: z.enum(['DRAFT', 'RELEASED', 'PAUSED', 'CLOSED']).optional(),
  totalTickets: z.number().int().min(1).max(84).optional(),
  title: z.string().min(2).max(120).optional()
});

router.patch('/ticket-releases/:id', requireAdmin, validateBody(ticketPatchSchema), (req, res) => {
  try {
    const updated = updateTicketReleaseStatus(req.params.id, req.body, req.user.user_id);
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TICKET_RELEASE' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/ticket-releases/:id', requireAdmin, (req, res) => {
  try {
    const out = deleteTicketRelease(req.params.id, req.user.user_id);
    invalidateAvailabilityCache();
    if (req.app.get('wssBroadcast')) req.app.get('wssBroadcast')('SLOT_UPDATED', { type: 'TICKET_RELEASE' });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
