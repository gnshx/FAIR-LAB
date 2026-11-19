const assert = require('assert');
const { getDb } = require('../backend/db/database');
const {
  getLabAvailability,
  validateCustomInterval,
  invalidateAvailabilityCache,
  resolveWorkstation
} = require('../backend/services/availabilityService');
const {
  submitBookingRequest,
  submitHybridBookingRequest,
  runWindowAllocationRound
} = require('../backend/services/bookingService');
const { verifyToken, recordCheckIn, recordCheckOut } = require('../backend/services/verificationService');
const { runThreePolicyComparison } = require('../backend/services/analyticsService');

async function runCustomIntervalSuite() {
  console.log('================================================================');
  console.log('FAIRLAB V3 SUITE: CUSTOM [start, end) INTERVALS & MULTI-PREF');
  console.log('================================================================');

  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  assert(activeSem, 'Active semester must exist');

  const testDate = '2026-12-29';

  const cleanup = () => {
    db.prepare("UPDATE workstations SET status = 'AVAILABLE' WHERE display_label IN ('A-R1-PC01', 'A-R3-PC01', 'A-R3-PC02', 'A-R3-PC03') AND status = 'MAINTENANCE'").run();
    db.prepare("DELETE FROM entry_logs WHERE user_id LIKE 'usr-v3-%'").run();
    db.prepare("DELETE FROM allocation_history WHERE user_id LIKE 'usr-v3-%'").run();
    db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-v3-%'").run();
    db.prepare("DELETE FROM bookings WHERE booking_date = ? OR user_id LIKE 'usr-v3-%'").run(testDate);
    db.prepare("DELETE FROM allocation_rounds WHERE booking_date = ?").run(testDate);
    db.prepare("DELETE FROM waitlist_entries WHERE booking_date = ? OR user_id LIKE 'usr-v3-%'").run(testDate);
    db.prepare("DELETE FROM booking_requests WHERE booking_date = ? OR user_id LIKE 'usr-v3-%'").run(testDate);
    db.prepare("DELETE FROM student_fairness WHERE user_id LIKE 'usr-v3-%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'usr-v3-%'").run();
    db.prepare("DELETE FROM ticket_releases WHERE release_id = ?").run(`rel-v3-${testDate}`);
    db.prepare("DELETE FROM lab_date_overrides WHERE override_date = ?").run(testDate);
    invalidateAvailabilityCache();
  };

  cleanup();

  try {
    db.prepare(`
      INSERT OR REPLACE INTO lab_date_overrides (override_id, lab_id, override_date, override_type, is_open, open_time, close_time, ignore_timetable, reason)
      VALUES (?, 'lab-l106', ?, 'EXTRA_DAY', 1, '09:00', '18:00', 1, 'Isolated custom-interval test day')
    `).run(`ovr-${testDate}`, testDate);
    db.prepare(`
      INSERT OR REPLACE INTO ticket_releases (release_id, lab_id, release_date, start_time, end_time, total_tickets, status, title)
      VALUES (?, 'lab-l106', ?, '00:00', '23:59', 100, 'RELEASED', 'V3 Test Drop')
    `).run(`rel-v3-${testDate}`, testDate);
    // Seed test students
    const users = [
      { id: 'usr-v3-a', name: 'Student A', roll: 'V3-A', score: 70 },
      { id: 'usr-v3-b', name: 'Student B', roll: 'V3-B', score: 95 },
      { id: 'usr-v3-c', name: 'Student C', roll: 'V3-C', score: 85 },
      { id: 'usr-v3-imm', name: 'Student Immediate', roll: 'V3-IMM', score: 100 }
    ];
    for (const u of users) {
      db.prepare("INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES (?, ?, ?, ?, 'student', 'CSE')")
        .run(u.id, u.name, u.roll, `${u.id}@iitbhilai.ac.in`);
      db.prepare(`
        INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, total_hours_used, high_demand_count, high_demand_hours, penalty_points)
        VALUES (?, ?, ?, 100, ?, 0, 0, 0, 0, 0)
      `).run(`fair-${u.id}`, u.id, activeSem.semester_id, u.score);
    }

    // -----------------------------------------------------------------------
    // TEST 1: Invalid Custom Interval Guardrails
    // -----------------------------------------------------------------------
    console.log('\n[Test 1] Custom Interval Validation (Hours 09:00-18:00, Duration 30m-240m)');
    const policy = db.prepare('SELECT * FROM policy_config WHERE id = 1').get();
    assert.throws(() => validateCustomInterval('08:30', '09:30', policy), /operating hours/i);
    assert.throws(() => validateCustomInterval('17:30', '18:30', policy), /operating hours/i);
    assert.throws(() => validateCustomInterval('10:00', '10:15', policy), /minimum/i);
    assert.throws(() => validateCustomInterval('09:00', '15:00', policy), /maximum/i);
    assert.throws(() => validateCustomInterval('12:00', '11:00', policy), /after start/i);
    const ok = validateCustomInterval('10:30', '12:15', policy);
    assert.strictEqual(ok.durationMinutes, 105);
    console.log('  PASS: 10:30-12:15 (105m) accepted; out-of-hours, <30m, >240m, and inverted windows rejected.');

    // -----------------------------------------------------------------------
    // TEST 2: Half-Open [start, end) Back-to-Back vs Overlap + DB Trigger
    // -----------------------------------------------------------------------
    console.log('\n[Test 2] Half-Open [10:00, 11:30) vs Overlap [11:00, 12:00) vs Back-to-Back [11:30, 12:30)');
    // Student A immediately books A-R1-PC01 for [10:00, 11:30)
    const resA = await submitHybridBookingRequest({
      userId: 'usr-v3-a',
      bookingDate: testDate,
      startTime: '10:00',
      endTime: '11:30',
      preferredWorkstations: ['A-R1-PC01'],
      computePurpose: 'Half-open baseline booking',
      allocationMode: 'AUTO'
    });
    assert.strictEqual(resA.status, 'CONFIRMED');
    assert.strictEqual(resA.allocationMode, 'IMMEDIATE');
    assert.strictEqual(resA.booking.displayLabel, 'A-R1-PC01');

    // Availability query for overlapping [11:00, 12:00) MUST mark A-R1-PC01 as BOOKED
    const availOverlap = getLabAvailability('lab-l106', testDate, null, '11:00', '12:00');
    const seatOverlap = availOverlap.workstations.find(w => w.display_label === 'A-R1-PC01');
    assert.strictEqual(seatOverlap.slot_available, false);
    assert.strictEqual(seatOverlap.slot_status, 'BOOKED');

    // Direct SQLite database trigger MUST physically block an overlapping insert on A-R1-PC01 [11:00, 12:00)
    const pc01 = resolveWorkstation('A-R1-PC01');
    let triggerBlocked = false;
    try {
      db.prepare(`
        INSERT INTO bookings (booking_id, user_id, machine_id, booking_date, start_time, end_time, duration_minutes, semester_id, status)
        VALUES ('L106-TRIG-TEST', 'usr-v3-b', ?, ?, '11:00', '12:00', 60, ?, 'CONFIRMED')
      `).run(pc01.machine_id, testDate, activeSem.semester_id);
    } catch (e) {
      triggerBlocked = e.message.includes('OVERLAP_CONFLICT');
    }
    assert.strictEqual(triggerBlocked, true, 'SQLite BEFORE INSERT trigger must block overlapping custom intervals');

    // Availability query for back-to-back [11:30, 12:30) MUST mark A-R1-PC01 as AVAILABLE!
    const availBackToBack = getLabAvailability('lab-l106', testDate, null, '11:30', '12:30');
    const seatB2B = availBackToBack.workstations.find(w => w.display_label === 'A-R1-PC01');
    assert.strictEqual(seatB2B.slot_available, true, 'Back-to-back [11:30, 12:30) must NOT conflict with [10:00, 11:30)');

    const resC = await submitHybridBookingRequest({
      userId: 'usr-v3-c',
      bookingDate: testDate,
      startTime: '11:30',
      endTime: '12:30',
      preferredWorkstations: ['A-R1-PC01'],
      computePurpose: 'Back-to-back half-open booking',
      allocationMode: 'AUTO'
    });
    assert.strictEqual(resC.status, 'CONFIRMED');
    assert.strictEqual(resC.booking.displayLabel, 'A-R1-PC01');
    console.log('  PASS: Overlap [11:00, 12:00) blocked by Availability + DB Trigger; Back-to-Back [11:30, 12:30) confirmed on A-R1-PC01.');

    // -----------------------------------------------------------------------
    // TEST 3: Ranked Multi-Preference Matching (Spec Section 19.1 Example)
    // -----------------------------------------------------------------------
    console.log('\n[Test 3] Ranked Multi-Preference Matching (B:95 > C:85 > A:70 on Custom 14:15-15:45)');
    // All 3 queue for custom interval 14:15-15:45 (90 min) with competing preferences on Block A Row 3
    // Clean up prior bookings for test users on testDate so daily quota is fresh for this test
    db.prepare("DELETE FROM access_passes WHERE user_id IN ('usr-v3-a', 'usr-v3-b', 'usr-v3-c')").run();
    db.prepare("DELETE FROM bookings WHERE booking_date = ? AND user_id IN ('usr-v3-a', 'usr-v3-b', 'usr-v3-c')").run(testDate);
    db.prepare("DELETE FROM booking_requests WHERE booking_date = ? AND user_id IN ('usr-v3-a', 'usr-v3-b', 'usr-v3-c')").run(testDate);

    submitBookingRequest({
      userId: 'usr-v3-a',
      bookingDate: testDate,
      startTime: '14:15',
      endTime: '15:45',
      preferredWorkstations: ['A-R3-PC01', 'A-R3-PC02'],
      computePurpose: 'Student A (70 pts)',
      allocationMode: 'SCHEDULED'
    });
    submitBookingRequest({
      userId: 'usr-v3-b',
      bookingDate: testDate,
      startTime: '14:15',
      endTime: '15:45',
      preferredWorkstations: ['A-R3-PC01', 'A-R3-PC03'],
      computePurpose: 'Student B (95 pts)',
      allocationMode: 'SCHEDULED'
    });
    submitBookingRequest({
      userId: 'usr-v3-c',
      bookingDate: testDate,
      startTime: '14:15',
      endTime: '15:45',
      preferredWorkstations: ['A-R3-PC02', 'A-R3-PC03'],
      computePurpose: 'Student C (85 pts)',
      allocationMode: 'SCHEDULED'
    });

    // Verify availability API surfaces PENDING status on A-R3-PC01 before round runs
    const availPend = getLabAvailability('lab-l106', testDate, null, '14:15', '15:45');
    const r3p1 = availPend.workstations.find(w => w.display_label === 'A-R3-PC01');
    assert.strictEqual(r3p1.slot_status, 'PENDING', 'Contested preferred seat must display PENDING before allocation');

    // Run window allocation round
    const roundRes = await runWindowAllocationRound({
      bookingDate: testDate,
      startTime: '14:15',
      endTime: '15:45'
    });
    assert.strictEqual(roundRes.allocatedCount, 3);
    assert(roundRes.roundId, 'allocation_rounds audit row must be created');

    const allocB = roundRes.allocations.find(a => a.userId === 'usr-v3-b');
    const allocC = roundRes.allocations.find(a => a.userId === 'usr-v3-c');
    const allocA = roundRes.allocations.find(a => a.userId === 'usr-v3-a');
    assert.strictEqual(allocB.displayLabel, 'A-R3-PC01', 'B (95 pts) must win Pref #1 A-R3-PC01');
    assert.strictEqual(allocC.displayLabel, 'A-R3-PC02', 'C (85 pts) must win Pref #1 A-R3-PC02');
    assert.notStrictEqual(allocA.displayLabel, 'A-R3-PC01');
    assert.notStrictEqual(allocA.displayLabel, 'A-R3-PC02');

    const roundRow = db.prepare('SELECT * FROM allocation_rounds WHERE round_id = ?').get(roundRes.roundId);
    assert.strictEqual(roundRow.policy_version, 'fairlab-v2');
    assert.strictEqual(roundRow.allocated_count, 3);
    console.log(`  PASS: B(95)->${allocB.displayLabel}, C(85)->${allocC.displayLabel}, A(70)->${allocA.displayLabel} (Audit round ${roundRes.roundId}).`);

    // -----------------------------------------------------------------------
    // TEST 4: Custom-Interval QR Pass Verify, Check-In & 1.5h Duration Checkout
    // -----------------------------------------------------------------------
    console.log('\n[Test 4] Custom-Interval (1.5h) End-to-End QR Pass Verify -> Check-In -> Check-Out');
    const immRes = await submitHybridBookingRequest({
      userId: 'usr-v3-imm',
      bookingDate: testDate,
      startTime: '16:00',
      endTime: '17:30',
      preferredWorkstations: ['B-R1-PC01'],
      computePurpose: 'Custom 90m checkout test',
      allocationMode: 'AUTO'
    });
    assert.strictEqual(immRes.status, 'CONFIRMED');
    assert(immRes.pass && immRes.pass.signedToken, 'Immediate custom booking must issue signed QR pass');

    const verdict = verifyToken(immRes.pass.signedToken);
    assert.strictEqual(verdict.authorized, true);
    assert.strictEqual(verdict.workstation.display_label, 'B-R1-PC01');

    recordCheckIn(immRes.pass.passId, 'usr-watchman-ram');
    const co = recordCheckOut(immRes.booking.bookingId, 'usr-watchman-ram');
    assert.strictEqual(co.durationHours, 1.5);
    // 1.5h NORMAL * 5 pts/hr = 7.5 -> rounded 100 - 7.5 = 93 pts (deduction 7 or 8)
    assert.strictEqual(co.scoreBefore, 100);
    assert.strictEqual(co.scoreAfter, 93, '1.5h NORMAL checkout must deduct round(7.5) -> 93 pts');
    console.log(`  PASS: Custom 1.5h booking on B-R1-PC01 verified, checked-in, checked-out (100 -> ${co.scoreAfter} pts).`);

    // -----------------------------------------------------------------------
    // TEST 5: 3-Policy Research Comparison (FIFO vs Basic FairLab vs FairLab v2)
    // -----------------------------------------------------------------------
    console.log('\n[Test 5] 3-Policy Research Benchmark (FIFO vs Basic FairLab vs FairLab v2)');
    const comp = runThreePolicyComparison(120, 60, 10, 1337, 'MIXED_PEAK_AND_BOT');
    assert.strictEqual(comp.policies.length, 3);
    const [pFifo, pBasic, pV2] = comp.policies;
    assert(pV2.giniCoefficient < pFifo.giniCoefficient, 'FairLab v2 Gini must beat FIFO');
    assert(pV2.highDemandGini <= pBasic.highDemandGini + 0.02, 'FairLab v2 peak-slot Gini must match/beat Basic FairLab');
    assert(pV2.jainsFairnessIndex > 0.98, `FairLab v2 Jain Index should exceed 0.98, got ${pV2.jainsFairnessIndex}`);
    assert.strictEqual(pV2.zeroAllocationPct, 0, 'FairLab v2 must have 0% zero-allocation');
    console.table(comp.policies.map(p => ({
      Policy: p.policy,
      Gini: p.giniCoefficient,
      PeakGini: p.highDemandGini,
      Jain: p.jainsFairnessIndex,
      MaxWait: p.maxWaitingCycles,
      ZeroAllocPct: p.zeroAllocationPct,
      UtilPct: p.utilizationPct
    })));

    console.log('\n================================================================');
    console.log('ALL 5 V3 CUSTOM-INTERVAL & MULTI-PREFERENCE TESTS PASSED!');
    console.log('================================================================');
  } finally {
    cleanup();
  }
}

runCustomIntervalSuite().catch(err => {
  console.error('V3 Suite Failed:', err);
  process.exit(1);
});

