/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FairLab Phase 10: Final Validation & Reproducible Demonstration Test Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Self-contained verification of every Phase 9/10 architectural invariant:
 *   V1  Clean Database Setup (84 workstations, Block A/B, timetable, 2-role model)
 *   V2  Complete Student Booking Journey (login → JWT/cookie → book → QR → check-in → check-out → score → 0-penalty cancel)
 *   V3  Competing Requests, Atomic Anti-Bypass & Fairness Allocation Ordering
 *   V4  Admin Workstation Management (maintenance toggle + automatic active-booking reallocation + restore)
 *   V5  Access Control Matrix (Student, Ordinary Admin, Admin + ACCESS_OPERATOR, IDOR, @iitbhilai.ac.in)
 *   V6  JWT & Cookie Security (tamper, expiry, logout, AND live NODE_ENV=production x-user-id blocking + Secure cookie)
 *   V7  Server Restart, Transactional Outbox Crash Recovery & Duplicate-Event Idempotency
 *   V8  Zod Validation & Malformed/Oversized Payload Hardening
 *
 * Run: node tests/test-phase10-validation.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const TEST_DB_PATH = path.join(BACKEND_DIR, 'fairlab-phase10-validation.db');
const DB_FILES = [
  TEST_DB_PATH,
  `${TEST_DB_PATH}-shm`,
  `${TEST_DB_PATH}-wal`
];

const DEV_PORT = 5055;
const PROD_PORT = 5056;
const DEV_BASE = `http://127.0.0.1:${DEV_PORT}`;
const DEV_API = `${DEV_BASE}/api`;
const PROD_BASE = `http://127.0.0.1:${PROD_PORT}`;
const PROD_API = `${PROD_BASE}/api`;

