const express = require('express');
const router = express.Router();
const { getWorkstations } = require('../services/gpuResourceService');
const { getLabAvailability } = require('../services/availabilityService');
const { getDb } = require('../db/database');
const { getTodayDateString } = require('../db/seed');

function normalizeLabId(param) {
  if (!param) return 'lab-l106';
  const upper = String(param).toUpperCase();
  if (upper === 'L106' || upper === 'L-106' || upper === 'LAB-L106') return 'lab-l106';
  return param;
}

// Workstations inventory for a lab (84 workstations across Block A 6x10 + Block B 4x6)
router.get('/:labId/workstations', (req, res) => {
  try {
    const labId = normalizeLabId(req.params.labId);
    const workstations = getWorkstations(labId);
    res.json(workstations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full movie-seat availability map: daily occupancy % + exact selected interval status
router.get('/:labId/availability', (req, res) => {
  try {
    const labId = normalizeLabId(req.params.labId);
    const date = req.query.date || getTodayDateString();
    const slotId = req.query.slotId || null;
    const start = req.query.start || null;
    const end = req.query.end || null;

    const availability = getLabAvailability(labId, date, slotId, start, end);
    res.json(availability);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Active configurable time slots for a lab
router.get('/:labId/slots', (req, res) => {
  const db = getDb();
  const labId = normalizeLabId(req.params.labId);
  const date = req.query.date || getTodayDateString();
  try {
    const slots = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.slot_id AND b.booking_date = ? AND b.status IN ('CONFIRMED', 'CHECKED_IN')) as allocated_count,
        (SELECT COUNT(*) FROM booking_requests r WHERE r.slot_id = s.slot_id AND r.booking_date = ? AND r.status = 'QUEUED') as queued_count
      FROM lab_slots s
      WHERE s.lab_id = ? AND s.is_active = 1
      ORDER BY s.round_number ASC
    `).all(date, date, labId);
    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lab summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const lab = db.prepare("SELECT * FROM labs WHERE code = 'L-106'").get();
  const rigs = db.prepare("SELECT status, COUNT(*) as count FROM workstations WHERE lab_id = 'lab-l106' GROUP BY status").all();

  const statusMap = { AVAILABLE: 0, OCCUPIED: 0, BOOKED: 0, MAINTENANCE: 0 };
  let total = 0;
  for (const r of rigs) {
    statusMap[r.status] = r.count;
    total += r.count;
  }

  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get();

  res.json({
    lab,
    totalNodes: total || 84,
    blocks: { A: { rows: 6, cols: 10, total: 60 }, B: { rows: 4, cols: 6, total: 24 } },
    onlineNodes: statusMap.AVAILABLE + statusMap.OCCUPIED + statusMap.BOOKED,
    availableNodes: statusMap.AVAILABLE,
    occupiedNodes: statusMap.OCCUPIED,
    bookedNodes: statusMap.BOOKED,
    maintenanceNodes: statusMap.MAINTENANCE,
    schedule: policy ? {
      openTime: policy.lab_open_time,
      closeTime: policy.lab_close_time,
      intervalMinutes: policy.slot_interval_minutes,
      maxDailyHours: policy.max_daily_hours,
      maxDailyBookings: policy.max_daily_bookings
    } : null
  });
});

module.exports = router;
