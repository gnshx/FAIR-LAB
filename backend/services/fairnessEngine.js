const { getDb } = require('../db/database');

/**
 * Legacy-compatible priority score calculation:
 * Linear: P_u = max(minFloor, BaseScore - (DeductionPerBooking * B_u) - PenaltyPoints)
 * Exponential: P_u = max(minFloor, round(BaseScore * exp(-0.08 * B_u)) - PenaltyPoints)
 */
function calculatePriorityScore(
  baseScore = 100,
  deductionPerBooking = 10,
  completedBookings = 0,
  penaltyPoints = 0,
  decayModel = 'LINEAR',
  minFloor = 10
) {
  if (decayModel === 'EXPONENTIAL') {
    const raw = Math.round(baseScore * Math.exp(-0.08 * completedBookings)) - penaltyPoints;
    return Math.max(minFloor, raw);
  }
  const calculated = baseScore - (deductionPerBooking * completedBookings) - penaltyPoints;
  return Math.max(minFloor, calculated);
}

/**
 * Duration- and High-Demand-Aware Fairness Score:
 *   P_u = max(minFloor, round(baseScore - (deductionPerHour * T_u) - (highDemandDeductionPerHour * T_{H,u}) - penaltyPoints))
 *
 * Where:
 *   T_u     = total completed hours used by student u in the active semester
 *   T_{H,u} = completed hours used during auto-detected HIGH_DEMAND intervals
 *   When intervals are 1 hour, this reduces directly to: P_u = max(10, 100 - 5*B_u - 10*H_u)
 *   When intervals are 30m or 2h, deduction scales proportionally with time used.
 */
function calculateHoursDemandScore({
  baseScore = 100,
  minFloor = 10,
  totalHoursUsed = 0,
  highDemandHours = 0,
  deductionPerHour = 5,
  highDemandDeductionPerHour = 10,
  penaltyPoints = 0
} = {}) {
  const safeTotal = Math.max(0, Number(totalHoursUsed) || 0);
  const safeHigh = Math.max(0, Number(highDemandHours) || 0);
  const raw = Number(baseScore) - (Number(deductionPerHour) * safeTotal) - (Number(highDemandDeductionPerHour) * safeHigh) - (Number(penaltyPoints) || 0);
  return Math.max(Number(minFloor) || 10, Math.round(raw));
}

/**
 * Dynamically classifies an interval as NORMAL or HIGH_DEMAND from actual request load:
 *   DemandRatio = EligibleRequests / max(1, AvailableWorkstations)
 */
function classifySlotDemand(eligibleRequests, availableWorkstations, threshold = 1.5) {
  const reqCount = Math.max(0, Number(eligibleRequests) || 0);
  const availCount = Math.max(0, Number(availableWorkstations) || 0);
  const denom = Math.max(1, availCount);
  const demandRatio = parseFloat((reqCount / denom).toFixed(2));
  const thresh = Number(threshold) > 0 ? Number(threshold) : 1.5;
  const demandLevel = (availCount === 0 && reqCount > 0) || demandRatio >= thresh ? 'HIGH_DEMAND' : 'NORMAL';

  return {
    eligibleRequests: reqCount,
    availableWorkstations: availCount,
    demandRatio,
    demandLevel,
    threshold: thresh
  };
}

/**
 * Ranks an array of booking requests using the 4-tier deterministic lexicographic rules:
 * 1. Priority Score (P_u) descending (Higher score wins)
 * 2. Cumulative Eligible Wait Time (W_u) descending (Longer wait wins)
 * 3. Atomic Request Timestamp (t_req) ascending (Earlier submission wins)
 * 4. Stable Request/User ID ascending (Final deterministic tie-breaker)
 */
