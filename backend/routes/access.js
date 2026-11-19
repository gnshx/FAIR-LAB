const express = require('express');
const router = express.Router();
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