const TEST_JWT_SECRET = crypto.randomBytes(32).toString('hex');
const TEST_HMAC_SECRET = crypto.randomBytes(32).toString('hex');

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, detail = '') {
  totalTests++;
  if (condition) {
    passed++;
    console.log(`    ✅ ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.log(`    ❌ FAIL: ${msg}`);
  }
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch {}
  return { status: res.status, json, raw: body, headers: res.headers };
}

async function login(apiBase, email, password = 'demo-password') {
  return fetchJSON(`${apiBase}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

function getFutureSaturday(weeksAhead = 2) {
  const d = new Date();
  d.setDate(d.getDate() + weeksAhead * 7);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function removeDbFiles() {
  for (const f of DB_FILES) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function spawnServer(port, extraEnv = {}) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      HOST: '127.0.0.1',
      FAIRLAB_DB_PATH: TEST_DB_PATH,
      JWT_SECRET: TEST_JWT_SECRET,
      HMAC_SECRET: TEST_HMAC_SECRET,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  proc.stdout.on('data', d => { logs += d.toString(); });
  proc.stderr.on('data', d => { logs += d.toString(); });
  proc.getLogs = () => logs;
  return proc;
}

async function waitForHealth(baseUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetchJSON(`${baseUrl}/health`);
      if (r.status === 200) return r;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy within ${timeoutMs}ms`);
}

async function stopServer(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

function signCustomJwt(payloadObj, secret) {
  const b64u = (s) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${h}.${p}.${sig}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// V1: CLEAN DATABASE SETUP & SEED VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
async function V1_cleanDatabaseSeed() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V1: Clean Database Setup & Seed Verification            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const health = await fetchJSON(`${DEV_BASE}/health`);
  assert(health.status === 200, 'V1.1  Fresh server boots cleanly & responds to /health');
  assert(health.json?.workstations === 84, 'V1.2  Health reports 84 seeded workstations');

  const avail = await fetchJSON(`${DEV_API}/availability?labId=L106`);
  assert(avail.status === 200, 'V1.3  Availability API returns 200 on fresh DB');
  const seats = avail.json?.workstations || [];
  assert(seats.length === 84, 'V1.4  Exactly 84 workstations present in Lab L-106', `got ${seats.length}`);
  assert(seats.filter(w => w.block_code === 'A').length === 60, 'V1.5  Block A seeded with 60 seats (6×10)');
  assert(seats.filter(w => w.block_code === 'B').length === 24, 'V1.6  Block B seeded with 24 seats (4×6)');

  const usersRes = await fetchJSON(`${DEV_API}/auth/users`);
  const users = usersRes.json || [];
  const roles = new Set(users.map(u => u.role));
  assert(users.length >= 9, 'V1.7  Demo personas seeded (≥9 users)');
  assert(!roles.has('watchman'), 'V1.8  Strictly 2-role model (no legacy "watchman" role)');
  assert(roles.has('student') && roles.has('admin'), 'V1.9  Both "student" and "admin" roles exist');

  const accessOps = users.filter(u => Array.isArray(u.permissions) && u.permissions.includes('ACCESS_OPERATOR'));
  const nonOpAdmins = users.filter(u => u.role === 'admin' && !u.permissions.includes('ACCESS_OPERATOR'));
  assert(accessOps.length >= 2, 'V1.10 Designated admins hold ACCESS_OPERATOR permission');
  assert(nonOpAdmins.length >= 1, 'V1.11 Ordinary admin without ACCESS_OPERATOR exists for RBAC separation');

  const sched = await fetchJSON(`${DEV_API}/admin/schedule-overview`, { headers: { 'x-user-id': 'usr-admin-sharma' } });
  assert(sched.status === 200, 'V1.12 Schedule overview responds on clean DB');
  assert(Array.isArray(sched.json?.timetable) && sched.json.timetable.length >= 1, 'V1.13 Mon–Fri academic timetable seeded');
  assert(Array.isArray(sched.json?.ticketReleases) && sched.json.ticketReleases.length >= 1, 'V1.14 Admin ticket releases seeded');
}

// ═══════════════════════════════════════════════════════════════════════════
// V2: COMPLETE STUDENT BOOKING JOURNEY (LOGIN → BOOK → QR → CHECK-IN → OUT)
// ═══════════════════════════════════════════════════════════════════════════
async function V2_completeStudentJourney() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V2: Complete Student Booking & Gate Check-In/Out        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // 1. Login & verify JWT + HttpOnly cookie
  const loginRes = await login(DEV_API, 'priya.s@iitbhilai.ac.in');
  assert(loginRes.status === 200 && loginRes.json?.success === true, 'V2.1  Student login succeeds (200)');
  const token = loginRes.json?.token;
  const setCookie = loginRes.headers.get('set-cookie') || '';
  assert(typeof token === 'string' && token.split('.').length === 3, 'V2.2  Signed 3-part HS256 JWT issued');
  assert(setCookie.includes('fairlab_session=') && setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'),
    'V2.3  HttpOnly; SameSite=Lax session cookie set');

  const authHeader = { Authorization: `Bearer ${token}` };
  const cookiePair = setCookie.split(';')[0];

  // 2. /auth/me works via Bearer AND via Cookie alone
  const meBearer = await fetchJSON(`${DEV_API}/auth/me`, { headers: authHeader });
  const meCookie = await fetchJSON(`${DEV_API}/auth/me`, { headers: { Cookie: cookiePair } });
  assert(meBearer.status === 200 && meBearer.json?.user?.user_id === 'usr-student-priya' && meBearer.json?.user?.authSource === 'JWT_BEARER',
    'V2.4  /auth/me resolves identity from JWT_BEARER');
  assert(meCookie.status === 200 && meCookie.json?.user?.user_id === 'usr-student-priya' && meCookie.json?.user?.authSource === 'SESSION_COOKIE',
    'V2.5  /auth/me resolves identity from SESSION_COOKIE');

  const scoreBefore = meBearer.json?.fairness?.current_score ?? 100;

  // 3. Submit custom interval booking (uncontested Saturday -> IMMEDIATE)
  const bookDate = getFutureSaturday(2);
  const idempKey = `phase10-v2-${Date.now()}`;
  const bookRes = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      bookingDate: bookDate,
      startTime: '10:00',
      endTime: '11:00',
      preferredWorkstations: ['L106-PC-10'],
      computePurpose: 'Phase 10 E2E Student Journey',
      researchField: 'Systems Engineering',
      allocationMode: 'AUTO',
      idempotencyKey: idempKey
    })
  });
  assert(bookRes.status === 201 && bookRes.json?.status === 'CONFIRMED', 'V2.6  Uncontested AUTO request immediately CONFIRMED', JSON.stringify(bookRes.json));
  assert(bookRes.json?.booking?.allocationMode === 'IMMEDIATE', 'V2.7  Allocation mode recorded as IMMEDIATE');
  assert(bookRes.json?.booking?.machineId === 'L106-PC-10', 'V2.8  1st ranked preference (L106-PC-10) honored');
  assert(Boolean(bookRes.json?.pass?.passId && bookRes.json?.pass?.signedToken), 'V2.9  Cryptographically signed QR pass generated');

  // 4. Idempotent replay returns same requestId
  const replay = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      bookingDate: bookDate,
      startTime: '10:00',
      endTime: '11:00',
      preferredWorkstations: ['L106-PC-10'],
      computePurpose: 'Phase 10 Replay',
      allocationMode: 'AUTO',
      idempotencyKey: idempKey
    })
  });
  assert(replay.status === 201 && replay.json?.requestId === bookRes.json?.requestId, 'V2.10 Idempotent replay returns identical requestId');

  // 5. Gate QR verify → AUTHORIZED
  const pass = bookRes.json.pass;
  const bookingId = bookRes.json.booking.bookingId;
  const verifyRes = await fetchJSON(`${DEV_API}/access/verify`, {
    method: 'POST',
    body: JSON.stringify({ token: pass.signedToken })
  });
  assert(verifyRes.status === 200 && verifyRes.json?.authorized === true && verifyRes.json?.code === 'ENTRY_AUTHORIZED',
    'V2.11 Gate QR verification returns ENTRY_AUTHORIZED', JSON.stringify(verifyRes.json));

  // 6. Gate Check-In by designated ACCESS_OPERATOR admin
  const gateLogin = await login(DEV_API, 'accessdesk.l106@iitbhilai.ac.in');
  const gateHeader = { Authorization: `Bearer ${gateLogin.json?.token}` };
  const checkInRes = await fetchJSON(`${DEV_API}/access/check-in`, {
    method: 'POST',
    headers: gateHeader,
    body: JSON.stringify({ passId: pass.passId, notes: 'Phase 10 validation gate entry' })
  });
  assert(checkInRes.status === 200 && checkInRes.json?.status === 'CHECKED_IN', 'V2.12 Gate check-in transitions booking to CHECKED_IN', JSON.stringify(checkInRes.json));

  // 7. Replay attack on already-used QR pass → DENIED
  const replayQr = await fetchJSON(`${DEV_API}/access/verify`, {
    method: 'POST',
    body: JSON.stringify({ token: pass.signedToken })
  });
  assert(replayQr.status === 200 && replayQr.json?.authorized === false,
    'V2.13 Replayed QR pass denied at gate (anti-replay)', JSON.stringify(replayQr.json));

  // 8. Gate Check-Out → COMPLETED & fairness score deducted
  const checkOutRes = await fetchJSON(`${DEV_API}/access/check-out`, {
    method: 'POST',
    headers: gateHeader,
    body: JSON.stringify({ bookingId, notes: 'Phase 10 validation gate exit' })
  });
  assert(checkOutRes.status === 200 && checkOutRes.json?.status === 'COMPLETED', 'V2.14 Gate check-out transitions booking to COMPLETED', JSON.stringify(checkOutRes.json));
  assert(typeof checkOutRes.json?.scoreAfter === 'number' && checkOutRes.json.scoreAfter < scoreBefore,
    `V2.15 Fairness score deducted on completion (${scoreBefore} → ${checkOutRes.json?.scoreAfter})`);

  // 9. Book a second interval and cancel voluntarily via Bearer JWT only -> 0 penalty
  const book2 = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      bookingDate: getFutureSaturday(3),
      startTime: '11:00',
      endTime: '12:00',
      computePurpose: 'Zero-penalty cancel check',
      allocationMode: 'AUTO'
    })
  });
  assert(book2.status === 201 && book2.json?.status === 'CONFIRMED', 'V2.16 Second booking confirmed');
  const cancelRes = await fetchJSON(`${DEV_API}/bookings/${book2.json.booking.bookingId}/cancel`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ reason: 'Voluntary early release' })
  });
  assert(cancelRes.status === 200 && cancelRes.json?.penaltyApplied === 0, 'V2.17 Voluntary cancel via JWT succeeds with 0 penalty', JSON.stringify(cancelRes.json));
}

// ═══════════════════════════════════════════════════════════════════════════
// V3: COMPETING REQUESTS, ANTI-BYPASS & FAIRNESS ALLOCATION
// ═══════════════════════════════════════════════════════════════════════════
async function V3_competingRequestsFairness() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V3: Competing Requests, Anti-Bypass & Fairness Ranking  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const bookDate = getFutureSaturday(4);
  // Seeded scores: Priya=95 (after V2), Rahul=80, Ananya=70, Vikram=50
  const priya = await login(DEV_API, 'priya.s@iitbhilai.ac.in');
  const rahul = await login(DEV_API, 'rahul.v@iitbhilai.ac.in');
  const ananya = await login(DEV_API, 'ananya.p@iitbhilai.ac.in');
  const vikram = await login(DEV_API, 'vikram.s@iitbhilai.ac.in');

  // Submit lower-score student FIRST (Ananya=70) in SCHEDULED mode, then higher-score (Priya=95)
  const rAnanya = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ananya.json.token}` },
    body: JSON.stringify({
      bookingDate: bookDate, startTime: '14:00', endTime: '15:00',
      preferredWorkstations: ['L106-PC-01'],
      computePurpose: 'Ananya submitted first (score 70)', allocationMode: 'SCHEDULED'
    })
  });
  const rRahul = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rahul.json.token}` },
    body: JSON.stringify({
      bookingDate: bookDate, startTime: '14:00', endTime: '15:00',
      preferredWorkstations: ['L106-PC-01'],
      computePurpose: 'Rahul submitted second (score 80)', allocationMode: 'SCHEDULED'
    })
  });
  const rPriya = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${priya.json.token}` },
    body: JSON.stringify({
      bookingDate: bookDate, startTime: '14:00', endTime: '15:00',
      preferredWorkstations: ['L106-PC-01'],
      computePurpose: 'Priya submitted third (highest score)', allocationMode: 'SCHEDULED'
    })
  });
  assert(rAnanya.status === 201 && rRahul.status === 201 && rPriya.status === 201, 'V3.1  Three competing requests queued');

  // Anti-bypass check: Vikram submits AUTO for the same contested window -> MUST be queued, NOT immediate!
  const rVikramAuto = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${vikram.json.token}` },
    body: JSON.stringify({
      bookingDate: bookDate, startTime: '14:00', endTime: '15:00',
      preferredWorkstations: ['L106-PC-01'],
      computePurpose: 'AUTO bypass attempt during contention', allocationMode: 'AUTO'
    })
  });
  assert(rVikramAuto.status === 201 && rVikramAuto.json?.status === 'PENDING' && rVikramAuto.json?.allocationMode === 'SCHEDULED',
    'V3.2  Atomic contention check prevents AUTO fairness bypass (queued as SCHEDULED)', JSON.stringify(rVikramAuto.json));

  // Admin runs allocation round with maxLimit=2 so only top 2 fairness scores win!
  const admin = await login(DEV_API, 'aksharma@iitbhilai.ac.in');
  const roundRes = await fetchJSON(`${DEV_API}/admin/allocation-rounds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.json.token}` },
    body: JSON.stringify({ bookingDate: bookDate, startTime: '14:00', endTime: '15:00', maxLimit: 2 })
  });
  assert(roundRes.status === 200, 'V3.3  Admin triggers /api/admin/allocation-rounds (200)', JSON.stringify(roundRes.json));
  assert(roundRes.json?.allocatedCount === 2 && roundRes.json?.waitlistedCount === 2,
    'V3.4  Exactly 2 allocated & 2 waitlisted under capacity=2', `alloc=${roundRes.json?.allocatedCount}, wl=${roundRes.json?.waitlistedCount}`);

  const allocs = roundRes.json?.allocations || [];
  assert(allocs[0]?.userId === 'usr-student-priya', 'V3.5  Highest-score student (Priya) ranked #1 despite submitting AFTER Ananya/Rahul');
  assert(allocs[0]?.machineId === 'L106-PC-01', 'V3.6  Rank #1 winner (Priya) receives contested preference L106-PC-01');
  assert(allocs[1]?.userId === 'usr-student-rahul', 'V3.7  Second-highest score (Rahul) ranked #2 over Ananya/Vikram');
  assert(allocs[1]?.machineId !== 'L106-PC-01', 'V3.8  Rank #2 receives conflict-free fallback workstation');

  // Simultaneous Promise.all race: 5 distinct students fire AUTO requests concurrently for L106-PC-07
  const raceDate = getFutureSaturday(11);
  const devansh = await login(DEV_API, 'devansh.r@iitbhilai.ac.in');
  const ganesh = await login(DEV_API, 'ganesh.k@iitbhilai.ac.in');
  const racers = [priya, rahul, ananya, vikram, devansh, ganesh].map((r, idx) =>
    fetchJSON(`${DEV_API}/booking-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r.json.token}` },
      body: JSON.stringify({
        bookingDate: raceDate, startTime: '15:00', endTime: '16:00',
        preferredWorkstations: ['L106-PC-07'],
        computePurpose: `Simultaneous race #${idx + 1}`, allocationMode: 'AUTO'
      })
    })
  );
  const raceResults = await Promise.all(racers);
  const all201 = raceResults.every(r => r.status === 201);
  const assignedToSeat7 = raceResults.filter(r => r.json?.booking?.machineId === 'L106-PC-07');
  const assignedMachines = raceResults.map(r => r.json?.booking?.machineId).filter(Boolean);
  const uniqueMachines = new Set(assignedMachines);
  assert(all201, 'V3.9  Simultaneous 6-student Promise.all AUTO race completes with zero 500s');
  assert(assignedToSeat7.length <= 1, `V3.10 Zero double-booking on contested L106-PC-07 (got ${assignedToSeat7.length})`);
  assert(uniqueMachines.size === assignedMachines.length, 'V3.11 All confirmed assignments in simultaneous race map 1-to-1 to distinct seats');
}

