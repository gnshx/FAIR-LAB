const express = require('express');
const router = express.Router();
const { validateBody, z } = require('../middleware/validation');
const { resolveAuthenticatedUser, requireUser, requireAdmin } = require('../middleware/auth');
const {
  submitBookingRequest,
  cancelBookingRequest,
  runAllocationRound,
  cancelBooking,
  getQueueForSlot
} = require('../services/bookingService');
const { getPassByBookingId } = require('../services/passService');
const { getDb } = require('../db/database');
const { getTodayDateString } = require('../db/seed');

function resolveBookingUser(req, fallbackDevId = null) {
  return resolveAuthenticatedUser(
    req,
    process.env.NODE_ENV !== 'production' ? fallbackDevId : null
  );
}

function requireAllocateAuth(req, res, next) {
  if (
    req.headers.authorization ||
    req.headers.cookie ||
    req.headers['x-user-id'] ||
    process.env.NODE_ENV === 'production'
  ) {
    return requireAdmin(req, res, next);
  }
  next();
}

const bookingRequestSchema = z.object({
  slotId: z.string().optional().nullable(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  preferredMachineId: z.string().optional().nullable(),
  preferredWorkstations: z.array(z.string()).max(3).optional().nullable(),
  computePurpose: z.string().min(3, 'Purpose must be at least 3 characters').default('Academic Lab Work'),
  researchField: z.string().min(2, 'Domain or course is required').default('Computer Science'),
  idempotencyKey: z.string().max(128).optional().nullable(),
  allocationMode: z.enum(['AUTO', 'IMMEDIATE', 'SCHEDULED']).optional()
});

function broadcastEvents(app, events) {
  const fn = app.get('wssBroadcast');
  if (!fn) return;
  for (const [type, payload] of events) {
    fn(type, payload);
  }
}

// Submit booking request (Hybrid: preferred workstation + fairness queue)
router.post('/request', validateBody(bookingRequestSchema), async (req, res) => {
  const authed = resolveBookingUser(req, 'usr-student-ganesh');
  if (!authed) return res.status(401).json({ error: 'Authentication required' });
  const perms = Array.isArray(authed.permissions) ? authed.permissions : [];
  if (authed.email === 'accessdesk.l106@iitbhilai.ac.in' || (perms.includes('ACCESS_OPERATOR') && !perms.includes('POLICY_ADMIN'))) {
    return res.status(403).json({ error: 'Gate operators are authorized exclusively for QR pass verification and cannot submit workstation reservations.' });
  }
  const userId = authed.user_id;
  const idempKey = req.body.idempotencyKey || req.headers['idempotency-key'] || null;
  try {
    const result = submitBookingRequest({
      userId,
      slotId: req.body.slotId || null,
      bookingDate: req.body.bookingDate || getTodayDateString(),
      startTime: req.body.startTime || null,
      endTime: req.body.endTime || null,
      preferredMachineId: req.body.preferredMachineId,
      preferredWorkstations: req.body.preferredWorkstations || null,
      computePurpose: req.body.computePurpose,
      researchField: req.body.researchField,
      idempotencyKey: idempKey,
      allocationMode: req.body.allocationMode || 'SCHEDULED'
    });

    broadcastEvents(req.app, [
      ['booking.requested', { requestId: result.requestId, slotId: result.slotId, bookingDate: result.bookingDate }],
      ['QUEUE_CHANGED', { slotId: result.slotId, bookingDate: result.bookingDate }]
    ]);

    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Withdraw a queued/waitlisted request with zero penalty
router.delete('/request/:id', requireUser, (req, res) => {
  const userId = req.user.user_id;
  try {
    const result = cancelBookingRequest(req.params.id, userId);
    broadcastEvents(req.app, [
      ['booking.cancelled', { requestId: req.params.id }],
      ['QUEUE_CHANGED', { requestId: req.params.id }]
    ]);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Get user's active & past bookings (confirmed/checked-in/completed/cancelled) AND pending requests
router.get('/my-bookings', (req, res) => {
  const authed = resolveBookingUser(req, 'usr-student-ganesh');
  if (!authed) return res.status(401).json({ error: 'Authentication required' });
  const userId = authed.user_id;
  const db = getDb();
  try {
    const bookings = db.prepare(`
      SELECT b.*, p.pass_id, p.signed_token, p.token_hash, p.status as pass_status, p.expires_at,
             COALESCE(s.slot_name, 'Custom Window') as slot_name,
             COALESCE(b.start_time, s.start_time) as start_time,
             COALESCE(b.end_time, s.end_time) as end_time,
             w.display_label, w.block_code, w.row_num, w.seat_num,
             u.name as student_name, u.roll_no, u.department,
             br.compute_purpose, br.research_field, br.preferred_machine_id
      FROM bookings b
      LEFT JOIN access_passes p ON b.booking_id = p.booking_id
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      JOIN workstations w ON b.machine_id = w.machine_id
      JOIN users u ON b.user_id = u.user_id
      LEFT JOIN booking_requests br ON b.request_id = br.request_id
      WHERE b.user_id = ?
      ORDER BY b.booking_date DESC, b.booked_at DESC
    `).all(userId);

    const pendingRequests = db.prepare(`
      SELECT r.*,
             COALESCE(s.slot_name, 'Custom Window') as slot_name,
             COALESCE(r.start_time, s.start_time) as start_time,
             COALESCE(r.end_time, s.end_time) as end_time,
             w.display_label as preferred_label,
             wl.position as waitlist_position
      FROM booking_requests r
      LEFT JOIN lab_slots s ON r.slot_id = s.slot_id
      LEFT JOIN workstations w ON r.preferred_machine_id = w.machine_id
      LEFT JOIN waitlist_entries wl ON r.request_id = wl.request_id
      WHERE r.user_id = ? AND r.status = 'QUEUED'
      ORDER BY r.booking_date ASC, r.requested_at DESC
    `).all(userId);

    res.json({ bookings, pendingRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy alias: Get user's active and past passes
router.get('/my-passes', async (req, res) => {
  const authed = resolveBookingUser(req, 'usr-student-ganesh');
  if (!authed) return res.status(401).json({ error: 'Authentication required' });
  const userId = authed.user_id;
  const db = getDb();
  try {
    const bookings = db.prepare(`
      SELECT b.*, p.pass_id, p.signed_token, p.token_hash, p.status as pass_status, p.expires_at,
             COALESCE(s.slot_name, 'Custom Window') as slot_name,
             COALESCE(b.start_time, s.start_time) as start_time,
             COALESCE(b.end_time, s.end_time) as end_time,
             w.display_label, w.block_code, w.row_num, w.seat_num, w.gpu_model, w.vram_gb,
             u.name as student_name, u.roll_no, u.department,
             br.compute_purpose, br.research_field
      FROM bookings b
      LEFT JOIN access_passes p ON b.booking_id = p.booking_id
      LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
      JOIN workstations w ON b.machine_id = w.machine_id
      JOIN users u ON b.user_id = u.user_id
      LEFT JOIN booking_requests br ON b.request_id = br.request_id
      WHERE b.user_id = ?
      ORDER BY b.booked_at DESC
    `).all(userId);

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single pass with QR code
router.get('/:id/pass', async (req, res) => {
  try {
    const authed = resolveBookingUser(req);
    if (!authed) return res.status(401).json({ error: 'Authentication required' });
    const db = getDb();
    const booking = db.prepare('SELECT user_id FROM bookings WHERE booking_id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Access pass not found' });
    const actor = db.prepare('SELECT role FROM users WHERE user_id = ?').get(authed.user_id);
    if (booking.user_id !== authed.user_id && actor?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: You can only view your own access pass.' });
    }
    const pass = await getPassByBookingId(req.params.id);
    if (!pass) return res.status(404).json({ error: 'Access pass not found' });
    res.json(pass);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a confirmed booking (POST or DELETE /api/bookings/:id)
router.delete('/:id', requireUser, (req, res) => {
  const userId = req.user.user_id;
  try {
    const result = cancelBooking(req.params.id, userId, 'Student cancelled reservation');
    broadcastEvents(req.app, [
      ['booking.cancelled', { bookingId: req.params.id, machineId: result.freedMachineId }],
      ['workstation.status_changed', { machineId: result.freedMachineId, status: 'AVAILABLE' }],
      ['SLOT_UPDATED', { bookingId: req.params.id }]
    ]);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Alias GET /api/bookings/me -> same payload as /my-bookings
router.get('/me', (req, res, next) => {
  req.url = '/my-bookings';
  next();
});

// Cancel a confirmed booking
const cancelSchema = z.object({
  reason: z.string().optional()
});

router.post('/:id/cancel', requireUser, validateBody(cancelSchema), (req, res) => {
  const userId = req.user.user_id;
  try {
    const result = cancelBooking(req.params.id, userId, req.body.reason);

    broadcastEvents(req.app, [
      ['booking.cancelled', { bookingId: req.params.id, machineId: result.freedMachineId, slotId: result.slotId }],
      ['workstation.status_changed', { machineId: result.freedMachineId, status: 'AVAILABLE' }],
      ['SLOT_UPDATED', { bookingId: req.params.id }]
    ]);

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Get queue for slot
router.get('/queue/:slotId', (req, res) => {
  try {
    const queue = getQueueForSlot(req.params.slotId, req.query.date || null);
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run batch allocation round for a slot
router.post('/queue/:slotId/allocate', requireAllocateAuth, async (req, res) => {
  try {
    const bookingDate = (req.body && req.body.bookingDate) || req.query.date || null;
    const maxLimit = (req.body && req.body.maxLimit) ? Number(req.body.maxLimit) : null;
    const result = await runAllocationRound(req.params.slotId, maxLimit, bookingDate);

    broadcastEvents(req.app, [
      ['allocation.completed', { slotId: req.params.slotId, allocatedCount: result.allocatedCount, demandLevel: result.demandLevel }],
      ['booking.confirmed', { slotId: req.params.slotId, count: result.allocatedCount }],
      ['QUEUE_CHANGED', { slotId: req.params.slotId }],
      ['SLOT_UPDATED', { slotId: req.params.slotId }]
    ]);

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
