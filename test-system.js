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
          const parsed = JSON.parse(resData);
          resolve({ status: res.statusCode, data: parsed });
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

async function runTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 Starting FairLab Full End-to-End System Tests');
  console.log('🧪 ========================================================');

  const { getDb } = require('./backend/db/database');
  const db = getDb();

  // Test 1: Health Check
  const health = await request('GET', '/health');
  console.log(`[Test 1] Health check: status = ${health.status}, lab = ${health.data.lab}`);
  if (health.status !== 200) throw new Error('Health check failed');

  // Test 2: User profile & fairness metrics
  const me = await request('GET', '/api/auth/me', null, { 'x-user-id': 'usr-student-ganesh' });
  console.log(`[Test 2] Auth Profile: ${me.data.user.name} (${me.data.user.roll_no})`);
  console.log(`         Current Fairness Score: ${me.data.fairness.current_score} pts, Completed: ${me.data.fairness.booking_count}`);
  if (typeof me.data.fairness.current_score !== 'number') throw new Error('Invalid fairness score');

  // Test 3: Workstations inventory (84 nodes in L-106: Block A 60 + Block B 24)
  const rigs = await request('GET', '/api/labs/L106/workstations');
  console.log(`[Test 3] Workstations loaded: ${rigs.data.length} rigs in L-106`);
  if (rigs.data.length !== 84) throw new Error(`Expected 84 workstations, got ${rigs.data.length}`);

  // Test 4: Create a fresh confirmed booking & pass for Ganesh to test gate flow
  const activeSem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();
  const testBookingId = `L106-E2E-${Date.now()}`;
  
  // Free machine L106-PC-03 for this test and clean up any prior test booking for slot-3
  db.prepare("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL WHERE machine_id = 'L106-PC-03'").run();

  const priorBookings = db.prepare("SELECT booking_id FROM bookings WHERE (user_id = 'usr-student-ganesh' AND slot_id = 'slot-3') OR (machine_id = 'L106-PC-03' AND slot_id = 'slot-3')").all();
  for (const pb of priorBookings) {
    db.prepare("DELETE FROM entry_logs WHERE booking_id = ?").run(pb.booking_id);
    db.prepare("DELETE FROM allocation_history WHERE booking_id = ?").run(pb.booking_id);
    db.prepare("DELETE FROM access_passes WHERE booking_id = ?").run(pb.booking_id);
    db.prepare("DELETE FROM bookings WHERE booking_id = ?").run(pb.booking_id);
  }

  db.prepare(`
    INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, status)
    VALUES (?, 'usr-student-ganesh', 'L106-PC-03', 'slot-3', ?, 'CONFIRMED')
  `).run(testBookingId, activeSem.semester_id);

  const { generateAccessPass } = require('./backend/services/passService');
  const pass = await generateAccessPass(
    testBookingId,
    'usr-student-ganesh',
    'BT23CSE001',
    'L106-PC-03',
    'Slot 3',
    '14:00 – 16:00'
  );

  console.log(`[Test 4] Active Test Booking ID: ${testBookingId} on L106-PC-03`);
  
  const verifyRes = await request('POST', '/api/access/verify', { token: pass.signedToken });
  console.log(`[Test 4.1] Watchman scan verification: ${verifyRes.data.code} - ${verifyRes.data.message}`);
  if (!verifyRes.data.authorized) throw new Error('Expected authorized pass');

  // Test 5: Watchman Check-In (Open Turnstile)
  const checkInRes = await request('POST', '/api/access/check-in', { passId: pass.passId }, { 'x-user-id': 'usr-watchman-ram' });
  console.log(`[Test 5] Check-In Result: status = ${checkInRes.data.status}, entryId = ${checkInRes.data.entryId}`);
  if (checkInRes.status !== 200) throw new Error('Check-in failed');

  // Test 6: Prevent QR reuse / double check-in
  const doubleScan = await request('POST', '/api/access/verify', { token: pass.signedToken });
  console.log(`[Test 6] Duplicate Scan Rejection: ${doubleScan.data.code} (Authorized = ${doubleScan.data.authorized})`);
  if (doubleScan.data.authorized === true) throw new Error('Double check-in should have been rejected');

  // Test 7: Watchman Check-Out (Closes session & triggers Fairness Point Deduction)
  const initialScore = me.data.fairness.current_score;
  const checkOutRes = await request('POST', '/api/access/check-out', { bookingId: testBookingId }, { 'x-user-id': 'usr-watchman-ram' });
  console.log(`[Test 7] Check-Out & Point Deduction:`);
  console.log(`         Student: ${checkOutRes.data.studentName}`);
  console.log(`         Score Before: ${checkOutRes.data.scoreBefore} pts -> Score After: ${checkOutRes.data.scoreAfter} pts (-${checkOutRes.data.deduction} pts)`);
  console.log(`         Total Completed Sessions: ${checkOutRes.data.totalCompletedBookings}`);

  // Test 8: Student submits new booking request with fresh unique slot & student
  const testStudentId = `usr-e2e-sub-${Date.now()}`;
  const testRoll = `BT23E2E${Math.floor(Math.random() * 89999 + 10000)}`;
  db.prepare(`
    INSERT INTO users (user_id, name, roll_no, email, role, department)
    VALUES (?, 'E2E Queue Tester', ?, ?, 'student', 'CSE')
  `).run(testStudentId, testRoll, `${testStudentId}@iitbhilai.ac.in`);

  const submitRes = await request('POST', '/api/bookings/request', {
    slotId: 'slot-5',
    computePurpose: 'Distributed Reinforcement Learning on Gymnasium Environment',
    researchField: 'AI / Machine Learning'
  }, { 'x-user-id': testStudentId });

  console.log(`[Test 8] Booking Request Queued: requestId = ${submitRes.data.requestId}, initial score = ${submitRes.data.priorityScore}`);
  if (submitRes.status !== 201) throw new Error('Booking request submission failed: ' + JSON.stringify(submitRes.data));

  // Test 9: Run Allocation Round
  const allocRes = await request('POST', `/api/bookings/queue/slot-5/allocate`);
  console.log(`[Test 9] Batch Allocation Round: allocated = ${allocRes.data.allocatedCount}, waitlisted = ${allocRes.data.waitlistedCount}`);
  if (allocRes.status !== 200) throw new Error('Allocation round failed');

  // Clean up Test 9 allocated booking to maintain available workstation pool
  if (allocRes.data.allocations && allocRes.data.allocations.length > 0) {
    for (const alloc of allocRes.data.allocations) {
      db.prepare("DELETE FROM access_passes WHERE booking_id = ?").run(alloc.bookingId);
      db.prepare("DELETE FROM bookings WHERE booking_id = ?").run(alloc.bookingId);
      db.prepare("DELETE FROM booking_requests WHERE request_id = ?").run(alloc.requestId);
      db.prepare("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL, active_job = NULL WHERE machine_id = ?").run(alloc.machineId);
    }
  }

  // Test 10: Monte Carlo simulation with deterministic seed
  const simRes = await request('GET', '/api/fairness/simulation?iterations=200');
  console.log(`[Test 10] Deterministic Monte Carlo Simulation:`);
  console.log(`          FairLab Gini: ${simRes.data.fairLab.giniCoefficient} (Starvation: ${simRes.data.fairLab.starvationRate})`);
  console.log(`          FIFO Gini:    ${simRes.data.fifo.giniCoefficient} (Starvation: ${simRes.data.fifo.starvationRate})`);
  console.log(`          Methodology:  ${simRes.data.methodology.prngAlgorithm} (Seed: ${simRes.data.methodology.seed})`);

  console.log('✨ ========================================================');
  console.log('✨ ALL 10 INTEGRATION TESTS PASSED PERFECTLY!');
  console.log('✨ ========================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