function rankBookingRequests(requests) {
  const ranked = [...requests].sort((a, b) => {
    // 1. Primary: Priority Score
    const scoreA = Number(a.priority_score_snapshot) || 0;
    const scoreB = Number(b.priority_score_snapshot) || 0;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    // 2. Secondary: Cumulative Wait Time (in seconds)
    const waitA = Number(a.wait_time_seconds) || 0;
    const waitB = Number(b.wait_time_seconds) || 0;
    if (waitB !== waitA) {
      return waitB - waitA;
    }

    // 3. Tertiary: Request Timestamp
    const timeA = new Date(a.requested_at || 0).getTime();
    const timeB = new Date(b.requested_at || 0).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    // 4. Quaternary: Deterministic Stable ID
    const idA = String(a.request_id || a.user_id || '');
    const idB = String(b.request_id || b.user_id || '');
    return idA.localeCompare(idB);
  });

  // Attach rank and tie-break explanations
  return ranked.map((req, index) => {
    let reason = 'Top baseline priority';
    if (index > 0) {
      const prev = ranked[index - 1];
      if ((Number(prev.priority_score_snapshot) || 0) > (Number(req.priority_score_snapshot) || 0)) {
        reason = `-${(Number(prev.priority_score_snapshot) || 0) - (Number(req.priority_score_snapshot) || 0)} pts score delta`;
      } else if ((Number(prev.wait_time_seconds) || 0) > (Number(req.wait_time_seconds) || 0)) {
        reason = `Equal score (${req.priority_score_snapshot} pts) · Preceded by ${Math.round(((Number(prev.wait_time_seconds) || 0) - (Number(req.wait_time_seconds) || 0)) / 60)}m longer wait`;
      } else if (new Date(prev.requested_at || 0).getTime() !== new Date(req.requested_at || 0).getTime()) {
        reason = `Equal score & wait · Timestamp tie-break (${new Date(req.requested_at).toLocaleTimeString()})`;
      } else {
        reason = `Equal score, wait & timestamp · Deterministic ID tie-break`;
      }
    } else {
      reason = `Rank #1 · Maximum score (${req.priority_score_snapshot} pts)`;
    }

    return {
      ...req,
      queue_rank: index + 1,
      tie_break_reason: reason
    };
  });
}

/**
 * Checks if student exceeds configurable daily booking hours or daily booking count limit
 */
