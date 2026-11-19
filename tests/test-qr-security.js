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

async function runQrSecurityTest() {
  console.log('===============================================================');
  console.log('🧪 HIGH-PRIORITY TEST 3: Cryptographic QR Security & Gate Auditing');
  console.log('   Adversarial Vectors Tested:');
  console.log('   1. Forged / Tampered HMAC Tokens');
  console.log('   2. Expired Digital Access Passes');
  console.log('   3. Cancelled / Revoked Bookings');
  console.log('   4. Replay Attacks / Duplicate Turnstile Check-Ins');
  console.log('   5. Unauthorized Accounts Attempting Turnstile Latch (RBAC)');
  console.log('===============================================================');

  const { getDb } = require('../backend/db/database');
  const db = getDb();

  const activeSem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();

  // Setup student & booking for security test
  const secStudentId = 'usr-test-sec-student';
  db.prepare(`
    INSERT OR REPLACE INTO users (user_id, name, roll_no, email, role, department)
    VALUES (?, 'Security Test Student', 'BT23SEC007', 'sec.test@iitbhilai.ac.in', 'student', 'Cybersecurity & CS')
  `).run(secStudentId);

  // Clean up any prior test booking for secStudentId to satisfy unique constraints
  db.prepare("DELETE FROM entry_logs WHERE user_id = ?").run(secStudentId);
  db.prepare("DELETE FROM access_passes WHERE user_id = ?").run(secStudentId);
  db.prepare("DELETE FROM bookings WHERE user_id = ?").run(secStudentId);

  // Free machine L106-PC-10
  db.prepare("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL WHERE machine_id = 'L106-PC-10'").run();

  // Setup valid booking
  const validBookingId = `L106-SEC-${Date.now()}`;
  db.prepare(`
    INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, status)
    VALUES (?, ?, 'L106-PC-10', 'slot-2', ?, 'CONFIRMED')
  `).run(validBookingId, secStudentId, activeSem.semester_id);

  let validPass;
  try {
    // Generate valid pass
    const { generateAccessPass } = require('../backend/services/passService');
    validPass = await generateAccessPass(
      validBookingId,
      secStudentId,
      'BT23SEC007',
      'L106-PC-10',
      'Round 2 Slot',
      '11:30 – 13:30'
    );

  console.log(`[Setup] Created genuine valid pass: ${validPass.signedToken}`);

  // -------------------------------------------------------------
  // Test 1: Forged / Tampered HMAC Token
  // -------------------------------------------------------------
  console.log('\n[Vector 1] Testing Forged / Tampered HMAC Token...');
  const forgedToken = validPass.signedToken.replace(/.$/, 'x'); // alter last byte of hash
  const forgeRes = await request('POST', '/api/access/verify', { token: forgedToken });

  console.log(`   Verification result: authorized = ${forgeRes.data.authorized}, code = ${forgeRes.data.code}`);
  if (forgeRes.data.authorized === true) {
    throw new Error('SECURITY BREACH: Forged token was incorrectly authorized!');
  }
  console.log('   ✓ PASS: Tampered token rejected immediately (TOKEN_NOT_FOUND / Signature Mismatch).');

  // -------------------------------------------------------------
  // Test 2: Expired Access Pass
  // -------------------------------------------------------------
  console.log('\n[Vector 2] Testing Expired Access Pass...');
  const expiredBookingId = `L106-EXPIRED-${Date.now()}`;
  db.prepare(`
    INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, status)
    VALUES (?, ?, 'L106-PC-12', 'slot-1', ?, 'CONFIRMED')
  `).run(expiredBookingId, secStudentId, activeSem.semester_id);

  const expiredPass = await generateAccessPass(
    expiredBookingId,
    secStudentId,
    'BT23SEC007',
    'L106-PC-12',
    'Morning Slot',
    '09:00 – 11:00'
  );

  // Artificially set expiry to past timestamp in DB
  db.prepare("UPDATE access_passes SET expires_at = datetime('now', '-2 hours') WHERE pass_id = ?").run(expiredPass.passId);

  const expiredRes = await request('POST', '/api/access/verify', { token: expiredPass.signedToken });
  console.log(`   Verification result: authorized = ${expiredRes.data.authorized}, code = ${expiredRes.data.code}`);
  if (expiredRes.data.authorized === true || expiredRes.data.code !== 'PASS_EXPIRED') {
    throw new Error(`SECURITY BREACH: Expired pass was authorized or returned wrong code: ${expiredRes.data.code}`);
  }
  console.log('   ✓ PASS: Expired pass rejected with code PASS_EXPIRED.');

  // -------------------------------------------------------------
  // Test 3: Cancelled / Revoked Booking
  // -------------------------------------------------------------
  console.log('\n[Vector 3] Testing Cancelled / Revoked Booking...');
  const cancelledBookingId = `L106-CANCEL-${Date.now()}`;
  db.prepare(`
    INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, status)
    VALUES (?, ?, 'L106-PC-14', 'slot-2', ?, 'CANCELLED')
  `).run(cancelledBookingId, secStudentId, activeSem.semester_id);

  const cancelledPass = await generateAccessPass(
    cancelledBookingId,
    secStudentId,
    'BT23SEC007',
    'L106-PC-14',
    'Slot 2',
    '11:30 – 13:30'
  );
  db.prepare("UPDATE access_passes SET status = 'REVOKED' WHERE pass_id = ?").run(cancelledPass.passId);

  const { signAuthToken } = require('../backend/middleware/auth');
  const opToken = signAuthToken({
    user_id: 'usr-watchman-ram',
    email: 'accessdesk.l106@iitbhilai.ac.in',
    role: 'admin',
    permissions: ['ACCESS_OPERATOR']
  });
  const opHeaders = { 'Authorization': `Bearer ${opToken}` };

  const cancelRes = await request('POST', '/api/access/verify', { token: cancelledPass.signedToken }, opHeaders);
  console.log(`   Verification result: authorized = ${cancelRes.data.authorized}, code = ${cancelRes.data.code}`);
  if (cancelRes.data.authorized === true || cancelRes.data.code !== 'BOOKING_CANCELLED') {
    throw new Error(`SECURITY BREACH: Cancelled pass was authorized or wrong code: ${cancelRes.data.code}`);
  }
  console.log('   ✓ PASS: Cancelled booking rejected with code BOOKING_CANCELLED.');

  // -------------------------------------------------------------
  // Test 4: Genuine Token Check-In & Duplicate Scan Replay Rejection
  // -------------------------------------------------------------
  console.log('\n[Vector 4] Testing Genuine Verification & Duplicate Scan Rejection...');
  const firstVerify = await request('POST', '/api/access/verify', { token: validPass.signedToken }, opHeaders);
  if (!firstVerify.data.authorized) throw new Error('Genuine pass failed initial validation');

  console.log(`   Initial verification passed for ${firstVerify.data.student.name} on ${firstVerify.data.workstation.machine_id}`);

  // Watchman records check-in
  const checkInRes = await request('POST', '/api/access/check-in', { passId: validPass.passId }, opHeaders);
  if (checkInRes.status !== 200) throw new Error('Legitimate check-in failed: ' + JSON.stringify(checkInRes.data));
  console.log(`   Turnstile Check-In accepted (Entry ID: ${checkInRes.data.entryId})`);

  // Immediate Second scan attempt with same pass
  const replayVerify = await request('POST', '/api/access/verify', { token: validPass.signedToken }, opHeaders);
  console.log(`   Replay Scan Attempt: authorized = ${replayVerify.data.authorized}, code = ${replayVerify.data.code}`);
  if (replayVerify.data.authorized === true || replayVerify.data.code !== 'ALREADY_CHECKED_IN') {
    throw new Error(`SECURITY BREACH: Duplicate scan was permitted! Code: ${replayVerify.data.code}`);
  }
  console.log('   ✓ PASS: QR code reuse prevented. Code ALREADY_CHECKED_IN returned.');

  // -------------------------------------------------------------
  // Test 5: Unauthorized Account Attempting Gate Latch (RBAC)
  // -------------------------------------------------------------
  console.log('\n[Vector 5] Testing RBAC: Unauthorized Student Account Calling Check-In...');
  const secStudentToken = signAuthToken({
    user_id: secStudentId,
    email: `${secStudentId}@iitbhilai.ac.in`,
    role: 'student',
    permissions: []
  });
  const secStudentHeaders = { 'Authorization': `Bearer ${secStudentToken}` };

  const unauthorizedCheckIn = await request('POST', '/api/access/check-in', {
    passId: validPass.passId
  }, secStudentHeaders); // Student user attempting gate operation!

  console.log(`   Unauthorized call HTTP status: ${unauthorizedCheckIn.status}`);
  if (unauthorizedCheckIn.status !== 403) {
    throw new Error(`SECURITY BREACH: Student account was able to call turnstile check-in! Status: ${unauthorizedCheckIn.status}`);
  }
  console.log(`   ✓ PASS: Access denied with 403 Forbidden: "${unauthorizedCheckIn.data.error}". Only campus security may unlatch gate.`);

  console.log('\n✨ TEST 3 (QR SECURITY & ACCESS CONTROLS) PASSED ALL 5 THREAT VECTORS!\n');
  } finally {
    try {
      db.prepare("DELETE FROM entry_logs WHERE pass_id = ?").run(validPass?.passId);
      db.prepare("DELETE FROM access_passes WHERE booking_id = ?").run(validBookingId);
      db.prepare("DELETE FROM bookings WHERE booking_id = ?").run(validBookingId);
      db.prepare("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL, active_job = NULL WHERE machine_id = 'L106-PC-10'").run();
    } catch (e) {
      // ignore teardown error
    }
  }
}

runQrSecurityTest().catch(err => {
  console.error('❌ Test 3 failed:', err);
  process.exit(1);
});