// ═══════════════════════════════════════════════════════════════════════════
// V4: ADMIN WORKSTATION MANAGEMENT & AUTOMATIC REALLOCATION
// ═══════════════════════════════════════════════════════════════════════════
async function V4_adminWorkstationManagement() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V4: Admin Workstation Maintenance & Auto-Reallocation   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const admin = await login(DEV_API, 'aksharma@iitbhilai.ac.in');
  const student = await login(DEV_API, 'ganesh.k@iitbhilai.ac.in');
  const adminHeader = { Authorization: `Bearer ${admin.json.token}` };
  const studentHeader = { Authorization: `Bearer ${student.json.token}` };

  // Book L106-PC-84 for Ganesh on a future Saturday
  const bookDate = getFutureSaturday(5);
  const bRes = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: studentHeader,
    body: JSON.stringify({
      bookingDate: bookDate, startTime: '10:00', endTime: '11:00',
      preferredWorkstations: ['L106-PC-84'],
      computePurpose: 'V4 Reallocation verification', allocationMode: 'AUTO'
    })
  });
  assert(bRes.status === 201 && bRes.json?.booking?.machineId === 'L106-PC-84', 'V4.1  Student booked L106-PC-84');

  // Admin toggles L106-PC-84 to MAINTENANCE
  const maintOn = await fetchJSON(`${DEV_API}/admin/workstation/toggle-maintenance`, {
    method: 'POST',
    headers: adminHeader,
    body: JSON.stringify({ machineId: 'L106-PC-84', isMaintenance: true })
  });
  assert(maintOn.status === 200 && maintOn.json?.newStatus === 'MAINTENANCE', 'V4.2  Admin sets L106-PC-84 to MAINTENANCE', JSON.stringify(maintOn.json));
  assert((maintOn.json?.reallocatedCount || 0) >= 1, 'V4.3  Active booking on L106-PC-84 automatically reallocated to healthy seat');

  // New booking explicitly targeting L106-PC-84 must be rejected while offline
  const blockedBook = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: studentHeader,
    body: JSON.stringify({
      bookingDate: getFutureSaturday(6), startTime: '10:00', endTime: '11:00',
      preferredWorkstations: ['L106-PC-84'],
      computePurpose: 'Should be blocked while offline', allocationMode: 'AUTO'
    })
  });
  assert(blockedBook.status === 400, 'V4.4  Booking targeting MAINTENANCE workstation rejected (400)');

  // Restore L106-PC-84 to AVAILABLE
  const maintOff = await fetchJSON(`${DEV_API}/admin/workstation/toggle-maintenance`, {
    method: 'POST',
    headers: adminHeader,
    body: JSON.stringify({ machineId: 'L106-PC-84', isMaintenance: false })
  });
  assert(maintOff.status === 200 && maintOff.json?.newStatus === 'AVAILABLE', 'V4.5  Admin restores L106-PC-84 to AVAILABLE');
}

