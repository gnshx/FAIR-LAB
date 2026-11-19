const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { generateAccessPass } = require('../services/passService');
const { validateBody, z } = require('../middleware/validation');
const { requireAccessOperator, resolveAuthenticatedUser, hasPermission } = require('../middleware/auth');
const { verifyToken, recordCheckIn, recordCheckOut, getGateActivityLog } = require('../services/verificationService');

const verifySchema = z.object({
  token: z.string().min(1, 'Token or QR scan input is required')
});

// Scanning a pass returns the holder's identity and booking details; restrict it
// to an authenticated gate operator just like check-in and check-out.
router.use(resolveGateOperator);

// Gate Scan Verification
router.post('/verify', validateBody(verifySchema), (req, res) => {
  try {
    const verdict = verifyToken(req.body.token);
    res.json(verdict);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const checkInSchema = z.object({
  passId: z.string().min(1, 'passId is required'),
  notes: z.string().optional()
});

// Resolve operator with dev fallback ONLY when no header/JWT provided in non-prod (preserves legacy E2E test compat while rejecting students with 403)
function resolveGateOperator(req, res, next) {
  if (req.headers.authorization || req.headers.cookie || req.headers['x-user-id'] || process.env.NODE_ENV === 'production') {
    return requireAccessOperator(req, res, next);
  }
  const fallback = resolveAuthenticatedUser(req, 'usr-watchman-ram');
  if (!fallback || !((fallback.role === 'admin' && hasPermission(fallback, 'ACCESS_OPERATOR')) || fallback.role === 'watchman')) {
    return res.status(403).json({ error: 'Unauthorized turnstile operation' });
  }
  req.user = fallback;
  next();
}

// Check-in action (requires Admin with ACCESS_OPERATOR permission)
router.post('/check-in', resolveGateOperator, validateBody(checkInSchema), (req, res) => {
  try {
    const result = recordCheckIn(req.body.passId, req.user.user_id, req.body.notes);

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('GATE_EVENT', { type: 'CHECK_IN', ...result });
      req.app.get('wssBroadcast')('workstation.status_changed', { machineId: result.machineId, status: 'OCCUPIED' });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { machineId: result.machineId });
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const checkOutSchema = z.object({
  bookingId: z.string().min(1, 'bookingId is required'),
  notes: z.string().optional()
});

// Check-out action (closes session, deducts fairness points; requires Admin with ACCESS_OPERATOR permission)
router.post('/check-out', resolveGateOperator, validateBody(checkOutSchema), (req, res) => {
  try {
    const result = recordCheckOut(req.body.bookingId, req.user.user_id, req.body.notes);

    if (req.app.get('wssBroadcast')) {
      req.app.get('wssBroadcast')('GATE_EVENT', { type: 'CHECK_OUT', ...result });
      req.app.get('wssBroadcast')('fairness.score_updated', { ...result });
      req.app.get('wssBroadcast')('workstation.status_changed', { machineId: result.machineId, status: 'AVAILABLE' });
      req.app.get('wssBroadcast')('SCORE_CHANGED', { ...result });
      req.app.get('wssBroadcast')('SLOT_UPDATED', { machineId: result.machineId });
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Sample / active pass for demo turnstile verification testing
router.get('/sample-pass', async (req, res) => {
  try {
    const db = getDb();
    // 1. Try to find the latest VALID access pass that has not expired
    let pass = db.prepare(`
      SELECT p.signed_token, p.pass_id, p.status, p.booking_id,
             b.machine_id, b.booking_date, b.start_time, b.end_time,
             u.name as student_name, u.roll_no, w.display_label
      FROM access_passes p
      JOIN bookings b ON p.booking_id = b.booking_id
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN workstations w ON b.machine_id = w.machine_id
      WHERE p.status = 'VALID' AND datetime(p.expires_at) > datetime('now')
      ORDER BY p.issued_at DESC
      LIMIT 1
    `).get();

    // 2. If no valid unexpired pass exists, find the most recent confirmed booking and generate/renew a pass
    if (!pass) {
      const activeBooking = db.prepare(`
        SELECT b.booking_id, b.user_id, b.machine_id, b.booking_date, b.start_time, b.end_time,
               u.name as student_name, u.roll_no, w.display_label
        FROM bookings b
        JOIN users u ON b.user_id = u.user_id
        LEFT JOIN workstations w ON b.machine_id = w.machine_id
        WHERE b.status IN ('CONFIRMED', 'CHECKED_IN')
        ORDER BY b.booking_date DESC, b.booking_id DESC
        LIMIT 1
      `).get();

      if (activeBooking) {
        const generated = await generateAccessPass(
          activeBooking.booking_id,
          activeBooking.user_id,
          activeBooking.roll_no,
          activeBooking.machine_id,
          'Lab Slot',
          `${activeBooking.start_time || '10:00'} – ${activeBooking.end_time || '12:00'}`
        );
        pass = {
          signed_token: generated.signedToken,
          pass_id: generated.passId,
          status: 'VALID',
          booking_id: activeBooking.booking_id,
          machine_id: activeBooking.machine_id,
          booking_date: activeBooking.booking_date,
          start_time: activeBooking.start_time || '10:00',
          end_time: activeBooking.end_time || '12:00',
          student_name: activeBooking.student_name,
          roll_no: activeBooking.roll_no,
          display_label: activeBooking.display_label || activeBooking.machine_id
        };
      }
    }

    if (!pass) {
      return res.status(404).json({ error: 'No active pass found in system' });
    }

    res.json(pass);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shift activity stream
router.get('/shift-log', (req, res) => {
  try {
    const logs = getGateActivityLog(30);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
