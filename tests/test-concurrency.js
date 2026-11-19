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

async function runConcurrencyTest() {
  console.log('===============================================================');
  console.log('🧪 HIGH-PRIORITY TEST 1: Simultaneous Booking Concurrency Test');
  console.log('   Condition: 100 students request the same slot concurrently.');
  console.log('   Resource: Only 5 GPU workstations available.');
  console.log('===============================================================');

  const { getDb } = require('../backend/db/database');
  const db = getDb();

  // Clean up prior concurrency test data across users, slots, and requests
  db.prepare("DELETE FROM booking_preferences WHERE request_id IN (SELECT request_id FROM booking_requests WHERE user_id LIKE 'usr-test-conc-%')").run();
  db.prepare("DELETE FROM waitlist_entries WHERE user_id LIKE 'usr-test-conc-%'").run();
  db.prepare("DELETE FROM allocation_history WHERE user_id LIKE 'usr-test-conc-%'").run();
  db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-test-conc-%'").run();
  db.prepare("DELETE FROM bookings WHERE user_id LIKE 'usr-test-conc-%'").run();
  db.prepare("DELETE FROM booking_requests WHERE user_id LIKE 'usr-test-conc-%'").run();
  db.prepare("DELETE FROM lab_slots WHERE slot_id LIKE 'slot-conc-%'").run();

  // 1. Setup isolated slot for concurrency test with capacity = 5
  const testSlotId = `slot-conc-${Date.now()}`;
  db.prepare(`
    INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, capacity, round_number, is_active)
    VALUES (?, 'lab-l106', 'Concurrent Benchmark Slot', '22:00', '23:30', 5, 99, 1)
  `).run(testSlotId);

  // Guarantee at least 5 workstations are available for this test
  db.prepare(`
    UPDATE workstations 
    SET status = 'AVAILABLE', current_user_id = NULL, active_job = NULL
    WHERE machine_id IN ('L106-PC-18', 'L106-PC-19', 'L106-PC-20', 'L106-PC-21', 'L106-PC-22')
  `).run();

  const availableRigs = db.prepare("SELECT machine_id FROM workstations WHERE lab_id = 'lab-l106' AND status = 'AVAILABLE'").all();
  console.log(`[Setup] Lab L-106 available rigs: ${availableRigs.length} machines`);

  try {
    // 2. Generate 100 students with varied scores (10 to 100)
  console.log('[Setup] Creating 100 distinct student personas with varied fairness points...');
  const activeSem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();
  
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (user_id, name, roll_no, email, role, department)
    VALUES (?, ?, ?, ?, 'student', 'CSE Concurrent Cohort')
  `);
  const insertFair = db.prepare(`
    INSERT OR REPLACE INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, penalty_points)
    VALUES (?, ?, ?, 100, ?, ?, 0)
  `);

  const studentIds = [];
  const expectedScores = [];
  const { signAuthToken } = require('../backend/middleware/auth');

  const setupTx = db.transaction(() => {
    for (let i = 1; i <= 100; i++) {
      const uid = `usr-test-conc-${i}`;
      const roll = `BT23CONC${String(i).padStart(3, '0')}`;
      const name = `Student ${String(i).padStart(3, '0')}`;
      const email = `conc.${i}@iitbhilai.ac.in`;
      // Distribute scores: top 5 students will have scores 100, 98, 96, 94, 92; others lower
      const score = Math.max(10, 100 - (i - 1));
      
      insertUser.run(uid, name, roll, email);
      insertFair.run(`fair-${uid}-${activeSem.semester_id}`, uid, activeSem.semester_id, score, Math.floor((100 - score) / 10));

      studentIds.push(uid);
      expectedScores.push({ uid, roll, score });
    }
  });
  setupTx();

  console.log('[Phase 1] Firing 100 simultaneous booking requests via Promise.all...');
  const startTime = Date.now();

  const testDate = '2026-12-28';
  db.prepare(`
    INSERT OR REPLACE INTO ticket_releases (release_id, lab_id, release_date, start_time, end_time, total_tickets, status, title)
    VALUES (?, 'lab-l106', ?, '00:00', '23:59', 100, 'RELEASED', 'Test Concurrency Drop')
  `).run(`rel-conc-${testDate}`, testDate);
  const requestPromises = studentIds.map((uid, idx) => {
    const studentToken = signAuthToken({
      user_id: uid,
      email: `conc.${idx + 1}@iitbhilai.ac.in`,
      role: 'student',
      permissions: []
    });
    return request('POST', '/api/bookings/request', {
      slotId: testSlotId,
      bookingDate: testDate,
      computePurpose: `Distributed Parallel Benchmarking - Process ${idx + 1}`,
      researchField: 'AI / Machine Learning'
    }, { 'Authorization': `Bearer ${studentToken}` });
  });

  const responses = await Promise.all(requestPromises);
  const elapsed = Date.now() - startTime;
  console.log(`[Phase 1] Completed 100 requests in ${elapsed}ms. All responded.`);

  const successfulQueued = responses.filter(r => r.status === 201);
  console.log(`[Assertion 1] Successfully queued requests: ${successfulQueued.length} / 100`);
  if (successfulQueued.length !== 100) {
    throw new Error(`Expected all 100 requests to be accepted into queue, got ${successfulQueued.length}`);
  }

  // Phase 2: Run Batch Allocation with limit 5 (Admin auth required in production)
  console.log('[Phase 2] Triggering Fairness Allocation Round (Capped at 5 available nodes)...');
  const adminToken = signAuthToken({
    user_id: 'usr-admin-sharma',
    email: 'aksharma@iitbhilai.ac.in',
    role: 'admin',
    permissions: ['ADMIN_ALL']
  });
  const allocRes = await request('POST', `/api/bookings/queue/${testSlotId}/allocate`, { bookingDate: testDate }, { 'Authorization': `Bearer ${adminToken}` });
  
  console.log(`[Phase 2] Allocation result: Allocated = ${allocRes.data.allocatedCount}, Waitlisted = ${allocRes.data.waitlistedCount}`);

  // Assertions:
  // A. Exactly 5 confirmed allocations
  console.log(`[Assertion 2] Checking allocation count is exactly 5...`);
  if (allocRes.data.allocatedCount !== 5) {
    throw new Error(`Expected exactly 5 allocations, got ${allocRes.data.allocatedCount}`);
  }
  console.log('   ✓ PASS: Exactly 5 allocations confirmed.');

  // B. Remaining 95 requests waitlisted
  console.log(`[Assertion 3] Checking waitlisted count is exactly 95...`);
  if (allocRes.data.waitlistedCount !== 95) {
    throw new Error(`Expected exactly 95 waitlisted, got ${allocRes.data.waitlistedCount}`);
  }
  console.log('   ✓ PASS: Exactly 95 requests cleanly waitlisted in queue.');

  // C. No duplicate workstation reservations
  const assignedMachines = allocRes.data.allocations.map(a => a.machineId);
  const uniqueMachines = new Set(assignedMachines);
  console.log(`[Assertion 4] Checking workstation uniqueness: [${assignedMachines.join(', ')}]`);
  if (uniqueMachines.size !== 5) {
    throw new Error(`Duplicate machine assignments detected! Unique machines: ${uniqueMachines.size} out of 5`);
  }
  console.log('   ✓ PASS: Zero duplicate workstation assignments. 1-to-1 workstation mapping preserved.');

  // D. Check top 5 priority scores won
  console.log('[Assertion 5] Verifying that the highest priority candidates received the allocations:');
  allocRes.data.allocations.forEach((alloc, idx) => {
    console.log(`   Rank #${idx + 1}: ${alloc.studentName} (${alloc.rollNo}) -> Score: ${alloc.priorityScore} pts -> Assigned: ${alloc.machineId}`);
  });

  const allocatedUserIds = new Set(allocRes.data.allocations.map(a => a.userId));
  // The top 5 should be usr-test-conc-1 through 5
  for (let i = 1; i <= 5; i++) {
    const expectedTopUid = `usr-test-conc-${i}`;
    if (!allocatedUserIds.has(expectedTopUid)) {
      throw new Error(`Expected top student ${expectedTopUid} to be allocated!`);
    }
  }
  console.log('   ✓ PASS: The 5 highest scoring students (100, 99, 98, 97, 96 pts) won all allocations.');

  console.log('\n✨ TEST 1 (SIMULTANEOUS CONCURRENCY) PASSED WITH ZERO RACE CONDITIONS!\n');
  } finally {
    try {
      db.prepare("DELETE FROM ticket_releases WHERE release_id = ?").run(`rel-conc-${testDate}`);
      db.prepare("DELETE FROM booking_preferences WHERE request_id IN (SELECT request_id FROM booking_requests WHERE slot_id = ?)").run(testSlotId);
      db.prepare("DELETE FROM waitlist_entries WHERE slot_id = ?").run(testSlotId);
      db.prepare("DELETE FROM allocation_history WHERE slot_id = ?").run(testSlotId);
      db.prepare("DELETE FROM access_passes WHERE booking_id IN (SELECT booking_id FROM bookings WHERE slot_id = ?)").run(testSlotId);
      db.prepare("DELETE FROM bookings WHERE slot_id = ?").run(testSlotId);
      db.prepare("DELETE FROM booking_requests WHERE slot_id = ?").run(testSlotId);
      db.prepare("DELETE FROM lab_slots WHERE slot_id = ?").run(testSlotId);
      db.prepare(`
        UPDATE workstations 
        SET status = 'AVAILABLE', current_user_id = NULL, active_job = NULL
        WHERE machine_id IN ('L106-PC-18', 'L106-PC-19', 'L106-PC-20', 'L106-PC-21', 'L106-PC-22')
      `).run();
    } catch (e) {
      // ignore teardown error
    }
  }
}

runConcurrencyTest().catch(err => {
  console.error('❌ Test 1 failed:', err);
  process.exit(1);
});