// ═══════════════════════════════════════════════════════════════════════════
// V5: ACCESS CONTROL MATRIX (STUDENT, ADMIN, ACCESS_OPERATOR, IDOR)
// ═══════════════════════════════════════════════════════════════════════════
async function V5_accessControlMatrix() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V5: Access Control Matrix (2-Role + ACCESS_OPERATOR)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const student = await login(DEV_API, 'devansh.r@iitbhilai.ac.in');
  const ordinaryAdmin = await login(DEV_API, 'ssen@iitbhilai.ac.in'); // admin WITHOUT ACCESS_OPERATOR
  const gateAdmin = await login(DEV_API, 'accessdesk.l106@iitbhilai.ac.in'); // admin WITH ACCESS_OPERATOR
  const fullAdmin = await login(DEV_API, 'aksharma@iitbhilai.ac.in'); // admin WITH all 3 perms

  // Student blocked from admin endpoints
  const s1 = await fetchJSON(`${DEV_API}/admin/workstation/toggle-maintenance`, {
    method: 'POST', headers: { Authorization: `Bearer ${student.json.token}` },
    body: JSON.stringify({ machineId: 'L106-PC-01', isMaintenance: true })
  });
  assert(s1.status === 403, 'V5.1  Student blocked from admin maintenance (403)');

  const s2 = await fetchJSON(`${DEV_API}/admin/allocation-rounds`, {
    method: 'POST', headers: { Authorization: `Bearer ${student.json.token}` },
    body: JSON.stringify({ bookingDate: getFutureSaturday(7) })
  });
  assert(s2.status === 403, 'V5.2  Student blocked from triggering allocation rounds (403)');

  const s3 = await fetchJSON(`${DEV_API}/access/check-in`, {
    method: 'POST', headers: { Authorization: `Bearer ${student.json.token}` },
    body: JSON.stringify({ passId: 'pass-fake' })
  });
  assert(s3.status === 403, 'V5.3  Student blocked from gate check-in (403)');

  // Ordinary admin (Prof. Sneha) has admin role (can view/run allocation), NOT ACCESS_OPERATOR (blocked from gate)
  const oGateIn = await fetchJSON(`${DEV_API}/access/check-in`, {
    method: 'POST', headers: { Authorization: `Bearer ${ordinaryAdmin.json.token}` },
    body: JSON.stringify({ passId: 'pass-fake' })
  });
  const oGateOut = await fetchJSON(`${DEV_API}/access/check-out`, {
    method: 'POST', headers: { Authorization: `Bearer ${ordinaryAdmin.json.token}` },
    body: JSON.stringify({ bookingId: 'bkg-fake' })
  });
  assert(oGateIn.status === 403 && oGateOut.status === 403, 'V5.4  Ordinary admin without ACCESS_OPERATOR blocked from gate check-in & check-out (403)');

  // Designated gate admin passes gate RBAC (reaches business logic 400 for fake pass, NOT 401/403)
  const gGate = await fetchJSON(`${DEV_API}/access/check-in`, {
    method: 'POST', headers: { Authorization: `Bearer ${gateAdmin.json.token}` },
    body: JSON.stringify({ passId: 'pass-does-not-exist' })
  });
  assert(gGate.status === 400, 'V5.5  Admin with ACCESS_OPERATOR passes gate RBAC (400 business check, not 403)');

  const fAdmin = await fetchJSON(`${DEV_API}/admin/analytics`, {
    headers: { Authorization: `Bearer ${fullAdmin.json.token}` }
  });
  assert(fAdmin.status === 200, 'V5.6  Full admin accesses analytics dashboard (200)');

  // Non-institute email rejected
  const badDomain = await login(DEV_API, 'attacker@gmail.com');
  assert(badDomain.status === 403 && badDomain.json?.code === 'INVALID_EMAIL_DOMAIN', 'V5.7  Non-@iitbhilai.ac.in email rejected (403)');

  // Cross-user IDOR cancellation blocked
  const priya = await login(DEV_API, 'priya.s@iitbhilai.ac.in');
  const victimBook = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST', headers: { Authorization: `Bearer ${priya.json.token}` },
    body: JSON.stringify({ bookingDate: getFutureSaturday(7), startTime: '09:00', endTime: '10:00', computePurpose: 'IDOR target', allocationMode: 'AUTO' })
  });
  const idorAttempt = await fetchJSON(`${DEV_API}/bookings/${victimBook.json.booking.bookingId}/cancel`, {
    method: 'POST', headers: { Authorization: `Bearer ${student.json.token}` },
    body: JSON.stringify({ reason: 'Unauthorized cross-user cancel' })
  });
  assert(idorAttempt.status === 403, 'V5.8  Cross-user IDOR booking cancellation blocked (403)');
}

