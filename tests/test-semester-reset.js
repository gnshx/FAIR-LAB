const http = require('http');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resData) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resData });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runSemesterResetTest() {
  console.log('===============================================================');
  console.log('🧪 HIGH-PRIORITY TEST 2: Semester Reset & Score Independence');
  console.log('   Condition: A student has completed 6 bookings in Semester 1 (Score: 40 pts).');
  console.log('   Trigger: Administrator executes Semester Reset for Term 2.');
  console.log('   Expected:');
  console.log('   - Semester 1 history, bookings & logs remain 100% intact.');
  console.log('   - Student starts Semester 2 at 100 points (booking_count = 0).');
  console.log('   - Old bookings do not diminish Semester 2 priority.');
  console.log('===============================================================');

  const { getDb } = require('../backend/db/database');
  const db = getDb();

  // Setup: Pick or create student with score = 40 in the current active semester
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  const testStudentId = `usr-test-sem-reset-student-${Date.now()}`;
  const testStudentRoll = `BT23CSE${Math.floor(Math.random() * 899 + 100)}`;

  db.prepare(`
    INSERT OR REPLACE INTO users (user_id, name, roll_no, email, role, department)
    VALUES (?, 'Rohan Gupta', ?, ?, 'student', 'B.Tech CSE')
  `).run(testStudentId, testStudentRoll, `${testStudentId}@iitbhilai.ac.in`);

  // Set score to 40 in Semester 1 (6 completed bookings)
  db.prepare(`
    INSERT OR REPLACE INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, penalty_points)
    VALUES (?, ?, ?, 100, 40, 6, 0)
  `).run(`fair-${testStudentId}-${activeSem.semester_id}`, testStudentId, activeSem.semester_id);

  // Add 6 historical bookings to ensure booking history exists
  for (let i = 1; i <= 6; i++) {
    const bId = `L106-SEM1-BOOKING-${i}-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    db.prepare(`
      INSERT OR IGNORE INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, status)
      VALUES (?, ?, 'L106-PC-01', 'slot-1', ?, 'COMPLETED')
    `).run(bId, testStudentId, activeSem.semester_id);
  }

  // Verify Semester 1 State
  const sem1HistoryCount = db.prepare(`
    SELECT COUNT(*) as count FROM bookings WHERE user_id = ? AND semester_id = ?
  `).get(testStudentId, activeSem.semester_id).count;

  console.log(`[Phase 1] Pre-Reset State for Rohan Gupta (${testStudentRoll}):`);
  console.log(`   Semester 1 ID: ${activeSem.semester_id} ("${activeSem.name}")`);
  console.log(`   Semester 1 Score: 40 PTS`);
  console.log(`   Semester 1 Completed Bookings: ${sem1HistoryCount}`);
  if (sem1HistoryCount < 6) throw new Error('Failed to set up pre-reset history');

  // Phase 2: Execute Semester Reset via Admin API
  console.log('\n[Phase 2] Admin triggers Semester Reset via POST /api/admin/semester/reset...');
  const newSemName = `Autumn 2026 Semester · Active Cycle`;
  const resetRes = await request('POST', '/api/admin/semester/reset', {
    semesterName: newSemName
  }, { 'x-user-id': 'usr-admin-sharma' });

  if (resetRes.status !== 200 || !resetRes.data.success) {
    throw new Error('Semester reset endpoint failed: ' + JSON.stringify(resetRes.data));
  }
  console.log(`   Semester Reset response: ${resetRes.data.semesterName} (New ID: ${resetRes.data.semesterId})`);

  // Phase 3: Assertions
  // A. Check Semester 1 records are still intact in DB (status = 'archived')
  console.log('\n[Assertion 1] Verifying Semester 1 historical preservation...');
  const oldSem = db.prepare('SELECT * FROM semesters WHERE semester_id = ?').get(activeSem.semester_id);
  if (oldSem.status !== 'archived') {
    throw new Error(`Expected old semester to be archived, but found status: ${oldSem.status}`);
  }

  const oldBookings = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE user_id = ? AND semester_id = ?').get(testStudentId, activeSem.semester_id).count;
  if (oldBookings !== sem1HistoryCount) {
    throw new Error(`Historical bookings were altered or deleted! Found ${oldBookings}, expected ${sem1HistoryCount}`);
  }

  const oldFairness = db.prepare('SELECT * FROM student_fairness WHERE user_id = ? AND semester_id = ?').get(testStudentId, activeSem.semester_id);
  if (oldFairness.current_score !== 40 || oldFairness.booking_count !== 6) {
    throw new Error(`Semester 1 historical fairness record modified! Found score ${oldFairness.current_score}`);
  }
  console.log('   ✓ PASS: Semester 1 history, bookings, and 40-point record permanently preserved in archive.');

  // B. Check Semester 2 state for the student
  console.log('[Assertion 2] Verifying Student profile in new Semester 2...');
  const studentProfile = await request('GET', '/api/auth/me', null, { 'x-user-id': testStudentId });
  const sem2Fairness = studentProfile.data.fairness;

  console.log(`   Active Semester in Profile: "${studentProfile.data.activeSemester.name}"`);
  console.log(`   Semester 2 Starting Score: ${sem2Fairness.current_score} PTS`);
  console.log(`   Semester 2 Booking Count: ${sem2Fairness.booking_count}`);

  if (sem2Fairness.current_score !== 100) {
    throw new Error(`Expected Semester 2 score to reset to 100, but got ${sem2Fairness.current_score}`);
  }
  if (sem2Fairness.booking_count !== 0) {
    throw new Error(`Expected Semester 2 booking count to reset to 0, but got ${sem2Fairness.booking_count}`);
  }
  console.log('   ✓ PASS: Student starts Semester 2 at clean 100 priority points with 0 bookings.');

  // C. Verify Old Bookings do NOT influence new priority queue ranking
  console.log('[Assertion 3] Testing that old Semester 1 bookings do not decrease Semester 2 priority...');
  const freshSlotId = `slot-term2-${Date.now()}`;
  db.prepare(`
    INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, capacity, round_number, is_active)
    VALUES (?, 'lab-l106', 'Term 2 Demonstration Slot', '20:00', '21:30', 24, 98, 1)
  `).run(freshSlotId);

  const reqRes = await request('POST', '/api/bookings/request', {
    slotId: freshSlotId,
    bookingDate: '2026-12-28',
    computePurpose: 'New Term Research Workload',
    researchField: 'AI / Machine Learning'
  }, { 'x-user-id': testStudentId });

  if (reqRes.status !== 201 || reqRes.data.priorityScore !== 100) {
    throw new Error(`Expected queued request to succeed with 100 priority points, but got status ${reqRes.status}: ${JSON.stringify(reqRes.data)}`);
  }
  console.log(`   ✓ PASS: Student queued with maximum priority score (${reqRes.data.priorityScore} PTS) despite prior semester history.`);

  // Clean up synthetic test slot so live schedule stays clean
  db.prepare("DELETE FROM booking_requests WHERE slot_id = ?").run(freshSlotId);
  db.prepare("DELETE FROM bookings WHERE slot_id = ?").run(freshSlotId);
  db.prepare("DELETE FROM lab_slots WHERE slot_id = ?").run(freshSlotId);

  // D. Check audit trail logged the reset event
  const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'SEMESTER_RESET' ORDER BY created_at DESC LIMIT 1").get();
  if (!auditLog) throw new Error('Missing audit log for semester reset');
  console.log(`   ✓ PASS: Immutable audit log recorded: "${auditLog.details}" by ${auditLog.actor_name}`);

  console.log('\n✨ TEST 2 (SEMESTER RESET & INDEPENDENCE) PASSED WITH FULL AUDIT INTEGRITY!\n');
}

runSemesterResetTest().catch(err => {
  console.error('❌ Test 2 failed:', err);
  process.exit(1);
});