function checkDailyBookingLimit(userId, bookingDate, requestedDurationMinutes = 60) {
  const db = getDb();
  const dateStr = bookingDate || new Date().toISOString().split('T')[0];
  const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
    max_daily_hours: 2.0,
    max_daily_bookings: 2,
    slot_interval_minutes: 60
  };

  const maxDailyHours = Number(policy.max_daily_hours) || 2.0;
  const maxDailyBookings = Number(policy.max_daily_bookings) || 2;
  const maxDailyMinutes = Math.round(maxDailyHours * 60);

  // Active/completed bookings on this date within the active semester
  const activeSem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();
  const bookedStats = activeSem
    ? db.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(duration_minutes), 0) as mins
        FROM bookings
        WHERE user_id = ?
          AND booking_date = ?
          AND semester_id = ?
          AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      `).get(userId, dateStr, activeSem.semester_id)
    : db.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(duration_minutes), 0) as mins
        FROM bookings
        WHERE user_id = ?
          AND booking_date = ?
          AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      `).get(userId, dateStr);

  // Pending queued requests on this date
  const queuedStats = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(duration_minutes), 0) as mins
    FROM booking_requests
    WHERE user_id = ?
      AND booking_date = ?
      AND status = 'QUEUED'
  `).get(userId, dateStr);

  const usedCount = (bookedStats.cnt || 0) + (queuedStats.cnt || 0);
  const usedMinutes = (bookedStats.mins || 0) + (queuedStats.mins || 0);
  const reqMins = Number(requestedDurationMinutes) || Number(policy.slot_interval_minutes) || 60;

  const exceedsBookings = (usedCount + 1) > maxDailyBookings;
  const exceedsHours = (usedMinutes + reqMins) > maxDailyMinutes;

  return {
    allowed: !exceedsBookings && !exceedsHours,
    date: dateStr,
    usedBookings: usedCount,
    maxDailyBookings,
    usedHours: parseFloat((usedMinutes / 60).toFixed(2)),
    requestedHours: parseFloat((reqMins / 60).toFixed(2)),
    maxDailyHours,
    remainingHours: parseFloat(Math.max(0, (maxDailyMinutes - usedMinutes) / 60).toFixed(2)),
    reason: exceedsHours
      ? `Daily time limit reached: ${(usedMinutes / 60).toFixed(1)}h already booked/queued on ${dateStr} (max ${maxDailyHours}h/day).`
      : exceedsBookings
      ? `Daily booking limit reached: ${usedCount} bookings/requests already active on ${dateStr} (max ${maxDailyBookings}/day).`
      : null
  };
}

/**
 * Checks if student exceeds maximum weekly peak booking frequency
 */
function checkBookingFrequencyLimit(userId, maxWeeklyBookings = 3) {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const count = db.prepare(`
    SELECT COUNT(*) as recent_count
    FROM bookings
    WHERE user_id = ?
      AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      AND booked_at >= ?
  `).get(userId, sevenDaysAgo).recent_count;

  return {
    allowed: count < maxWeeklyBookings,
    recentCount: count,
    maxWeeklyBookings
  };
}

/**
 * Returns cohort fairness leaderboard + live Gini & Jain distribution metrics
 */
function getFairnessLeaderboard(limit = 50) {
  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  if (!activeSem) return { semester: null, students: [], metrics: { gini: 0, jain: 1.0 } };

  const students = db.prepare(`
    SELECT sf.*, u.name, u.roll_no, u.department
    FROM student_fairness sf
    JOIN users u ON sf.user_id = u.user_id
    WHERE sf.semester_id = ? AND u.role = 'student'
    ORDER BY sf.current_score DESC, sf.cumulative_wait_seconds DESC, u.roll_no ASC
    LIMIT ?
  `).all(activeSem.semester_id, limit);

  const values = students.map(s => Number(s.total_hours_used) || Number(s.booking_count) || 0);
  const n = values.length;
  let gini = 0;
  let jain = 1.0;

  if (n > 0) {
    const totalSum = values.reduce((a, b) => a + b, 0);
    if (totalSum > 0) {
      let sumDiffs = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          sumDiffs += Math.abs(values[i] - values[j]);
        }
      }
      gini = parseFloat((sumDiffs / (2 * n * totalSum)).toFixed(4));
      const sumSq = values.reduce((a, b) => a + b * b, 0);
      jain = parseFloat(((totalSum * totalSum) / (n * sumSq)).toFixed(4));
    }
  }

  return {
    semester: activeSem,
    students,
    metrics: {
      totalStudents: n,
      giniCoefficient: gini,
      jainsFairnessIndex: jain,
      avgScore: n > 0 ? Math.round(students.reduce((a, s) => a + s.current_score, 0) / n) : 100,
      avgHoursUsed: n > 0 ? parseFloat((students.reduce((a, s) => a + (Number(s.total_hours_used) || 0), 0) / n).toFixed(2)) : 0
    }
  };
}

/**
 * Executes Semester Reset:
 * - Archives current term
 * - Resets all students' booking_count = 0, total_hours_used = 0, high_demand_count = 0, high_demand_hours = 0, current_score = base_score
 * - Preserves all historical bookings, allocation history, and audit logs
 */
function executeSemesterReset(actorId, actorName, newSemesterName, ipAddress = '127.0.0.1') {
  const db = getDb();

  const resetTx = db.transaction(() => {
    const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get() || {
      base_score: 100,
      deduction_per_booking: 10
    };

    db.prepare("UPDATE semesters SET status = 'archived' WHERE status = 'active'").run();

    const newSemId = `sem-${Date.now()}`;
    const semName = newSemesterName || `Term ${new Date().getFullYear()} Cycle · Active`;
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().split('T')[0];

    db.prepare(`
      INSERT INTO semesters (semester_id, name, start_date, end_date, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(newSemId, semName, startDate, endDate);

    const students = db.prepare("SELECT user_id FROM users WHERE role = 'student'").all();
    const insertFairness = db.prepare(`
      INSERT INTO student_fairness (
        fairness_id, user_id, semester_id, initial_score, current_score,
        booking_count, total_hours_used, high_demand_count, high_demand_hours,
        cumulative_wait_seconds, penalty_points
      )
      VALUES (?, ?, ?, ?, ?, 0, 0.0, 0, 0.0, 0, 0)
    `);

    for (const student of students) {
      const fairnessId = `fair-${student.user_id}-${newSemId}`;
      insertFairness.run(fairnessId, student.user_id, newSemId, policy.base_score, policy.base_score);
    }

    db.prepare(`
      INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details, ip_address)
      VALUES (?, ?, ?, 'admin', 'SEMESTER_RESET', 'semesters', ?, ?, ?)
    `).run(
      `audit-${Date.now()}`,
      actorId,
      actorName,
      newSemId,
      `Executed semester reset for "${semName}". Reset priority points to ${policy.base_score} and hours/high-demand counters to 0 for ${students.length} students. Historical records preserved.`,
      ipAddress
    );

    return {
      semesterId: newSemId,
      semesterName: semName,
      resetStudentsCount: students.length,
      initialScore: policy.base_score
    };
  });

  return resetTx();
}

module.exports = {
  calculatePriorityScore,
  calculateHoursDemandScore,
  classifySlotDemand,
  rankBookingRequests,
  checkDailyBookingLimit,
  checkBookingFrequencyLimit,
  getFairnessLeaderboard,
  executeSemesterReset
};
