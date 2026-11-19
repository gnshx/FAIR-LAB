const assert = require('assert');
const { getDb } = require('../backend/db/database');
const {
  calculateHoursDemandScore,
  classifySlotDemand,
  checkDailyBookingLimit
} = require('../backend/services/fairnessEngine');
const {
  getLabAvailability,
  getWorkstationAvailability,
  syncLabSlotsFromPolicy,
  invalidateAvailabilityCache
} = require('../backend/services/availabilityService');
const {
  submitBookingRequest,
  runAllocationRound,
  processNoShows
} = require('../backend/services/bookingService');
const { toggleWorkstationMaintenance } = require('../backend/services/gpuResourceService');
const { recordCheckOut } = require('../backend/services/verificationService');

async function runSuite() {
  console.log('================================================================');
  console.log('FAIRLAB V2 SUITE: 84-SEAT MAP, HOURS+PEAK FAIRNESS & BENCHMARKS');
  console.log('================================================================');

  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  assert(activeSem, 'Active semester must exist');

  const testDate = '2026-12-28'; // Isolated future date so live today seed data stays clean

  const cleanup = () => {
    db.prepare("DELETE FROM entry_logs WHERE user_id LIKE 'usr-v2-%'").run();
    db.prepare("DELETE FROM allocation_history WHERE user_id LIKE 'usr-v2-%'").run();
    db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-v2-%' OR booking_id IN (SELECT booking_id FROM bookings WHERE booking_date = ?)").run(testDate);
    db.prepare("DELETE FROM bookings WHERE booking_date = ? OR user_id LIKE 'usr-v2-%'").run(testDate);
    db.prepare("DELETE FROM waitlist_entries WHERE booking_date = ? OR user_id LIKE 'usr-v2-%'").run(testDate);
    db.prepare("DELETE FROM booking_requests WHERE booking_date = ? OR user_id LIKE 'usr-v2-%'").run(testDate);
    db.prepare("DELETE FROM student_fairness WHERE user_id LIKE 'usr-v2-%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'usr-v2-%'").run();
    db.prepare("DELETE FROM ticket_releases WHERE release_id = ?").run(`rel-v2-${testDate}`);
    db.prepare("DELETE FROM lab_slots WHERE slot_id LIKE 'slot-conc-%' OR slot_id LIKE 'slot-term2-%' OR slot_id LIKE 'slot-audit-%'").run();
    db.prepare("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL, active_job = NULL WHERE machine_id = 'L106-PC-83'").run();
    invalidateAvailabilityCache();
  };

  cleanup();
  const { ensureTodayBookingsSeeded } = require('../backend/db/seed');
  ensureTodayBookingsSeeded(db);
  invalidateAvailabilityCache();

  db.prepare(`
    INSERT OR REPLACE INTO ticket_releases (release_id, lab_id, release_date, start_time, end_time, total_tickets, status, title)
    VALUES (?, 'lab-l106', ?, '00:00', '23:59', 100, 'RELEASED', 'V2 Test Drop')
  `).run(`rel-v2-${testDate}`, testDate);

  try {
    // -----------------------------------------------------------------------
    // TEST 1: 84-Workstation Layout + Independent Daily Occupancy vs Slot Free
    // -----------------------------------------------------------------------
    console.log('\n[Test 1] 84-Workstation Map (Block A 6x10 + Block B 4x6) & Occupancy vs Interval');
    const availToday = getLabAvailability('lab-l106', null, 'slot-6');
    assert.strictEqual(availToday.summary.totalWorkstations, 84, 'Total workstations must be 84');
    assert.strictEqual(availToday.summary.blockACount, 60, 'Block A must have 60 workstations');
    assert.strictEqual(availToday.summary.blockBCount, 24, 'Block B must have 24 workstations');
    assert.strictEqual(availToday.slots.length, 9, '09:00-18:00 at 60m interval must produce 9 slots');

    // Verify L106-PC-05 has valid daily occupancy and is AVAILABLE for slot-6 (14:00-15:00)
    const pc05 = availToday.workstations.find(w => w.machine_id === 'L106-PC-05');
    assert(pc05, 'L106-PC-05 must exist');
    assert.strictEqual(pc05.block_code, 'A');
    assert.strictEqual(pc05.display_label, 'A-R1-PC05');
    assert(typeof pc05.daily_occupancy_pct === 'number' && pc05.daily_occupancy_pct >= 0, `Expected valid occupancy pct, got ${pc05.daily_occupancy_pct}`);
    assert.strictEqual(pc05.slot_available, true, 'Machine must still be bookable in a free interval!');
    console.log(`  PASS: 84 seats verified (A=60, B=24). A-R1-05 is ${pc05.daily_occupancy_pct}% daily occupied (${pc05.occupancy_band}) yet FREE for 14:00-15:00.`);

    // -----------------------------------------------------------------------
    // TEST 2: Duration-Based + High-Demand Fairness Formula
    // -----------------------------------------------------------------------
    console.log('\n[Test 2] Hours + High-Demand Fairness Formula (P_u = max(10, 100 - 5*T_u - 10*T_H))');
    assert.strictEqual(calculateHoursDemandScore({ totalHoursUsed: 2, highDemandHours: 0 }), 90);
    assert.strictEqual(calculateHoursDemandScore({ totalHoursUsed: 2, highDemandHours: 2 }), 70);
    assert.strictEqual(calculateHoursDemandScore({ totalHoursUsed: 5, highDemandHours: 1 }), 65);
    assert.strictEqual(calculateHoursDemandScore({ totalHoursUsed: 0, highDemandHours: 0 }), 100);
    // Fractional hours (0.5h normal = -2.5 -> 98) & Floor saturation (20h -> floor 10)
    assert.strictEqual(calculateHoursDemandScore({ totalHoursUsed: 0.5, highDemandHours: 0 }), 98);
    assert.strictEqual(calculateHoursDemandScore({ totalHoursUsed: 20, highDemandHours: 10 }), 10);
    console.log('  PASS: Verified exact proposal table (90, 70, 65, 100), 0.5h scaling (98), and floor protection (10).');

    // -----------------------------------------------------------------------
    // TEST 3: DemandRatio Auto-Detection
    // -----------------------------------------------------------------------
    console.log('\n[Test 3] Dynamic High-Demand Auto-Detection via DemandRatio');
    const lowD = classifySlotDemand(8, 10, 1.5);
    const highD = classifySlotDemand(40, 10, 1.5);
    assert.strictEqual(lowD.demandLevel, 'NORMAL');
    assert.strictEqual(lowD.demandRatio, 0.8);
    assert.strictEqual(highD.demandLevel, 'HIGH_DEMAND');
    assert.strictEqual(highD.demandRatio, 4.0);
    console.log(`  PASS: 8/10 -> ${lowD.demandLevel} (${lowD.demandRatio}), 40/10 -> ${highD.demandLevel} (${highD.demandRatio}).`);

    // Create test students for live DB flows
    const testUsers = [
      { id: 'usr-v2-high', name: 'V2 High Priority', roll: 'V2-001', score: 100, hrs: 0, peakHrs: 0 },
      { id: 'usr-v2-low', name: 'V2 Low Priority', roll: 'V2-002', score: 65, hrs: 5, peakHrs: 1 },
      { id: 'usr-v2-wait', name: 'V2 Waitlisted', roll: 'V2-003', score: 90, hrs: 2, peakHrs: 0 }
    ];
    for (const u of testUsers) {
      db.prepare(`INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES (?, ?, ?, ?, 'student', 'CSE')`)
        .run(u.id, u.name, u.roll, `${u.id}@iitbhilai.ac.in`);
      db.prepare(`
        INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, total_hours_used, high_demand_count, high_demand_hours, penalty_points)
        VALUES (?, ?, ?, 100, ?, ?, ?, ?, ?, 0)
      `).run(`fair-${u.id}`, u.id, activeSem.semester_id, u.score, u.hrs, u.hrs, u.peakHrs, u.peakHrs);
    }

    // -----------------------------------------------------------------------
    // TEST 4: Hybrid Seat Preference + Fairness Authority + Idempotency
    // -----------------------------------------------------------------------
    console.log('\n[Test 4] Hybrid Preferred Seat + Fairness Authority + Idempotency');
    // Both students want L106-PC-83 on testDate slot-1; lower-priority submits FIRST, higher-priority submits SECOND!
    const rLow = submitBookingRequest({
      userId: 'usr-v2-low',
      slotId: 'slot-1',
      bookingDate: testDate,
      preferredMachineId: 'L106-PC-83',
      computePurpose: 'Low score early request',
      researchField: 'Systems',
      idempotencyKey: 'idemp-v2-low-1'
    });
    // Replay exact same idempotency key -> must not create duplicate
    const rLowReplay = submitBookingRequest({
      userId: 'usr-v2-low',
      slotId: 'slot-1',
      bookingDate: testDate,
      preferredMachineId: 'L106-PC-83',
      computePurpose: 'Low score early request',
      researchField: 'Systems',
      idempotencyKey: 'idemp-v2-low-1'
    });
    assert.strictEqual(rLow.requestId, rLowReplay.requestId, 'Idempotency key must return identical requestId');
    assert.strictEqual(rLowReplay.idempotentReplay, true);

    submitBookingRequest({
      userId: 'usr-v2-high',
      slotId: 'slot-1',
      bookingDate: testDate,
      preferredMachineId: 'L106-PC-83',
      computePurpose: 'High score later request',
      researchField: 'Systems'
    });

    // Run allocation with cap = 1 (forces contention: 2 requests / 1 cap => DemandRatio = 2.0 => HIGH_DEMAND!)
    const round1 = await runAllocationRound('slot-1', 1, testDate);
    assert.strictEqual(round1.allocatedCount, 1);
    assert.strictEqual(round1.waitlistedCount, 1);
    assert.strictEqual(round1.demandLevel, 'HIGH_DEMAND', '2 requests for 1 slot must auto-detect HIGH_DEMAND');
    assert.strictEqual(round1.allocations[0].userId, 'usr-v2-high', 'Higher fairness score (100) must beat earlier low-score (65)');
    assert.strictEqual(round1.allocations[0].machineId, 'L106-PC-83', 'Winner preferred seat must be honored');
    assert.strictEqual(round1.allocations[0].preferenceHonored, true);
    console.log('  PASS: 100-pt student beat earlier 65-pt student, won preferred seat L106-PC-83, DemandRatio=2.0 -> HIGH_DEMAND.');

    // Verify checkout under active default policy (high_demand_deduction_per_hour=0 -> uniform 5 pts/hr)
    const coRes = recordCheckOut(round1.allocations[0].bookingId, 'usr-watchman-ram');
    assert.strictEqual(coRes.durationHours, 1);
    assert.strictEqual(coRes.demandLevel, 'HIGH_DEMAND');
    assert.strictEqual(coRes.scoreBefore, 100);
    assert.strictEqual(coRes.scoreAfter, 95, '1h checkout under default policy (peak surcharge=0) must deduct 5 pts (100 -> 95)');
    console.log('  PASS: 1h checkout deducted 5 pts (100 -> 95) with high-demand surcharge disabled (0 pts/hr) by default.');

    // -----------------------------------------------------------------------
    // TEST 5: Daily Max Limit Enforcement (2.0h / 2 bookings max per day)
    // -----------------------------------------------------------------------
    console.log('\n[Test 5] Configurable Daily Max Hours & Booking Limit Enforcement');
    // usr-v2-high already completed 1h (slot-1) on testDate; book 2nd hour (slot-2) -> allowed
    submitBookingRequest({ userId: 'usr-v2-high', slotId: 'slot-2', bookingDate: testDate, computePurpose: 'Second hour lab', researchField: 'CSE' });
    // Attempt 3rd hour (slot-3) -> must be rejected by daily max limit!
    let dailyRejected = false;
    try {
      submitBookingRequest({ userId: 'usr-v2-high', slotId: 'slot-3', bookingDate: testDate, computePurpose: 'Exceeding daily cap', researchField: 'CSE' });
    } catch (e) {
      dailyRejected = e.message.toLowerCase().includes('daily');
    }
    assert.strictEqual(dailyRejected, true, '3rd hour on same day must be blocked by configurable 2.0h daily limit');
    console.log('  PASS: 3rd hour request cleanly blocked by configurable 2.0h/day quota.');

    // -----------------------------------------------------------------------
    // TEST 6: Workstation Offline Automatic Reallocation
    // -----------------------------------------------------------------------
    console.log('\n[Test 6] Workstation Offline Automatic Reallocation');
    const round2 = await runAllocationRound('slot-2', 1, testDate);
    const bookedMachine = round2.allocations[0].machineId;
    const bookedId = round2.allocations[0].bookingId;

    // Take bookedMachine offline -> booking must automatically move to another free machine!
    const maintRes = toggleWorkstationMaintenance(bookedMachine, true, 'usr-admin-sharma');
    assert(maintRes.reallocatedCount >= 1, 'Expected active booking to be automatically reallocated');
    const updatedBooking = db.prepare('SELECT machine_id, status FROM bookings WHERE booking_id = ?').get(bookedId);
    assert.strictEqual(updatedBooking.status, 'CONFIRMED');
    assert.notStrictEqual(updatedBooking.machine_id, bookedMachine, 'Booking must move to a replacement workstation');
    // Restore machine back online
    toggleWorkstationMaintenance(bookedMachine, false, 'usr-admin-sharma');
    console.log(`  PASS: Offline ${bookedMachine} automatically reallocated ${bookedId} -> ${updatedBooking.machine_id}.`);

    // -----------------------------------------------------------------------
    // TEST 7: No-Show Grace Period Recovery & Automatic Waitlist Promotion
    // -----------------------------------------------------------------------
    console.log('\n[Test 7] No-Show Recovery + Penalty + Automatic Waitlist Promotion');
    // Submit usr-v2-wait for slot-1 on testDate and verify slot-1 already has usr-v2-low waitlisted!
    // Allocate usr-v2-wait on slot-4 (cap 1), waitlist usr-v2-low on slot-4, then force No-Show on usr-v2-wait!
    submitBookingRequest({ userId: 'usr-v2-wait', slotId: 'slot-4', bookingDate: testDate, preferredMachineId: 'L106-PC-83', computePurpose: 'Will no-show', researchField: 'CSE' });
    submitBookingRequest({ userId: 'usr-v2-low', slotId: 'slot-4', bookingDate: testDate, preferredMachineId: 'L106-PC-83', computePurpose: 'Waitlist candidate', researchField: 'CSE' });

    const r4 = await runAllocationRound('slot-4', 1, testDate);
    assert.strictEqual(r4.allocations[0].userId, 'usr-v2-wait');
    const nsBookingId = r4.allocations[0].bookingId;

    const nsRes = await processNoShows({ bookingId: nsBookingId, force: true });
    assert.strictEqual(nsRes.noShowCount, 1);
    assert.strictEqual(nsRes.processed[0].penaltyApplied, 5);
    assert.strictEqual(nsRes.promotedCount, 1, 'Waitlisted student must be automatically promoted when no-show releases seat!');
    assert.strictEqual(nsRes.promotions[0].userId, 'usr-v2-low');
    console.log(`  PASS: No-show marked (-5 pts), seat freed, and waitlisted student (${nsRes.promotions[0].userId}) auto-promoted.`);

    // -----------------------------------------------------------------------
    // TEST 8: Configurable Lab Schedule Sync (30-min intervals -> restore 60-min)
    // -----------------------------------------------------------------------
    console.log('\n[Test 8] Configurable Schedule Sync (09:00-18:00 @ 30m -> 18 slots, then restore 60m -> 9 slots)');
    db.prepare('UPDATE policy_config SET slot_interval_minutes = 30 WHERE id = 1').run();
    const slots30 = syncLabSlotsFromPolicy('lab-l106');
    assert.strictEqual(slots30.length, 18, '09:00-18:00 at 30m must generate 18 slots');

    db.prepare('UPDATE policy_config SET slot_interval_minutes = 60 WHERE id = 1').run();
    const slots60 = syncLabSlotsFromPolicy('lab-l106');
    assert.strictEqual(slots60.length, 9, 'Restoring 60m interval must generate 9 slots');
    console.log('  PASS: Dynamic interval regeneration verified (18 half-hour slots <-> 9 hourly slots).');

    // -----------------------------------------------------------------------
    // TEST 9: 1,000+ Availability Queries Performance Benchmark
    // -----------------------------------------------------------------------
    console.log('\n[Test 9] Performance Benchmark: 1,000 Availability Queries (Cold DB + Cached)');
    const coldSamples = [];
    for (let i = 0; i < 100; i++) {
      invalidateAvailabilityCache();
      const t0 = performance.now();
      getLabAvailability('lab-l106', null, 'slot-6');
      coldSamples.push(performance.now() - t0);
    }
    coldSamples.sort((a, b) => a - b);
    const coldP50 = coldSamples[Math.floor(coldSamples.length * 0.5)].toFixed(2);
    const coldP95 = coldSamples[Math.floor(coldSamples.length * 0.95)].toFixed(2);

    const tWarmStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      getLabAvailability('lab-l106', null, 'slot-6');
    }
    const warmTotalMs = performance.now() - tWarmStart;
    const qps = Math.round(1000 / (warmTotalMs / 1000));
    assert(parseFloat(coldP95) < 50, `Cold availability query p95 should be < 50ms, got ${coldP95}ms`);
    console.log(`  PASS: Cold DB (84 seats) p50=${coldP50}ms, p95=${coldP95}ms | 1,000 cached queries in ${warmTotalMs.toFixed(1)}ms (~${qps.toLocaleString()} qps).`);

    console.log('\n================================================================');
    console.log('ALL 9 V2 SEAT-MAP, FAIRNESS & PERFORMANCE TESTS PASSED!');
    console.log('================================================================');
  } finally {
    cleanup();
  const { ensureTodayBookingsSeeded } = require('../backend/db/seed');
  ensureTodayBookingsSeeded(db);
  // Ensure seed bookings for PC-05 are in CONFIRMED status for occupancy calculation
  db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE machine_id = 'L106-PC-05' AND booking_id LIKE 'L106-SEED-%'").run();
  invalidateAvailabilityCache();
  }
}

runSuite().catch(err => {
  console.error('V2 Suite Failed:', err);
  process.exit(1);
});

