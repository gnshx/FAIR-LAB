const express = require('express');
const router = express.Router();
const { validateBody, z } = require('../middleware/validation');
const { verifyToken, recordCheckIn, recordCheckOut, getGateActivityLog } = require('../services/verificationService');
const { getDb } = require('../db/database');

const verifySchema = z.object({
  token: z.string().min(1, 'Token or QR scan input is required')
});

// Watchman Turnstile Scan Verification
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

// Check-in action (opens turnstile) - Enforces watchman/admin authorization
router.post('/check-in', validateBody(checkInSchema), (req, res) => {
  const operatorId = req.headers['x-user-id'] || 'usr-watchman-ram';
  const db = getDb();
  
  // Verify operator authorization
  const operator = db.prepare('SELECT role FROM users WHERE user_id = ?').get(operatorId);
  if (!operator || (operator.role !== 'watchman' && operator.role !== 'admin')) {
    return res.status(403).json({
      error: 'Unauthorized turnstile operation',
      message: 'Only registered campus security personnel (watchman) or administrators may unlatch the turnstile gate.'
    });
  }

  try {
    const result = recordCheckIn(req.body.passId, operatorId, req.body.notes);

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

// Check-out action (closes session, deducts fairness points!) - Enforces authorization
router.post('/check-out', validateBody(checkOutSchema), (req, res) => {
  const operatorId = req.headers['x-user-id'] || 'usr-watchman-ram';
  const db = getDb();

  const operator = db.prepare('SELECT role FROM users WHERE user_id = ?').get(operatorId);
  if (!operator || (operator.role !== 'watchman' && operator.role !== 'admin')) {
    return res.status(403).json({
      error: 'Unauthorized checkout operation',
      message: 'Only campus security or lab administrators can record exit logs and conclude sessions.'
    });
  }

  try {
    const result = recordCheckOut(req.body.bookingId, operatorId, req.body.notes);

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
