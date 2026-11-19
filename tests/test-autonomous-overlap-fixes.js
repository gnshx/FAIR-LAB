/**
 * FairLab Verification: Autonomous Allocation Engine & Overlap Conflict Resilience
 * Tests:
 * 1. Overlapping candidate does not crash batch allocation (USER_OVERLAP_CONFLICT prevented)
 * 2. Remaining valid queued candidates are successfully allocated
 * 3. autoProcessQueues automatically resolves pending queues across all slots
 */
const assert = require('assert');
const { getDb } = require('../backend/db/database');
const {
  submitBookingRequest,
  runWindowAllocationRound,
  autoProcessQueues
} = require('../backend/services/bookingService');

async function testAutonomousAndOverlap() {
  console.log('🧪 Starting Autonomous Allocation & Overlap Resilience Verification...');
  const db = getDb();
  const testDate = `2026-11-${Math.floor(21 + Math.random() * 6)}`;

  // Clean any test data in FK-safe order
  db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-test-overlap-%'").run();
  db.prepare("DELETE FROM bookings WHERE user_id LIKE 'usr-test-overlap-%'").run();
  db.prepare("DELETE FROM booking_preferences WHERE request_id IN (SELECT request_id FROM booking_requests WHERE user_id LIKE 'usr-test-overlap-%')").run();
  db.prepare("DELETE FROM waitlist_entries WHERE user_id LIKE 'usr-test-overlap-%'").run();
  db.prepare("DELETE FROM booking_requests WHERE user_id LIKE 'usr-test-overlap-%'").run();
  db.prepare("DELETE FROM student_fairness WHERE user_id LIKE 'usr-test-overlap-%'").run();
  db.prepare("DELETE FROM users WHERE user_id LIKE 'usr-test-overlap-%'").run();

  // Ensure active semester
  const activeSem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();
  assert.ok(activeSem, 'Active semester must exist');

  // Create test students
  const students = [
    { id: 'usr-test-overlap-1', name: 'Overlap Candidate 1', roll: 'BT23TEST01', score: 100 },
    { id: 'usr-test-overlap-2', name: 'Valid Candidate 2', roll: 'BT23TEST02', score: 80 },
    { id: 'usr-test-overlap-3', name: 'Valid Candidate 3', roll: 'BT23TEST03', score: 70 }
  ];

  for (const s of students) {
    db.prepare(`
      INSERT OR REPLACE INTO users (user_id, name, roll_no, email, role, department)
      VALUES (?, ?, ?, ?, 'student', 'Computer Science')
    `).run(s.id, s.name, s.roll, `${s.id}@iitbhilai.ac.in`);

    db.prepare(`
      INSERT OR REPLACE INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, total_hours_used, high_demand_count, high_demand_hours, cumulative_wait_seconds, penalty_points)
      VALUES (?, ?, ?, 100, ?, 0, 0, 0, 0, 0, 0)
    `).run(`fair-${s.id}`, s.id, activeSem.semester_id, s.score);
  }

  // First, submit QUEUED requests for all 3 candidates for slot-4 (12:00-13:00)
  const req1 = submitBookingRequest({
    userId: students[0].id,
    slotId: 'slot-4',
    bookingDate: testDate,
    startTime: '12:00',
    endTime: '13:00',
    preferredWorkstations: ['A-R1-PC01'],
    computePurpose: 'Candidate 1 overlapping queue request',
    allocationMode: 'SCHEDULED'
  });

  const req2 = submitBookingRequest({
    userId: students[1].id,
    slotId: 'slot-4',
    bookingDate: testDate,
    startTime: '12:00',
    endTime: '13:00',
    preferredWorkstations: ['A-R1-PC02'],
    computePurpose: 'Candidate 2 valid request',
    allocationMode: 'SCHEDULED'
  });

  const req3 = submitBookingRequest({
    userId: students[2].id,
    slotId: 'slot-4',
    bookingDate: testDate,
    startTime: '12:00',
    endTime: '13:00',
    preferredWorkstations: ['A-R1-PC03'],
    computePurpose: 'Candidate 3 valid request',
    allocationMode: 'SCHEDULED'
  });

  // Now, simulate Candidate 1 acquiring another confirmed booking for the same window prior to round execution
  const priorBookingId = `L106-PRIOR-${Date.now()}`;
  db.prepare(`
    INSERT INTO bookings (
      booking_id, user_id, machine_id, slot_id, booking_date,
      start_time, end_time, duration_minutes, demand_level, demand_ratio,
      semester_id, status
    )
    VALUES (?, ?, 'L106-PC-10', 'slot-4', ?, '12:00', '13:00', 60, 'NORMAL', 0, ?, 'CONFIRMED')
  `).run(priorBookingId, students[0].id, testDate, activeSem.semester_id);

  // Verify all 3 entered QUEUED
  assert.strictEqual(req1.status, 'QUEUED');
  assert.strictEqual(req2.status, 'QUEUED');
  assert.strictEqual(req3.status, 'QUEUED');
  console.log('✓ [Setup] 3 requests queued: Candidate 1 holds prior confirmed booking, Candidates 2 & 3 are free');

  // Trigger allocation round for slot-4
  const roundResult = await runWindowAllocationRound({
    slotId: 'slot-4',
    bookingDate: testDate,
    startTime: '12:00',
    endTime: '13:00'
  });

  // Verify Candidate 1's request was cancelled due to overlap without throwing USER_OVERLAP_CONFLICT
  const req1Final = db.prepare('SELECT status FROM booking_requests WHERE request_id = ?').get(req1.requestId);
  assert.strictEqual(req1Final.status, 'CANCELLED', 'Overlapping candidate request must be cleanly marked CANCELLED');

  // Verify Candidate 2 and Candidate 3 were successfully allocated!
  const req2Final = db.prepare('SELECT status FROM booking_requests WHERE request_id = ?').get(req2.requestId);
  const req3Final = db.prepare('SELECT status FROM booking_requests WHERE request_id = ?').get(req3.requestId);
  assert.strictEqual(req2Final.status, 'ALLOCATED', 'Candidate 2 must be allocated');
  assert.strictEqual(req3Final.status, 'ALLOCATED', 'Candidate 3 must be allocated');
  assert.strictEqual(roundResult.allocatedCount, 2, 'Exactly 2 valid candidates must be allocated');
  console.log('✓ [Test 1] Overlap conflict safely handled: Candidate 1 cancelled, Candidates 2 & 3 allocated cleanly');

  // Test 2: Autonomous Queue Engine
  // Create another queued request on slot-5 (13:00-14:00)
  const reqAuto = submitBookingRequest({
    userId: students[1].id,
    slotId: 'slot-5',
    bookingDate: testDate,
    startTime: '13:00',
    endTime: '14:00',
    preferredWorkstations: ['A-R2-PC01'],
    computePurpose: 'Auto-allocation test',
    allocationMode: 'SCHEDULED'
  });
  assert.strictEqual(reqAuto.status, 'QUEUED');

  // Call autoProcessQueues()
  const autoResult = await autoProcessQueues();
  assert.ok(autoResult.totalAllocated >= 1, 'Autonomous engine must process and allocate queued requests');

  const reqAutoFinal = db.prepare('SELECT status FROM booking_requests WHERE request_id = ?').get(reqAuto.requestId);
  assert.strictEqual(reqAutoFinal.status, 'ALLOCATED', 'Autonomous engine must allocate queued request');
  console.log('✓ [Test 2] Autonomous Allocation Engine successfully processed pending queues with zero admin presence');

  console.log('✨ All Autonomous Allocation & Overlap Resilience Tests Passed Perfectly!');
}

testAutonomousAndOverlap().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
