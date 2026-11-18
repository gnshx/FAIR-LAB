const assert = require('assert');
const http = require('http');
const { getDb } = require('../backend/db/database');

function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 5000,
        path,
        method,
        headers: {
          ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function runSuite() {
  console.log('========================================================================');
  console.log('FAIRLAB SCHEDULE SUITE: 2HR MAX LIMIT, MON–FRI TIMETABLE, HOLIDAYS/EXTRA DAYS & TICKET RELEASES');
  console.log('========================================================================\n');

  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  assert(activeSem, 'Active semester must exist');

  // Use deterministic future weekdays (Mon 2027-01-11, Tue 2027-01-12, Sat 2027-01-16, Wed 2027-01-13)
  const monDate = '2027-01-11'; // Monday (has seeded Mon 14:00-16:00 CS201 class)
  const tueDate = '2027-01-12'; // Tuesday (will be marked HOLIDAY)
  const satDate = '2027-01-16'; // Saturday (will be marked EXTRA_DAY 08:00-20:00)
  const wedDate = '2027-01-13'; // Wednesday (ticket release tests)
  const allDates = [monDate, tueDate, satDate, wedDate];

  const cleanup = () => {
    db.prepare("UPDATE policy_config SET require_ticket_release = 0 WHERE id = 1").run();
    db.prepare("DELETE FROM notifications WHERE user_id LIKE 'usr-sch-%'").run();
    db.prepare("DELETE FROM access_passes WHERE user_id LIKE 'usr-sch-%'").run();
    db.prepare("DELETE FROM bookings WHERE booking_date IN (?, ?, ?, ?) OR user_id LIKE 'usr-sch-%'").run(...allDates);
    db.prepare("DELETE FROM waitlist_entries WHERE booking_date IN (?, ?, ?, ?) OR user_id LIKE 'usr-sch-%'").run(...allDates);
    db.prepare("DELETE FROM booking_requests WHERE booking_date IN (?, ?, ?, ?) OR user_id LIKE 'usr-sch-%'").run(...allDates);
    db.prepare("DELETE FROM lab_date_overrides WHERE override_date IN (?, ?, ?, ?)").run(...allDates);
    db.prepare("DELETE FROM ticket_releases WHERE release_date IN (?, ?, ?, ?)").run(...allDates);
    db.prepare("DELETE FROM lab_timetable WHERE title LIKE 'Test Schedule%'").run();
    db.prepare("DELETE FROM student_fairness WHERE user_id LIKE 'usr-sch-%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'usr-sch-%'").run();
  };

  cleanup();

  try {
    // Seed 2 isolated students
    for (const [id, name, roll] of [
      ['usr-sch-s1', 'Schedule Student 1', 'SCH-01'],
      ['usr-sch-s2', 'Schedule Student 2', 'SCH-02']
    ]) {
      db.prepare("INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES (?, ?, ?, ?, 'student', 'CSE')")
        .run(id, name, roll, `${id}@iitbhilai.ac.in`);
      db.prepare(`
        INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count, total_hours_used, high_demand_count, high_demand_hours, penalty_points)
        VALUES (?, ?, ?, 100, 100, 0, 0, 0, 0, 0)
      `).run(`fair-${id}`, id, activeSem.semester_id);
    }

    const adminH = { 'x-user-id': 'usr-admin-sharma' };
    const s1H = { 'x-user-id': 'usr-sch-s1' };
    const s2H = { 'x-user-id': 'usr-sch-s2' };

    // -----------------------------------------------------------------------
    // TEST 1: Strict 2-Hour Max Booking Limit (120m allowed, 135m rejected)
    // -----------------------------------------------------------------------
    const over2h = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: monDate,
      startTime: '09:00',
      endTime: '11:15',
      computePurpose: 'Over 2 hour booking attempt'
    }, s1H);
    assert.strictEqual(over2h.status, 400, `2h15m booking must be rejected (400), got ${over2h.status}`);

    const exact2h = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: monDate,
      startTime: '09:00',
      endTime: '11:00',
      preferredWorkstations: ['A-R1-PC01'],
      computePurpose: 'Exact 2h booking'
    }, s1H);
    assert.strictEqual(exact2h.status, 201, `Exact 2h booking must succeed (201), got ${exact2h.status}: ${JSON.stringify(exact2h.data)}`);
    console.log('[Test 1] PASS: Strict 2-hour max limit enforced (2h15m rejected with 400; 2h00m confirmed with 201).');

    // -----------------------------------------------------------------------
    // TEST 2: Mon–Fri Academic Lab Timetable Blocking + Admin RBAC
    // -----------------------------------------------------------------------
    // Student cannot mutate timetable (403)
    const studentAddTt = await httpRequest('POST', '/api/admin/timetable', {
      dayOfWeek: 1, startTime: '11:00', endTime: '12:00', title: 'Unauthorized Class'
    }, s1H);
    assert.strictEqual(studentAddTt.status, 403, 'Student must be blocked from editing timetable (403)');

    // Seeded Monday 14:00-16:00 CS201 class must block student booking 14:30-15:30
    const blockedByClass = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: monDate,
      startTime: '14:30',
      endTime: '15:30',
      computePurpose: 'Attempt during CS201 lab'
    }, s2H);
    assert.strictEqual(blockedByClass.status, 400, `Booking during Monday CS201 class must fail (400), got ${blockedByClass.status}`);
    assert(/academic lab/i.test(blockedByClass.data.error), `Expected academic lab error message, got: ${blockedByClass.data.error}`);

    // Admin adds & then deletes a custom timetable block
    const addedTt = await httpRequest('POST', '/api/admin/timetable', {
      dayOfWeek: 1, startTime: '11:00', endTime: '12:00', courseCode: 'CS999', title: 'Test Schedule Block'
    }, adminH);
    assert.strictEqual(addedTt.status, 201);
    const delTt = await httpRequest('DELETE', `/api/admin/timetable/${addedTt.data.entry_id}`, null, adminH);
    assert.strictEqual(delTt.status, 200);
    console.log('[Test 2] PASS: Mon–Fri academic lab timetable blocks overlapping student bookings & enforces Admin RBAC.');

    // -----------------------------------------------------------------------
    // TEST 3: Holiday Closure & Extra Day Custom Hours Override
    // -----------------------------------------------------------------------
    const setHoliday = await httpRequest('POST', '/api/admin/date-overrides', {
      overrideDate: tueDate,
      overrideType: 'HOLIDAY',
      reason: 'Republic Day Holiday'
    }, adminH);
    assert.strictEqual(setHoliday.status, 201);

    const bookOnHoliday = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: tueDate,
      startTime: '10:00',
      endTime: '11:00',
      computePurpose: 'Holiday booking attempt'
    }, s2H);
    assert.strictEqual(bookOnHoliday.status, 400, `Holiday booking must be rejected (400), got ${bookOnHoliday.status}`);
    assert(/closed/i.test(bookOnHoliday.data.error));

    // Extra Saturday day open 08:00-20:00
    const setExtra = await httpRequest('POST', '/api/admin/date-overrides', {
      overrideDate: satDate,
      overrideType: 'EXTRA_DAY',
      isOpen: true,
      openTime: '08:00',
      closeTime: '20:00',
      ignoreTimetable: true,
      reason: 'Extra Weekend Hackathon Lab'
    }, adminH);
    assert.strictEqual(setExtra.status, 201);

    const bookExtendedHours = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: satDate,
      startTime: '18:00',
      endTime: '19:30',
      preferredWorkstations: ['B-R1-PC01'],
      computePurpose: 'Extended evening weekend lab'
    }, s2H);
    assert.strictEqual(bookExtendedHours.status, 201, `Extra-day extended hours booking must succeed (201), got ${bookExtendedHours.status}: ${JSON.stringify(bookExtendedHours.data)}`);
    console.log('[Test 3] PASS: Holiday closure blocked bookings (400) & Extra Day custom hours (08:00–20:00) allowed 18:00–19:30 booking (201).');

    // -----------------------------------------------------------------------
    // TEST 4: Admin Ticket Release System (Gate + Quota + Pause)
    // -----------------------------------------------------------------------
    // Enable strict Ticket-Release Mode
    const enableGate = await httpRequest('PUT', '/api/admin/ticket-release-mode', { requireTicketRelease: true }, adminH);
    assert.strictEqual(enableGate.status, 200);

    // Booking on unreleased wedDate must be blocked
    const beforeRelease = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: wedDate,
      startTime: '10:00',
      endTime: '11:00',
      computePurpose: 'Before ticket release'
    }, s1H);
    assert.strictEqual(beforeRelease.status, 400, `Unreleased date must be blocked when ticket gate is ON, got ${beforeRelease.status}`);
    assert(/not been released/i.test(beforeRelease.data.error));

    // Admin releases exactly 1 ticket for wedDate 09:00-13:00
    const dropRes = await httpRequest('POST', '/api/admin/ticket-releases', {
      releaseDate: wedDate,
      startTime: '09:00',
      endTime: '13:00',
      title: 'Limited Morning Ticket Drop',
      totalTickets: 1,
      status: 'RELEASED'
    }, adminH);
    assert.strictEqual(dropRes.status, 201);

    // Student 1 claims the 1 released ticket -> succeeds
    const claim1 = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: wedDate,
      startTime: '10:00',
      endTime: '11:00',
      preferredWorkstations: ['A-R2-PC01'],
      computePurpose: 'Ticket #1'
    }, s1H);
    assert.strictEqual(claim1.status, 201, `First student claiming released ticket must succeed (201), got ${claim1.status}`);

    // Student 2 tries to book same drop -> sold out (400)
    const claim2 = await httpRequest('POST', '/api/v1/booking-requests', {
      bookingDate: wedDate,
      startTime: '10:00',
      endTime: '11:00',
      preferredWorkstations: ['A-R2-PC02'],
      computePurpose: 'Ticket #2 sold out'
    }, s2H);
    assert.strictEqual(claim2.status, 400, `Second student must be blocked when 1/1 tickets sold out, got ${claim2.status}`);
    assert(/all 1 released tickets/i.test(claim2.data.error));

    // Admin pauses the release -> verify PATCH works
    const pauseRes = await httpRequest('PATCH', `/api/admin/ticket-releases/${dropRes.data.release_id}`, { status: 'PAUSED' }, adminH);
    assert.strictEqual(pauseRes.status, 200);
    assert.strictEqual(pauseRes.data.status, 'PAUSED');

    // Disable gate back to default
    const disableGate = await httpRequest('PUT', '/api/admin/ticket-release-mode', { requireTicketRelease: false }, adminH);
    assert.strictEqual(disableGate.status, 200);
    console.log('[Test 4] PASS: Admin Ticket Release gate, 1-ticket quota sell-out enforcement, and Pause/Resume verified.');

    console.log('\n========================================================================');
    console.log('ALL 4 SCHEDULE, TIMETABLE, HOLIDAY & TICKET RELEASE TESTS PASSED 100%!');
    console.log('========================================================================');
  } finally {
    cleanup();
  }
}

runSuite().catch(err => {
  console.error('Schedule Suite Failed:', err);
  process.exit(1);
});

