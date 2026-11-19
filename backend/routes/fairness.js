const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { resolveAuthenticatedUser, requireAdmin } = require('../middleware/auth');
const { runMonteCarloSimulation, runThreePolicyComparison } = require('../services/analyticsService');
const { checkDailyBookingLimit, getFairnessLeaderboard } = require('../services/fairnessEngine');
const { getTodayDateString } = require('../db/seed');

router.get('/me', (req, res) => {
  const authed = resolveAuthenticatedUser(req, process.env.NODE_ENV !== 'production' ? 'usr-student-ganesh' : null);
  if (!authed) return res.status(401).json({ error: 'Authentication required' });
  const userId = authed.user_id;
  const date = req.query.date || getTodayDateString();
  const db = getDb();

  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    base_score: 100,
    min_priority_floor: 10,
    deduction_per_booking: 10,
    deduction_per_hour: 5.0,
    high_demand_deduction_per_hour: 0.0,
    high_demand_threshold: 1.5,
    no_show_penalty: 5,
    max_daily_hours: 2.0,
    max_daily_bookings: 2,
    slot_interval_minutes: 60
  };

  let fairness = null;
  if (activeSem) {
    fairness = db.prepare(`
      SELECT * FROM student_fairness WHERE user_id = ? AND semester_id = ?
    `).get(userId, activeSem.semester_id);
  }

  const user = db.prepare('SELECT name, roll_no, department FROM users WHERE user_id = ?').get(userId);

  const history = db.prepare(`
    SELECT ah.*, COALESCE(ah.machine_id, b.machine_id) as machine_id, s.slot_name
    FROM allocation_history ah
    LEFT JOIN bookings b ON ah.booking_id = b.booking_id
    LEFT JOIN lab_slots s ON COALESCE(ah.slot_id, b.slot_id) = s.slot_id
    WHERE ah.user_id = ?
    ORDER BY ah.created_at DESC
    LIMIT 15
  `).all(userId);

  const dailyQuota = checkDailyBookingLimit(userId, date, policy.slot_interval_minutes || 60);

  const score = fairness ? fairness.current_score : policy.base_score;
  const bookings = fairness ? fairness.booking_count : 0;
  const totalHours = fairness ? (Number(fairness.total_hours_used) || 0) : 0;
  const highDemandCount = fairness ? (Number(fairness.high_demand_count) || 0) : 0;
  const highDemandHours = fairness ? (Number(fairness.high_demand_hours) || 0) : 0;
  const penalties = fairness ? fairness.penalty_points : 0;

  res.json({
    user,
    semester: activeSem,
    policy,
    currentScore: score,
    completedBookings: bookings,
    totalHoursUsed: totalHours,
    highDemandSessions: highDemandCount,
    highDemandHours,
    penaltyPoints: penalties,
    dailyQuota,
    formula: (Number(policy.high_demand_deduction_per_hour) || 0) > 0
      ? `P_u = max(${policy.min_priority_floor || 10}, ${policy.base_score} - ${policy.deduction_per_hour ?? 5}×T_u - ${policy.high_demand_deduction_per_hour}×T_H - Penalties)`
      : `P_u = max(${policy.min_priority_floor || 10}, ${policy.base_score} - ${policy.deduction_per_hour ?? 5}×T_u - Penalties)`,
    formulaVariables: {
      P_u: score,
      Base: policy.base_score,
      Floor: policy.min_priority_floor || 10,
      RatePerHour: policy.deduction_per_hour ?? 5,
      HighDemandRatePerHour: policy.high_demand_deduction_per_hour ?? 0,
      T_u: totalHours,
      T_H: highDemandHours,
      B_u: bookings,
      H_u: highDemandCount,
      Penalties: penalties
    },
    tier: score >= 90 ? 'Tier 1 · High Priority' : score >= 70 ? 'Tier 2 · Standard' : 'Tier 3 · Balanced',
    history
  });
});

// Cohort fairness leaderboard & live inequality indices
router.get('/leaderboard', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit, 10) || 50));
    const data = getFairnessLeaderboard(limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Allocation & score history for current user
router.get('/history', (req, res) => {
  const authed = resolveAuthenticatedUser(req, process.env.NODE_ENV !== 'production' ? 'usr-student-ganesh' : null);
  if (!authed) return res.status(401).json({ error: 'Authentication required' });
  const userId = authed.user_id;
  const db = getDb();
  try {
    const history = db.prepare(`
      SELECT ah.*, COALESCE(ah.machine_id, b.machine_id) as machine_id,
             COALESCE(b.start_time, s.start_time) as start_time,
             COALESCE(b.end_time, s.end_time) as end_time,
             b.booking_date, w.display_label
      FROM allocation_history ah
      LEFT JOIN bookings b ON ah.booking_id = b.booking_id
      LEFT JOIN lab_slots s ON COALESCE(ah.slot_id, b.slot_id) = s.slot_id
      LEFT JOIN workstations w ON COALESCE(ah.machine_id, b.machine_id) = w.machine_id
      WHERE ah.user_id = ?
      ORDER BY ah.created_at DESC
      LIMIT 30
    `).all(userId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3-Policy Comparison: FIFO vs Basic FairLab vs FairLab v2
router.get('/compare-policies', (req, res) => {
  try {
    const iterations = Math.min(500, Math.max(20, parseInt(req.query.iterations, 10) || 100));
    const poolSize = Math.min(200, Math.max(10, parseInt(req.query.poolSize, 10) || 60));
    const slots = Math.min(84, Math.max(2, parseInt(req.query.slots, 10) || 10));
    const seed = parseInt(req.query.seed, 10) || 1337;
    const workload = req.query.workload || 'MIXED_PEAK_AND_BOT';
    res.json(runThreePolicyComparison(iterations, poolSize, slots, seed, workload));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/simulation', (req, res) => {
  try {
    const iterations = parseInt(req.query.iterations, 10) || 150;
    const poolSize = parseInt(req.query.poolSize, 10) || 60;
    const slots = parseInt(req.query.slots, 10) || 10;
    const seed = parseInt(req.query.seed, 10) || 1337;
    const workload = req.query.workload || 'BOT_LATENCY_SKEW';
    const simResult = runMonteCarloSimulation(iterations, poolSize, slots, seed, workload);
    res.json(simResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