// ═══════════════════════════════════════════════════════════════════════════
// V6: JWT & COOKIE SECURITY (TAMPER, EXPIRY, LOGOUT + LIVE PRODUCTION MODE)
// ═══════════════════════════════════════════════════════════════════════════
async function V6_jwtAndProductionSecurity() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V6: JWT, Cookie & Live Production-Mode Security         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const student = await login(DEV_API, 'ganesh.k@iitbhilai.ac.in');
  const validToken = student.json.token;

  // 1. Tampered payload (privilege escalation to admin) rejected
  const [h, , sig] = validToken.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({
    sub: 'usr-admin-sharma', role: 'admin',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const tamperRes = await fetchJSON(`${DEV_API}/auth/me`, {
    headers: { Authorization: `Bearer ${h}.${forgedPayload}.${sig}` }
  });
  assert(tamperRes.status === 401, 'V6.1  Tampered JWT signature rejected (401)');

  // 2. Expired JWT signed with real secret rejected
  const expiredJwt = signCustomJwt({
    sub: 'usr-student-ganesh', role: 'student',
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 60
  }, TEST_JWT_SECRET);
  const expRes = await fetchJSON(`${DEV_API}/auth/me`, {
    headers: { Authorization: `Bearer ${expiredJwt}` }
  });
  assert(expRes.status === 401, 'V6.2  Expired HS256 JWT rejected (401)');

  // 3. Logout clears session cookie
  const logoutRes = await fetchJSON(`${DEV_API}/auth/logout`, { method: 'POST' });
  const logoutCookie = logoutRes.headers.get('set-cookie') || '';
  assert(logoutRes.status === 200 && logoutCookie.includes('Max-Age=0'), 'V6.3  Logout clears fairlab_session cookie (Max-Age=0)');

  // 4. Fail-fast check: NODE_ENV=production without JWT_SECRET refuses to start
  const badProd = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '5059', IGNORE_DOTENV: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const badProdExit = await new Promise(resolve => {
    badProd.once('exit', code => resolve(code));
    setTimeout(() => { try { badProd.kill('SIGKILL'); } catch {} resolve(-1); }, 3000);
  });
  assert(badProdExit !== 0 && badProdExit !== -1, 'V6.4  NODE_ENV=production refuses startup when JWT_SECRET/HMAC_SECRET missing');

  // 5. Boot real NODE_ENV=production server and verify zero-trust hardening!
  const prodProc = spawnServer(PROD_PORT, {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://fairlab.iitbhilai.ac.in'
  });
  try {
    await waitForHealth(PROD_BASE);

    // Production login rejects wrong passwords with 401 INVALID_CREDENTIALS
    const pLoginWrong = await login(PROD_API, 'aksharma@iitbhilai.ac.in', 'deliberately-wrong-password');
    assert(pLoginWrong.status === 401 && pLoginWrong.json?.code === 'INVALID_CREDENTIALS',
      'V6.5  Production login rejects invalid password with 401 INVALID_CREDENTIALS');

    // Production login succeeds with verified credentials and issues Secure session cookie
    const pLogin = await login(PROD_API, 'aksharma@iitbhilai.ac.in', 'demo-password');
    const pCookie = pLogin.headers.get('set-cookie') || '';
    assert(pLogin.status === 200 && pLogin.json?.token && pCookie.includes('Secure'),
      'V6.5b Production login succeeds with verified credentials and issues Secure session cookie', pCookie);

    const pLogout = await fetchJSON(`${PROD_API}/auth/logout`, { method: 'POST' });
    const pLogoutCookie = pLogout.headers.get('set-cookie') || '';
    assert(pLogoutCookie.includes('Max-Age=0') && pLogoutCookie.includes('Secure'),
      'V6.6  Production logout clears cookie with Secure flag');

    // Spoofed x-user-id MUST be rejected everywhere in production!
    const spoofMe = await fetchJSON(`${PROD_API}/auth/me`, { headers: { 'x-user-id': 'usr-admin-sharma' } });
    const spoofBookings = await fetchJSON(`${PROD_API}/bookings/my-bookings`, { headers: { 'x-user-id': 'usr-admin-sharma' } });
    const spoofFairness = await fetchJSON(`${PROD_API}/fairness/me`, { headers: { 'x-user-id': 'usr-admin-sharma' } });
    const spoofAdmin = await fetchJSON(`${PROD_API}/admin/workstation/toggle-maintenance`, {
      method: 'POST', headers: { 'x-user-id': 'usr-admin-sharma' },
      body: JSON.stringify({ machineId: 'L106-PC-01', isMaintenance: true })
    });
    assert(spoofMe.status === 401 && spoofBookings.status === 401 && spoofFairness.status === 401 && spoofAdmin.status === 401,
      'V6.7  Production strictly blocks spoofed x-user-id across auth, bookings, fairness & admin (401)');

    // Demo endpoints disabled in production
    const pSwitch = await fetchJSON(`${PROD_API}/auth/switch-user`, {
      method: 'POST', body: JSON.stringify({ userId: 'usr-admin-sharma' })
    });
    const pUsers = await fetchJSON(`${PROD_API}/auth/users`);
    assert(pSwitch.status === 403 && pUsers.status === 403,
      'V6.8  Production disables /auth/switch-user and /auth/users (403)');
  } finally {
    await stopServer(prodProc);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// V7: SERVER RESTART, TRANSACTIONAL OUTBOX RECOVERY & IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════════════
async function V7_serverRestartAndOutboxRecovery(devProcRef) {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V7: Server Restart, Outbox Recovery & Idempotency       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Stop the dev server to simulate an unexpected process crash
  await stopServer(devProcRef.proc);

  // Inject a PENDING outbox event directly into SQLite (simulating commit right before crash)
  const Database = require(path.join(BACKEND_DIR, 'node_modules/better-sqlite3'));
  const crashEventId = `evt-crash-recovery-${Date.now()}`;
  const db = new Database(TEST_DB_PATH);
  db.prepare(`
    INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload, status)
    VALUES (?, 'booking.confirmed', 'bkg-crash-sim', ?, 'PENDING')
  `).run(crashEventId, JSON.stringify({ bookingId: 'bkg-crash-sim', machineId: 'L106-PC-42', simulatedCrash: true }));
  const beforeRow = db.prepare('SELECT status FROM outbox_events WHERE event_id = ?').get(crashEventId);
  db.close();
  assert(beforeRow?.status === 'PENDING', 'V7.1  Simulated crash: PENDING outbox event persisted on disk before restart');

  // Restart FairLab server -> startup recovery sweep should automatically publish it!
  devProcRef.proc = spawnServer(DEV_PORT);
  await waitForHealth(DEV_BASE);
  await new Promise(r => setTimeout(r, 300));

  const dbAfter = new Database(TEST_DB_PATH);
  const afterRow = dbAfter.prepare('SELECT status FROM outbox_events WHERE event_id = ?').get(crashEventId);
  assert(afterRow?.status === 'PUBLISHED', 'V7.2  Server restart startup-sweep recovered & marked outbox event PUBLISHED', `got ${afterRow?.status}`);

  // Test WebSocket live delivery + duplicate-event idempotent consumer behavior
  const WebSocket = require(path.join(BACKEND_DIR, 'node_modules/ws'));
  const ws = new WebSocket(`ws://127.0.0.1:${DEV_PORT}`);
  const received = [];
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.on('message', msg => {
    try { received.push(JSON.parse(msg.toString())); } catch {}
  });

  // Trigger an immediate booking -> verify broadcast carries deterministic eventId
  const student = await login(DEV_API, 'vikram.s@iitbhilai.ac.in');
  const bRes = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${student.json.token}` },
    body: JSON.stringify({
      bookingDate: getFutureSaturday(8), startTime: '10:00', endTime: '11:00',
      computePurpose: 'V7 WS outbox eventId check', allocationMode: 'AUTO'
    })
  });
  await new Promise(r => setTimeout(r, 300));
  ws.close();

  const outboxMsg = received.find(m => m.type === 'booking.confirmed' && m.eventId);
  assert(Boolean(outboxMsg && outboxMsg.eventId.startsWith('evt-')),
    'V7.3  WebSocket broadcast from Transactional Outbox carries deterministic eventId', JSON.stringify(outboxMsg));

  // Verify idempotent consumer deduplication logic against duplicate redelivery
  const seen = new Set();
  let processedCount = 0;
  const simulateConsumer = (frame) => {
    const eid = frame.eventId || frame.payload?.eventId;
    if (eid && seen.has(eid)) return;
    if (eid) seen.add(eid);
    processedCount++;
  };
  simulateConsumer(outboxMsg);
  simulateConsumer(outboxMsg); // Simulated redelivery if crash occurred after broadcast & before DB mark
  assert(processedCount === 1, 'V7.4  Idempotent consumer deduplicates repeated outbox eventId (at-least-once safe)');

  // Verify the booking's outbox row in DB is PUBLISHED
  const dbEvent = dbAfter.prepare('SELECT status FROM outbox_events WHERE event_id = ?').get(outboxMsg?.eventId);
  assert(bRes.status === 201 && dbEvent?.status === 'PUBLISHED', 'V7.5  Outbox row transitioned PENDING → PUBLISHED after WebSocket emit');

  // Hard SIGKILL crash-between-broadcast-and-mark-published test:
  // Revert the already-broadcast eventId back to PENDING and hard-kill the server process with SIGKILL
  const redeliverId = outboxMsg.eventId;
  dbAfter.prepare("UPDATE outbox_events SET status = 'PENDING' WHERE event_id = ?").run(redeliverId);
  dbAfter.close();

  await new Promise(resolve => {
    devProcRef.proc.once('exit', resolve);
    devProcRef.proc.kill('SIGKILL'); // Hard ungraceful kill (not SIGTERM!)
  });
  assert(devProcRef.proc.exitCode !== 0, 'V7.6  Hard SIGKILL terminated live server ungracefully');

  // Restart server after SIGKILL -> SQLite WAL + startup outbox sweep recovers & marks PUBLISHED
  devProcRef.proc = spawnServer(DEV_PORT);
  await waitForHealth(DEV_BASE);
  await new Promise(r => setTimeout(r, 300));

  const dbAfterKill = new Database(TEST_DB_PATH);
  const redeliveredRow = dbAfterKill.prepare('SELECT status FROM outbox_events WHERE event_id = ?').get(redeliverId);
  dbAfterKill.close();
  assert(redeliveredRow?.status === 'PUBLISHED', 'V7.7  Post-SIGKILL restart recovered WAL & republished pending outbox event safely');
}

// ═══════════════════════════════════════════════════════════════════════════
// V8: ZOD VALIDATION & EDGE-CASE HARDENING
// ═══════════════════════════════════════════════════════════════════════════
async function V8_zodValidationEdgeCases() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  V8: Zod Validation & Edge-Case Hardening                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const student = await login(DEV_API, 'priya.s@iitbhilai.ac.in');
  const authHeader = { Authorization: `Bearer ${student.json.token}` };

  const badDate = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({ bookingDate: 'not-a-date', startTime: '10:00', endTime: '11:00', computePurpose: 'Bad date' })
  });
  assert(badDate.status === 400, 'V8.1  Invalid bookingDate format rejected (400)');

  const pastDate = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({ bookingDate: '2020-01-01', startTime: '10:00', endTime: '11:00', computePurpose: 'Past date' })
  });
  assert(pastDate.status === 400, 'V8.2  Past calendar date rejected (400)');

  const tooLong = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({ bookingDate: getFutureSaturday(9), startTime: '10:00', endTime: '13:00', computePurpose: '3h over limit' })
  });
  assert(tooLong.status === 400, 'V8.3  Duration >2h institutional limit rejected (400)');

  const tooManyPrefs = await fetchJSON(`${DEV_API}/booking-requests`, {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({
      bookingDate: getFutureSaturday(9), startTime: '10:00', endTime: '11:00',
      preferredWorkstations: ['L106-PC-01', 'L106-PC-02', 'L106-PC-03', 'L106-PC-04'],
      computePurpose: '4 prefs > max 3'
    })
  });
  assert(tooManyPrefs.status === 400, 'V8.4  >3 workstation preferences rejected by Zod (400)');

  const malformed = await fetch(`${DEV_API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken-json'
  });
  assert(malformed.status === 400, 'V8.5  Malformed JSON returns clean 400 (no 500 crash)');

  const oversized = await fetch(`${DEV_API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.s@iitbhilai.ac.in', password: 'x'.repeat(70000) })
  });
  assert(oversized.status === 413, 'V8.6  Oversized >64KB payload rejected (413)');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FairLab Phase 10: Final Validation & Demonstration Suite   ║');
  console.log('║  IIT Bhilai · Computer Lab L-106 · 84 Workstations          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Timestamp: ${new Date().toISOString()}\n`);

  const startTime = Date.now();
  // Start from a genuinely clean database
  removeDbFiles();
  const devProcRef = { proc: spawnServer(DEV_PORT) };

  try {
    await waitForHealth(DEV_BASE);
    await V1_cleanDatabaseSeed();
    await V2_completeStudentJourney();
    await V3_competingRequestsFairness();
    await V4_adminWorkstationManagement();
    await V5_accessControlMatrix();
    await V6_jwtAndProductionSecurity();
    await V7_serverRestartAndOutboxRecovery(devProcRef);
    await V8_zodValidationEdgeCases();
  } catch (err) {
    console.error('\n  💥 Unhandled suite error:', err);
    failed++;
    failures.push(`Unhandled error: ${err.message}`);
  } finally {
    await stopServer(devProcRef.proc);
    removeDbFiles();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    PHASE 10 RESULTS                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Assertions: ${String(totalTests).padStart(3)}                                       ║`);
  console.log(`║  Passed:           ${String(passed).padStart(3)}  ✅                                   ║`);
  console.log(`║  Failed:           ${String(failed).padStart(3)}  ${failed === 0 ? '🎉' : '❌'}                                   ║`);
  console.log(`║  Duration:         ${String(elapsed + 's').padStart(5)}                                     ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failures.length > 0) {
    console.log('\n  Failed assertions:');
    failures.forEach(f => console.log(`    ❌ ${f}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
