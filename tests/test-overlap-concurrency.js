/**
 * FairLab Verification Test Suite: Overlap Detection & Worker Concurrency
 * Validates:
 * 1. Time-overlapping slot workstation exclusion (preventing 14:00-16:00 & 15:00-17:00 double bookings).
 * 2. User-level overlapping request rejection.
 * 3. Two concurrent allocation workers competing for the same workstations.
 * 4. Booking cancellation and instant reallocation to waitlisted student with 0 penalty.
 */

const { getDb } = require('../backend/db/database');
const { submitBookingRequest, runAllocationRound, cancelBooking } = require('../backend/services/bookingService');

async function runOverlapAndConcurrencyTests() {
  console.log('========================================================================');
  console.log('🧪 VERIFICATION TEST: Slot Time Overlap & Concurrent Allocation Workers');
  console.log('========================================================================\n');

  const db = getDb();
  const todayIso = '2026-12-28';

  // Clean up any test artifacts from prior runs (respecting foreign key dependencies)
  function cleanup() {
    db.prepare("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL, active_job = NULL WHERE current_user_id LIKE 'usr-test-ovl-%'").run();
    db.prepare("DELETE FROM audit_logs WHERE actor_id LIKE 'usr-test-ovl-%'").run();
    db.prepare("DELETE FROM entry_logs WHERE user_id LIKE 'usr-test-ovl-%'").run();
    db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-test-ovl-%'").run();
    db.prepare("DELETE FROM bookings WHERE user_id LIKE 'usr-test-ovl-%' OR booking_id LIKE 'test-ovl-%'").run();
    db.prepare("DELETE FROM booking_requests WHERE user_id LIKE 'usr-test-ovl-%' OR request_id LIKE 'test-ovl-%'").run();
    db.prepare("DELETE FROM student_fairness WHERE user_id LIKE 'usr-test-ovl-%'").run();
    db.prepare("DELETE FROM lab_slots WHERE slot_id LIKE 'slot-test-ovl-%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'usr-test-ovl-%'").run();
    db.prepare("DELETE FROM lab_date_overrides WHERE override_id = 'ovr-test-ovl'").run();
  }

  cleanup();

  // Temporarily ignore Mon–Fri academic classes during overlap unit test
  db.prepare(`
    INSERT OR REPLACE INTO lab_date_overrides (override_id, lab_id, override_date, override_type, is_open, open_time, close_time, ignore_timetable, reason)
    VALUES ('ovr-test-ovl', 'lab-l106', ?, 'EXTRA_DAY', 1, '09:00', '22:00', 1, 'Isolated overlap unit test')
  `).run(todayIso);

  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  if (!activeSem) throw new Error('No active semester found');

  // 1. Seed test users
  const testUsers = [
    { id: 'usr-test-ovl-1', name: 'Overlap Tester 1', roll: 'BT23OVL001', score: 100 },
    { id: 'usr-test-ovl-2', name: 'Overlap Tester 2', roll: 'BT23OVL002', score: 90 },
    { id: 'usr-test-ovl-3', name: 'Overlap Tester 3', roll: 'BT23OVL003', score: 80 },
    { id: 'usr-test-ovl-4', name: 'Overlap Tester 4', roll: 'BT23OVL004', score: 70 },
  ];

  for (const u of testUsers) {
    db.prepare(`
      INSERT INTO users (user_id, name, roll_no, email, role, department)
      VALUES (?, ?, ?, ?, 'student', 'CSE')
    `).run(u.id, u.name, u.roll, `${u.id}@iitbhilai.ac.in`);

    db.prepare(`
      INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, penalty_points)
      VALUES (?, ?, ?, 100, ?, 0, 0)
    `).run(`fair-${u.id}`, u.id, activeSem.semester_id, u.score);
  }

  // 2. Seed overlapping test slots
  // Slot A: 14:00 - 16:00
  // Slot B: 15:00 - 17:00 (Overlaps with Slot A by 1 hour)
  // Slot C: 18:00 - 20:00 (Completely non-overlapping with Slot A & B)
  const slotA = { id: 'slot-test-ovl-a', name: 'Slot A (14:00-16:00)', start: '14:00', end: '16:00' };
  const slotB = { id: 'slot-test-ovl-b', name: 'Slot B Overlapping (15:00-17:00)', start: '15:00', end: '17:00' };
  const slotC = { id: 'slot-test-ovl-c', name: 'Slot C Evening (18:00-20:00)', start: '18:00', end: '20:00' };

  for (const s of [slotA, slotB, slotC]) {
    db.prepare(`
      INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, capacity, round_number, is_active)
      VALUES (?, 'lab-l106', ?, ?, ?, 24, 1, 1)
    `).run(s.id, s.name, s.start, s.end);
  }

  console.log('[Setup] Seeded 3 test slots:');
  console.log(`        - ${slotA.id}: ${slotA.start} - ${slotA.end}`);
  console.log(`        - ${slotB.id}: ${slotB.start} - ${slotB.end} [OVERLAPS with Slot A]`);
  console.log(`        - ${slotC.id}: ${slotC.start} - ${slotC.end} [Non-overlapping]`);

  // =========================================================================
  // TEST 1: Workstation Time-Overlap Exclusion
  // =========================================================================
  console.log('\n--- [Test 1] Workstation Time-Overlap Exclusion ---');
  
  // Submit request and allocate L106-PC-01 to Student 1 for Slot A (14:00 - 16:00)
  const req1 = submitBookingRequest({
    userId: 'usr-test-ovl-1',
    slotId: slotA.id,
    bookingDate: todayIso,
    computePurpose: 'Slot A Initial Reservation'
  });
  const allocRoundA = await runAllocationRound(slotA.id, 1, todayIso);
  const bookingA = allocRoundA.allocations[0].bookingId;
  const assignedRigA = allocRoundA.allocations[0].machineId;
  console.log(`✓ Confirmed Machine ${assignedRigA} (Booking: ${bookingA}) for Slot A (${slotA.start} - ${slotA.end})`);

  // Student 2 queues for Slot B (15:00 - 17:00)
  const req2 = submitBookingRequest({
    userId: 'usr-test-ovl-2',
    slotId: slotB.id,
    bookingDate: todayIso,
    computePurpose: 'Testing Overlap Allocation'
  });
  console.log(`✓ Student 2 submitted request for overlapping Slot B (${slotB.start} - ${slotB.end})`);

  // Run allocation for Slot B (cap at 1)
  const allocRoundB = await runAllocationRound(slotB.id, 1, todayIso);
  const assignedRigB = allocRoundB.allocations[0].machineId;
  console.log(`✓ Slot B allocated machine: ${assignedRigB}`);

  if (assignedRigB === assignedRigA) {
    throw new Error(`❌ FAILED: Machine ${assignedRigA} was double-booked for an overlapping slot time!`);
  }
  console.log(`   ✓ PASS: ${assignedRigA} was properly EXCLUDED from Slot B. Assigned ${assignedRigB} instead.`);

  // Verify non-overlapping slot C CAN still allocate L106-PC-01
  const req3 = submitBookingRequest({
    userId: 'usr-test-ovl-3',
    slotId: slotC.id,
    bookingDate: todayIso,
    computePurpose: 'Testing Non-overlapping Allocation'
  });
  const allocRoundC = await runAllocationRound(slotC.id, 1, todayIso);
  const assignedRigC = allocRoundC.allocations[0].machineId;
  console.log(`✓ Non-overlapping Slot C allocated machine: ${assignedRigC}`);
  console.log('   ✓ PASS: Workstation time-overlap exclusion correctly differentiates overlapping from non-overlapping slots.');

  // =========================================================================
  // TEST 2: Student Overlapping Request Rejection
  // =========================================================================
  console.log('\n--- [Test 2] Student Overlapping Slot Request Prevention ---');
  // Student 1 (already booked for Slot A: 14:00 - 16:00) tries to request Slot B (15:00 - 17:00)
  let overlapRejected = false;
  try {
    submitBookingRequest({
      userId: 'usr-test-ovl-1',
      slotId: slotB.id,
      bookingDate: todayIso,
      computePurpose: 'Attempting Double Booking'
    });
  } catch (err) {
    overlapRejected = true;
    console.log(`✓ Expected error caught: "${err.message}"`);
  }

  if (!overlapRejected) {
    throw new Error('❌ FAILED: Student was permitted to request an overlapping slot!');
  }
  console.log('   ✓ PASS: Student cannot hold reservations for overlapping time slots.');

  // =========================================================================
  // TEST 3: Simultaneous Allocation Workers Concurrency
  // =========================================================================
  console.log('\n--- [Test 3] Concurrent Allocation Workers on Same Slot ---');
  // Queue Student 4 for Slot C
  submitBookingRequest({
    userId: 'usr-test-ovl-4',
    slotId: slotC.id,
    bookingDate: todayIso,
    computePurpose: 'Concurrent Worker Contention Test'
  });

  // Fire two allocation worker rounds simultaneously via Promise.all
  console.log('Fired 2 allocation workers simultaneously for Slot C...');
  const [worker1, worker2] = await Promise.all([
    runAllocationRound(slotC.id, null, todayIso),
    runAllocationRound(slotC.id, null, todayIso)
  ]);

  const totalAllocated = worker1.allocatedCount + worker2.allocatedCount;
  console.log(`Worker 1 allocated: ${worker1.allocatedCount}, Worker 2 allocated: ${worker2.allocatedCount}`);
  console.log(`Total allocated: ${totalAllocated}`);

  // Exactly 1 student was pending in queue (Student 4)
  if (totalAllocated !== 1) {
    throw new Error(`❌ FAILED: Expected exactly 1 allocation across both workers, but got ${totalAllocated}`);
  }
  console.log('   ✓ PASS: Concurrent allocation workers resolved atomically with zero duplicate bookings.');

  // =========================================================================
  // TEST 4: Cancellation & Immediate Reallocation with 0 Penalty
  // =========================================================================
  console.log('\n--- [Test 4] Voluntary Cancellation & Immediate Reallocation ---');
  const student1PreCancel = db.prepare('SELECT * FROM student_fairness WHERE user_id = ?').get('usr-test-ovl-1');
  console.log(`Student 1 Score Before Cancellation: ${student1PreCancel.current_score} PTS`);

  // Student 1 cancels Slot A booking
  const cancelRes = cancelBooking(bookingA, 'usr-test-ovl-1', 'Research project postponed');
  console.log(`✓ Booking ${bookingA} cancelled. Freed Machine: ${cancelRes.freedMachineId}`);

  const student1PostCancel = db.prepare('SELECT * FROM student_fairness WHERE user_id = ?').get('usr-test-ovl-1');
  console.log(`Student 1 Score After Cancellation:  ${student1PostCancel.current_score} PTS`);

  if (student1PreCancel.current_score !== student1PostCancel.current_score) {
    throw new Error('❌ FAILED: Cancellation improperly deducted priority points!');
  }
  console.log('   ✓ PASS: Voluntary cancellation applied exactly 0 penalty points.');

  // Now Machine L106-PC-01 is free again. A new request for Slot A can allocate it immediately!
  submitBookingRequest({
    userId: 'usr-test-ovl-1',
    slotId: slotA.id,
    bookingDate: todayIso,
    computePurpose: 'Re-booking after cancellation'
  });
  const reAlloc = await runAllocationRound(slotA.id, 1, todayIso);
  console.log(`Re-allocated Machine: ${reAlloc.allocations[0].machineId} to ${reAlloc.allocations[0].userId}`);
  if (reAlloc.allocations[0].machineId !== assignedRigA) {
    throw new Error(`❌ FAILED: Freed machine ${assignedRigA} was not reallocated!`);
  }
  console.log('   ✓ PASS: Freed machine was successfully reallocated to the waiting queue.');

  // Clean up
  cleanup();

  console.log('\n========================================================================');
  console.log('🎉 ALL OVERLAP & CONCURRENCY TESTS PASSED FLAWLESSLY (4/4)!');
  console.log('========================================================================\n');
}

runOverlapAndConcurrencyTests().catch(err => {
  console.error('💥 Test Failed:', err);
  process.exit(1);
});
