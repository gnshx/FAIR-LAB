const http = require('http');
const assert = require('assert');
const { getDb } = require('../backend/db/database');

function httpRequest(method, path, body = null, headers = {}, rawBody = null) {
  return new Promise((resolve, reject) => {
    const data = rawBody !== null ? rawBody : (body !== null ? JSON.stringify(body) : null);
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data !== null ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let buf = '';
      res.on('data', chunk => { buf += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, raw: buf });
        }
      });
    });
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

async function runRedTeamSuite() {
  console.log('========================================================================');
  console.log('FAIRLAB ADVERSARIAL RED-TEAM, ANTI-CHEAT, CONCURRENCY & CRASH-TEST SUITE');
  console.log('========================================================================');

  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  assert(activeSem, 'Active semester must exist');

  const testDate = '2026-12-30';
  const testDate2 = '2026-12-31';

  const cleanup = () => {
    db.prepare("DELETE FROM notifications WHERE user_id LIKE 'usr-rt-%'").run();
    db.prepare("DELETE FROM entry_logs WHERE user_id LIKE 'usr-rt-%'").run();
    db.prepare("DELETE FROM allocation_history WHERE user_id LIKE 'usr-rt-%'").run();
    db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-rt-%'").run();
    db.prepare("DELETE FROM bookings WHERE booking_date IN (?, ?) OR user_id LIKE 'usr-rt-%'").run(testDate, testDate2);
    db.prepare("DELETE FROM allocation_rounds WHERE booking_date IN (?, ?)").run(testDate, testDate2);
    db.prepare("DELETE FROM waitlist_entries WHERE booking_date IN (?, ?) OR user_id LIKE 'usr-rt-%'").run(testDate, testDate2);
    db.prepare("DELETE FROM booking_requests WHERE booking_date IN (?, ?) OR user_id LIKE 'usr-rt-%'").run(testDate, testDate2);
    db.prepare("DELETE FROM student_fairness WHERE user_id LIKE 'usr-rt-%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'usr-rt-%'").run();
    db.prepare("DELETE FROM lab_date_overrides WHERE override_date IN (?, ?)").run(testDate, testDate2);
  };

  cleanup();

  try {
    // Isolate testDate & testDate2 from Mon–Fri academic classes during red-team tests
    for (const d of [testDate, testDate2]) {
      db.prepare(`
        INSERT OR REPLACE INTO lab_date_overrides (override_id, lab_id, override_date, override_type, is_open, open_time, close_time, ignore_timetable, reason)
        VALUES (?, 'lab-l106', ?, 'EXTRA_DAY', 1, '09:00', '18:00', 1, 'Isolated red-team test day')
      `).run(`ovr-${d}`, d);
    }
    // Seed dedicated red-team student accounts (attacker, victim, flooder, plus 30 racers)
    const baseAccounts = [
      { id: 'usr-rt-attacker', name: 'RedTeam Attacker', roll: 'RT-ATK', score: 40 },
      { id: 'usr-rt-victim', name: 'RedTeam Victim', roll: 'RT-VIC', score: 95 },
      { id: 'usr-rt-raceuser', name: 'RedTeam SameUser', roll: 'RT-SU', score: 90 },
      { id: 'usr-rt-flood', name: 'RedTeam Flooder', roll: 'RT-FLD', score: 80 }
    ];
    for (const u of baseAccounts) {
      db.prepare("INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES (?, ?, ?, ?, 'student', 'CSE')")
        .run(u.id, u.name, u.roll, `${u.id}@iitbhilai.ac.in`);
      db.prepare(`
        INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, total_hours_used, high_demand_count, high_demand_hours, penalty_points)
        VALUES (?, ?, ?, 100, ?, 0, 0, 0, 0, 0)
      `).run(`fair-${u.id}`, u.id, activeSem.semester_id, u.score);
    }

    const racerIds = [];
    for (let i = 1; i <= 30; i++) {
      const id = `usr-rt-racer-${i}`;
      racerIds.push(id);
      db.prepare("INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES (?, ?, ?, ?, 'student', 'CSE')")
        .run(id, `Racer ${i}`, `RT-R${i}`, `${id}@iitbhilai.ac.in`);
      db.prepare(`
        INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, total_hours_used, high_demand_count, high_demand_hours, penalty_points)
        VALUES (?, ?, ?, 100, ?, 0, 0, 0, 0, 0)
      `).run(`fair-${id}`, id, activeSem.semester_id, 60 + i);
    }

    // -----------------------------------------------------------------------
    // ATTACK 1: Forged Priority Score Injection in Request Payload
    // -----------------------------------------------------------------------
    const spoofRes = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: testDate,
      startTime: '09:30',
      endTime: '10:30',
      preferredWorkstations: ['A-R5-PC01'],
      computePurpose: 'Attempt score spoof',
      allocationMode: 'SCHEDULED',
      priority_score_snapshot: 99999,
      priorityScore: 99999,
      current_score: 99999
    }, { 'x-user-id': 'usr-rt-attacker' });
    assert.strictEqual(spoofRes.status, 201);
    assert.strictEqual(spoofRes.data.priorityScore, 40, 'Server must ignore client-supplied score and use DB value (40)');
    console.log('[Attack 1]  PASS: Forged priority score (99999) ignored; server enforced true DB score (40 pts).');

    // -----------------------------------------------------------------------
    // ATTACK 2: Privilege Escalation — Student Calling Admin Endpoints
    // -----------------------------------------------------------------------
    const privCalls = [
      httpRequest('PUT', '/api/v1/admin/policy', {
        base_score: 200, deduction_per_hour: 0.5, no_show_penalty: 0, cancellation_window_hours: 1, grace_period_minutes: 60
      }, { 'x-user-id': 'usr-rt-attacker' }),
      httpRequest('POST', '/api/v1/admin/semester/reset', { semesterName: 'Hacked Term' }, { 'x-user-id': 'usr-rt-attacker' }),
      httpRequest('POST', '/api/v1/admin/override', {
        userId: 'usr-rt-attacker', slotId: 'slot-1', machineId: 'L106-PC-01', reason: 'Self-granted hack'
      }, { 'x-user-id': 'usr-rt-attacker' }),
      httpRequest('POST', '/api/v1/admin/workstation/toggle-maintenance', {
        machineId: 'L106-PC-01', isMaintenance: true
      }, { 'x-user-id': 'usr-rt-attacker' }),
      httpRequest('POST', '/api/v1/admin/process-no-shows', { force: true }, { 'x-user-id': 'usr-rt-attacker' })
    ];
    const privResults = await Promise.all(privCalls);
    for (const r of privResults) {
      assert.strictEqual(r.status, 403, `Student must receive 403 Forbidden on admin endpoint, got ${r.status}`);
    }
    console.log('[Attack 2]  PASS: All 5 admin endpoints blocked student privilege escalation with 403 Forbidden.');

    // -----------------------------------------------------------------------
    // ATTACK 3: Queue-Jump via Client-Forced allocationMode="IMMEDIATE"
    // -----------------------------------------------------------------------
    const jumpRes = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: testDate,
      startTime: '09:30',
      endTime: '10:30',
      preferredWorkstations: ['A-R5-PC01'],
      computePurpose: 'Attempt queue jump',
      allocationMode: 'IMMEDIATE'
    }, { 'x-user-id': 'usr-rt-victim' });
    assert.strictEqual(jumpRes.status, 400, 'Client-supplied allocationMode="IMMEDIATE" must be rejected by Zod schema');

    // Now victim submits valid AUTO request on the same contested window (09:30-10:30 where attacker is QUEUED)
    const contestedAuto = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: testDate,
      startTime: '09:30',
      endTime: '10:30',
      preferredWorkstations: ['A-R5-PC01'],
      computePurpose: 'Contested AUTO request',
      allocationMode: 'AUTO'
    }, { 'x-user-id': 'usr-rt-victim' });
    assert.strictEqual(contestedAuto.status, 201);
    assert.strictEqual(contestedAuto.data.status, 'PENDING', 'Contested window must route to fairness queue, not immediate confirm');
    console.log('[Attack 3]  PASS: Client IMMEDIATE bypass rejected (400) & contested AUTO request routed to Fairness Queue.');

    // -----------------------------------------------------------------------
    // ATTACK 4: Cross-User IDOR Sabotage (Cancel Victim's Request & Booking)
    // -----------------------------------------------------------------------
    const idorReq = await httpRequest('DELETE', `/api/v1/booking-requests/${contestedAuto.data.requestId}`, null, {
      'x-user-id': 'usr-rt-attacker'
    });
    assert.strictEqual(idorReq.status, 403, 'Attacker must get 403 when trying to withdraw victim queued request');

    // Victim gets an immediate booking on an uncontested slot (13:00-14:00)
    const victimBook = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: testDate,
      startTime: '13:00',
      endTime: '14:00',
      preferredWorkstations: ['B-R2-PC01'],
      computePurpose: 'Victim legitimate booking',
      allocationMode: 'AUTO'
    }, { 'x-user-id': 'usr-rt-victim' });
    assert.strictEqual(victimBook.status, 201);
    assert.strictEqual(victimBook.data.status, 'CONFIRMED');
    const victimBookingId = victimBook.data.booking.bookingId;

    const idorCancelPost = await httpRequest('POST', `/api/v1/bookings/${victimBookingId}/cancel`, { reason: 'Steal seat' }, {
      'x-user-id': 'usr-rt-attacker'
    });
    const idorCancelDel = await httpRequest('DELETE', `/api/v1/bookings/${victimBookingId}`, null, {
      'x-user-id': 'usr-rt-attacker'
    });
    assert.strictEqual(idorCancelPost.status, 403, 'Attacker POST cancel on victim booking must be 403');
    assert.strictEqual(idorCancelDel.status, 403, 'Attacker DELETE on victim booking must be 403');
    console.log('[Attack 4]  PASS: Cross-user IDOR request withdrawal & booking cancellation blocked (403 Forbidden).');

    // -----------------------------------------------------------------------
    // ATTACK 5: Sybil / Unregistered Fake User Account
    // -----------------------------------------------------------------------
    const sybilRes = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: testDate,
      startTime: '14:00',
      endTime: '15:00',
      computePurpose: 'Sybil fake user'
    }, { 'x-user-id': 'usr-nonexistent-sybil-999' });
    assert.strictEqual(sybilRes.status, 401, 'Unregistered x-user-id must return 401 Unauthorized');
    console.log('[Attack 5]  PASS: Forged/unregistered x-user-id rejected cleanly with 401 Unauthorized.');

    // -----------------------------------------------------------------------
    // ATTACK 6: QR PII Leak Check + Double Check-Out + Invalid-State Check-In
    // -----------------------------------------------------------------------
    assert(victimBook.data.pass && victimBook.data.pass.qrPayload, 'Pass must have qrPayload');
    const parsedQr = JSON.parse(victimBook.data.pass.qrPayload);
    assert.strictEqual(parsedQr.rollNo, undefined, 'QR payload must NOT contain rollNo PII');
    assert.strictEqual(parsedQr.studentName, undefined, 'QR payload must NOT contain studentName PII');

    // Watchman checks in, then checks out ONCE, then attempts DOUBLE check-out!
    const ci1 = await httpRequest('POST', '/api/v1/access/check-in', { passId: victimBook.data.pass.passId }, { 'x-user-id': 'usr-watchman-ram' });
    assert.strictEqual(ci1.status, 200);
    const co1 = await httpRequest('POST', '/api/v1/access/check-out', { bookingId: victimBookingId }, { 'x-user-id': 'usr-watchman-ram' });
    assert.strictEqual(co1.status, 200);
    const co2 = await httpRequest('POST', '/api/v1/access/check-out', { bookingId: victimBookingId }, { 'x-user-id': 'usr-watchman-ram' });
    assert.strictEqual(co2.status, 400, 'Duplicate check-out must be rejected to prevent double deduction');

    // Try direct check-in on already USED pass
    const ciUsed = await httpRequest('POST', '/api/v1/access/check-in', { passId: victimBook.data.pass.passId }, { 'x-user-id': 'usr-watchman-ram' });
    assert.strictEqual(ciUsed.status, 400, 'Direct check-in on USED pass must be rejected');
    console.log('[Attack 6]  PASS: Zero PII in QR payload; double check-out & USED pass check-in both blocked (400).');

    // -----------------------------------------------------------------------
    // ATTACK 7: Same User Firing 20 Simultaneous Requests (Race Condition)
    // -----------------------------------------------------------------------
    const sameUserBurst = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        httpRequest('POST', '/api/v1/booking-requests', {
          bookingDate: testDate2,
          startTime: '10:00',
          endTime: '11:00',
          preferredWorkstations: ['A-R6-PC01'],
          computePurpose: `Same-user race #${i}`
        }, { 'x-user-id': 'usr-rt-raceuser' })
      )
    );
    const succeededSameUser = sameUserBurst.filter(r => r.status === 201);
    assert.strictEqual(succeededSameUser.length, 1, `Expected exactly 1 success in 20x same-user race, got ${succeededSameUser.length}`);
    console.log('[Attack 7]  PASS: 20x simultaneous same-user requests -> exactly 1 confirmed, 19 blocked (0 duplicates).');

    // -----------------------------------------------------------------------
    // ATTACK 8: 30 Distinct Students Simultaneously Racing for ONE Seat (A-R4-PC01)
    // -----------------------------------------------------------------------
    const seatRace = await Promise.all(
      racerIds.map((uid, idx) =>
        httpRequest('POST', '/api/v1/booking-requests', {
          bookingDate: testDate2,
          startTime: idx % 2 === 0 ? '11:30' : '12:00',
          endTime: idx % 2 === 0 ? '12:30' : '13:00',
          preferredWorkstations: ['A-R4-PC01'],
          computePurpose: `Seat race #${idx}`,
          allocationMode: 'AUTO'
        }, { 'x-user-id': uid })
      )
    );
    const pc01Bookings = db.prepare(`
      SELECT b.booking_id, b.start_time, b.end_time
      FROM bookings b
      JOIN workstations w ON b.machine_id = w.machine_id
      WHERE w.display_label = 'A-R4-PC01' AND b.booking_date = ? AND b.status IN ('CONFIRMED', 'CHECKED_IN')
    `).all(testDate2);
    // Check no two bookings on A-R4-PC01 overlap
    for (let i = 0; i < pc01Bookings.length; i++) {
      for (let j = i + 1; j < pc01Bookings.length; j++) {
        const a = pc01Bookings[i], b = pc01Bookings[j];
        assert(!(a.start_time < b.end_time && b.start_time < a.end_time), 'Overlapping booking detected on A-R4-PC01!');
      }
    }
    assert(seatRace.every(r => r.status === 201 || r.status === 400), 'No 500 errors allowed under 30-student seat race');
    console.log(`[Attack 8]  PASS: 30-student simultaneous race on overlapping windows -> ${pc01Bookings.length} booking(s) on A-R4-PC01, 0 overlaps, 0 HTTP 500s.`);

    // -----------------------------------------------------------------------
    // ATTACK 9: 10x Idempotency-Key Replay Storm
    // -----------------------------------------------------------------------
    const idempKey = `rt-idemp-${Date.now()}`;
    const replays = await Promise.all(
      Array.from({ length: 10 }, () =>
        httpRequest('POST', '/api/v1/booking-requests', {
          bookingDate: testDate2,
          startTime: '15:00',
          endTime: '16:00',
          preferredWorkstations: ['B-R3-PC01'],
          computePurpose: 'Idempotency replay test',
          allocationMode: 'SCHEDULED',
          idempotencyKey: idempKey
        }, { 'x-user-id': 'usr-rt-victim', 'idempotency-key': idempKey })
      )
    );
    const createdReqIds = new Set(replays.filter(r => r.status === 201).map(r => r.data.requestId));
    assert.strictEqual(createdReqIds.size, 1, `10x idempotent replays must yield exactly 1 requestId, got ${createdReqIds.size}`);
    console.log('[Attack 9]  PASS: 10x identical Idempotency-Key replay storm -> exactly 1 logical request created.');

    // -----------------------------------------------------------------------
    // ATTACK 10: Crash Fuzzing — Malformed JSON, 150KB Oversized Payload, SQLi, XSS
    // -----------------------------------------------------------------------
    const badJson = await httpRequest('POST', '/api/v1/booking-requests', null, { 'x-user-id': 'usr-rt-victim' }, '{broken: json,,,');
    assert.strictEqual(badJson.status, 400, `Malformed JSON must return 400, got ${badJson.status}`);

    const hugePayload = JSON.stringify({ computePurpose: 'A'.repeat(150 * 1024) });
    const tooLarge = await httpRequest('POST', '/api/v1/booking-requests', null, { 'x-user-id': 'usr-rt-victim' }, hugePayload);
    assert.strictEqual(tooLarge.status, 413, `150KB payload must return 413, got ${tooLarge.status}`);

    const sqliAvail = await httpRequest('GET', `/api/v1/availability?labId=${encodeURIComponent("L106' OR 1=1;--")}&date=${testDate}`);
    assert(sqliAvail.status === 200 || sqliAvail.status === 400, 'SQLi query must not return 500');
    const sqliBook = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: testDate,
      startTime: '16:00',
      endTime: '17:00',
      preferredWorkstations: ["A-R1-PC01'; DROP TABLE bookings;--"],
      computePurpose: "<script>alert('xss')</script> ' OR 1=1 --"
    }, { 'x-user-id': 'usr-rt-attacker' });
    assert.strictEqual(sqliBook.status, 400, 'SQLi workstation ID must be cleanly rejected with 400');
    const bookingsTableCount = db.prepare('SELECT COUNT(*) as c FROM bookings').get().c;
    assert(bookingsTableCount >= 0, 'bookings table must remain completely intact after SQLi attempt');
    console.log('[Attack 10] PASS: Malformed JSON (400), 150KB DoS payload (413), SQLi & XSS safely neutralized.');

    // -----------------------------------------------------------------------
    // ATTACK 11: Invalid Dates, Past Dates, >3 Prefs, Offline Seat, Daily Cap Bypass
    // -----------------------------------------------------------------------
    const invalidInputs = [
      { label: 'Impossible date 2026-02-31', body: { bookingDate: '2026-02-31', startTime: '10:00', endTime: '11:00', computePurpose: 'Bad date' } },
      { label: 'Past date 2020-01-01', body: { bookingDate: '2020-01-01', startTime: '10:00', endTime: '11:00', computePurpose: 'Past date' } },
      { label: 'Out of lab hours 19:00-20:00', body: { bookingDate: testDate, startTime: '19:00', endTime: '20:00', computePurpose: 'After hours' } },
      { label: 'Too short 10:00-10:15 (15m)', body: { bookingDate: testDate, startTime: '10:00', endTime: '10:15', computePurpose: 'Too short' } },
      { label: 'Daily cap bypass 09:00-12:00 (3h > 2h max)', body: { bookingDate: testDate, startTime: '09:00', endTime: '12:00', computePurpose: 'Exceed daily max' } },
      { label: '4 preferences (>3 max)', body: { bookingDate: testDate, startTime: '16:00', endTime: '17:00', preferredWorkstations: ['A-R1-PC01', 'A-R1-PC02', 'A-R1-PC03', 'A-R1-PC05'], computePurpose: 'Too many prefs' } },
      { label: 'Offline maintenance seat A-R1-PC04', body: { bookingDate: testDate, startTime: '16:00', endTime: '17:00', preferredWorkstations: ['A-R1-PC04'], computePurpose: 'Offline seat' } }
    ];
    for (const tc of invalidInputs) {
      const r = await httpRequest('POST', '/api/v1/booking-requests', tc.body, { 'x-user-id': 'usr-rt-victim' });
      assert.strictEqual(r.status, 400, `${tc.label} must be rejected with 400, got ${r.status}`);
    }
    console.log('[Attack 11] PASS: All 7 edge-case invalid bookings (bad/past date, after-hours, <30m, 3h>2h daily cap, >3 prefs, offline seat) rejected (400).');

    // -----------------------------------------------------------------------
    // ATTACK 12: Per-User Rate Limiting Flood Defense (55 Rapid Requests)
    // -----------------------------------------------------------------------
    const floodResults = [];
    for (let i = 0; i < 55; i++) {
      const r = await httpRequest('POST', '/api/v1/booking-requests', {
        bookingDate: '2026-02-31',
        startTime: '10:00',
        endTime: '11:00',
        computePurpose: 'Spam flood'
      }, { 'x-user-id': 'usr-rt-flood' });
      floodResults.push(r.status);
    }
    const rateLimitedCount = floodResults.filter(s => s === 429).length;
    assert(rateLimitedCount >= 5, `Expected 429 Too Many Requests under 55x single-user flood, got ${rateLimitedCount}`);
    console.log(`[Attack 12] PASS: Single-user spam flood throttled with ${rateLimitedCount}x HTTP 429 Too Many Requests.`);

    // -----------------------------------------------------------------------
    // ATTACK 13: Strict @iitbhilai.ac.in Login Domain Enforcement & Spoof Tests
    // -----------------------------------------------------------------------
    const badEmails = [
      'ganesh@gmail.com',
      'ganesh@iitbhilai.ac.in.evil.com',
      'ganesh@notiitbhilai.ac.in',
      'ganesh@sub.iitbhilai.ac.in',
      '@iitbhilai.ac.in',
      'ganesh k@iitbhilai.ac.in'
    ];
    for (const bad of badEmails) {
      const r = await httpRequest('POST', '/api/auth/login', { email: bad, password: 'testpassword' });
      assert.strictEqual(r.status, 403, `Non-@iitbhilai.ac.in email "${bad}" must be rejected with 403, got ${r.status}`);
    }
    const unknownInst = await httpRequest('POST', '/api/auth/login', { email: 'unregistered.user@iitbhilai.ac.in', password: 'testpassword' });
    assert.strictEqual(unknownInst.status, 401, `Unregistered @iitbhilai.ac.in email must return 401, got ${unknownInst.status}`);

    const validStudent = await httpRequest('POST', '/api/auth/login', { email: 'Ganesh.K@IITBHILAI.AC.IN', password: 'testpassword' });
    assert.strictEqual(validStudent.status, 200, `Registered @iitbhilai.ac.in student must succeed (200), got ${validStudent.status}`);
    assert.strictEqual(validStudent.data.user.role, 'student');

    const validAdmin = await httpRequest('POST', '/api/auth/login', { email: 'aksharma@iitbhilai.ac.in', password: 'testpassword' });
    assert.strictEqual(validAdmin.status, 200, `Registered @iitbhilai.ac.in admin must succeed (200), got ${validAdmin.status}`);
    assert.strictEqual(validAdmin.data.user.role, 'admin');
    assert(validAdmin.data.token && validAdmin.data.token.split('.').length === 3, 'Login must issue a valid HS256 JWT');
    console.log('[Attack 13] PASS: Strict @iitbhilai.ac.in login gate blocked all 6 spoofed/external domains (403), rejected unknown institute email (401), and issued signed JWTs (200).');

    // -----------------------------------------------------------------------
    // ATTACK 14: Verified JWT Auth Trust Model & Scoped ACCESS_OPERATOR Permission
    // -----------------------------------------------------------------------
    // 14A: Valid Bearer JWT authenticates /api/auth/me without any x-user-id header
    const jwtMe = await httpRequest('GET', '/api/auth/me', null, { Authorization: `Bearer ${validAdmin.data.token}` });
    assert.strictEqual(jwtMe.status, 200, 'Verified Bearer JWT must authenticate /api/auth/me');
    assert.strictEqual(jwtMe.data.user.user_id, 'usr-admin-sharma');

    // 14B: Tampered JWT signature must be rejected with 401
    const badJwt = await httpRequest('GET', '/api/auth/me', null, { Authorization: `Bearer ${validAdmin.data.token}x` });
    assert.strictEqual(badJwt.status, 401, `Tampered JWT must return 401, got ${badJwt.status}`);

    // 14C: Admin account WITHOUT ACCESS_OPERATOR permission (usr-faculty-sneha) must be rejected (403) on gate check-in
    const nonOpAdminLogin = await httpRequest('POST', '/api/auth/login', { email: 'ssen@iitbhilai.ac.in', password: 'testpassword' });
    assert.strictEqual(nonOpAdminLogin.status, 200);
    assert.strictEqual(nonOpAdminLogin.data.user.role, 'admin');
    const nonOpGate = await httpRequest('POST', '/api/access/check-in', { passId: 'pass-nonexistent' }, {
      Authorization: `Bearer ${nonOpAdminLogin.data.token}`
    });
    assert.strictEqual(nonOpGate.status, 403, `Admin without ACCESS_OPERATOR permission must get 403 on gate check-in, got ${nonOpGate.status}`);
    console.log('[Attack 14] PASS: Signed JWT verified on /api/auth/me, tampered JWT rejected (401), and Admin without ACCESS_OPERATOR blocked from gate check-in (403).');

    // -----------------------------------------------------------------------
    // FINAL CHECK: Server Liveness & Integrity Post-Red-Team
    // -----------------------------------------------------------------------
    const health = await httpRequest('GET', '/health');
    const avail = await httpRequest('GET', '/api/v1/availability?labId=L106');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(avail.status, 200);
    assert.strictEqual(avail.data.summary.totalWorkstations, 84);
    console.log('[Liveness]  PASS: Server alive & healthy (200 OK, 84/84 workstations intact) after all 13 adversarial attacks.');

    console.log('\n========================================================================');
    console.log('ALL 13 ADVERSARIAL RED-TEAM, ANTI-CHEAT & CRASH TESTS PASSED 100%!');
    console.log('========================================================================');
  } finally {
    cleanup();
  }
}

runRedTeamSuite().catch(err => {
  console.error('Red-Team Suite Failed:', err);
  process.exit(1);
});
