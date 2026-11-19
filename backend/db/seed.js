const { getDb } = require('./database');
const crypto = require('crypto');
const config = require('../config');
const { hashPassword } = require('../middleware/auth');

function getTodayDateString(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
  } catch (e) {
    return date.toISOString().split('T')[0];
  }
}

function getCurrentTimeMinutes(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return hour * 60 + minute;
  } catch (e) {
    return date.getHours() * 60 + date.getMinutes();
  }
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = String(timeStr || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatMinutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime12h(time24) {
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
}

/**
 * Builds deterministic time slots between openTime and closeTime with intervalMinutes
 */
function generateSlotsFromSchedule(openTime = '09:00', closeTime = '18:00', intervalMinutes = 60) {
  const startMin = parseTimeToMinutes(openTime);
  const endMin = parseTimeToMinutes(closeTime);
  const step = Math.max(15, parseInt(intervalMinutes, 10) || 60);

  const slots = [];
  let round = 1;
  for (let cur = startMin; cur + step <= endMin; cur += step) {
    const sTime = formatMinutesToTime(cur);
    const eTime = formatMinutesToTime(cur + step);
    const label = cur < 12 * 60 ? 'Morning' : cur < 15 * 60 ? 'Midday' : 'Afternoon';
    slots.push({
      id: `slot-${round}`,
      name: `Interval ${round}: ${label} (${formatTime12h(sTime)} – ${formatTime12h(eTime)})`,
      start: sTime,
      end: eTime,
      durationMinutes: step,
      round
    });
    round++;
  }
  return slots;
}

/**
 * Generates the 84 physical workstations of IIT Bhilai Lab L-106:
 * - Block A: 6 rows × 10 systems = 60 workstations (L106-PC-01 .. L106-PC-60)
 * - Block B: 4 rows × 6 systems = 24 workstations (L106-PC-61 .. L106-PC-84)
 */
function buildWorkstationLayout() {
  const list = [];
  let globalIdx = 1;

  // Block A: 6 rows × 10 systems
  for (let row = 1; row <= 6; row++) {
    for (let seat = 1; seat <= 10; seat++) {
      const blockSeatNum = (row - 1) * 10 + seat;
      const machineId = `L106-PC-${String(globalIdx).padStart(2, '0')}`;
      const displayLabel = `A-R${row}-PC${String(seat).padStart(2, '0')}`;
      list.push({
        globalIdx,
        machineId,
        blockCode: 'A',
        rowNum: row,
        seatNum: seat,
        blockSeatNum,
        displayLabel
      });
      globalIdx++;
    }
  }

  // Block B: 4 rows × 6 systems
  for (let row = 1; row <= 4; row++) {
    for (let seat = 1; seat <= 6; seat++) {
      const blockSeatNum = (row - 1) * 6 + seat;
      const machineId = `L106-PC-${String(globalIdx).padStart(2, '0')}`;
      const displayLabel = `B-R${row}-PC${String(seat).padStart(2, '0')}`;
      list.push({
        globalIdx,
        machineId,
        blockCode: 'B',
        rowNum: row,
        seatNum: seat,
        blockSeatNum,
        displayLabel
      });
      globalIdx++;
    }
  }

  return list;
}

/**
 * Upgrades an existing 24-node database seamlessly to the 84-node Block A + Block B layout
 */
function ensureLayoutUpgraded(db) {
  const count = db.prepare("SELECT COUNT(*) as c FROM workstations WHERE lab_id = 'lab-l106'").get().c;
  const layout = buildWorkstationLayout();

  if (count < 84) {
    console.log(`[Seed] Upgrading Lab L-106 inventory from ${count} to 84 workstations (Block A 6x10 + Block B 4x6)...`);
    const upsert = db.prepare(`
      INSERT OR IGNORE INTO workstations (
        machine_id, lab_id, block_code, row_num, seat_num, block_seat_num, display_label,
        gpu_model, configured_gpu_model, vram_gb, ram_gb, cpu_model, status
      ) VALUES (?, 'lab-l106', ?, ?, ?, ?, ?, ?, ?, 12.0, 32, ?, ?)
    `);
    const updateMeta = db.prepare(`
      UPDATE workstations
      SET block_code = ?, row_num = ?, seat_num = ?, block_seat_num = ?, display_label = ?
      WHERE machine_id = ?
    `);

    const tx = db.transaction(() => {
      for (const item of layout) {
        const defaultStatus = (item.globalIdx === 4 || item.globalIdx === 68) ? 'MAINTENANCE' : 'AVAILABLE';
        upsert.run(
          item.machineId,
          item.blockCode,
          item.rowNum,
          item.seatNum,
          item.blockSeatNum,
          item.displayLabel,
          'Lab L-106 Workstation',
          'Lab L-106 Workstation',
          'Standard Lab Node',
          defaultStatus
        );
        updateMeta.run(
          item.blockCode,
          item.rowNum,
          item.seatNum,
          item.blockSeatNum,
          item.displayLabel,
          item.machineId
        );
      }
      db.prepare("UPDATE labs SET total_nodes = 84, active_nodes = 82 WHERE lab_id = 'lab-l106'").run();
    });
    tx();
  } else {
    // Ensure display_label & block metadata are populated
    const missingLabel = db.prepare("SELECT COUNT(*) as c FROM workstations WHERE display_label IS NULL").get().c;
    if (missingLabel > 0) {
      const updateMeta = db.prepare(`
        UPDATE workstations
        SET block_code = ?, row_num = ?, seat_num = ?, block_seat_num = ?, display_label = ?
        WHERE machine_id = ?
      `);
      const tx = db.transaction(() => {
        for (const item of layout) {
          updateMeta.run(item.blockCode, item.rowNum, item.seatNum, item.blockSeatNum, item.displayLabel, item.machineId);
        }
      });
      tx();
    }
  }
}

function ensureTodayBookingsSeeded(db) {
  const today = getTodayDateString();
  const count = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE booking_date = ?").get(today).c;
  if (count >= 100) return;

  const sem = db.prepare("SELECT semester_id FROM semesters WHERE status = 'active' LIMIT 1").get();
  if (!sem) return;
  const semId = sem.semester_id;

  const cohortUsers = db.prepare(`
    SELECT user_id FROM users
    WHERE role = 'student'
      AND user_id NOT LIKE 'usr-test-%'
      AND user_id NOT LIKE 'usr-conc-%'
      AND user_id NOT LIKE 'usr-e2e-%'
      AND user_id NOT LIKE 'usr-v2-%'
      AND user_id != 'usr-student-ganesh'
  `).all();
  if (!cohortUsers || cohortUsers.length === 0) return;
  const cohortIds = cohortUsers.map(u => u.user_id);

  const slots = [
    { id: 'slot-1', start: '09:00', end: '10:00', durationMinutes: 60 },
    { id: 'slot-2', start: '10:00', end: '11:00', durationMinutes: 60 },
    { id: 'slot-3', start: '11:00', end: '12:00', durationMinutes: 60 },
    { id: 'slot-4', start: '12:00', end: '13:00', durationMinutes: 60 },
    { id: 'slot-5', start: '13:00', end: '14:00', durationMinutes: 60 },
    { id: 'slot-6', start: '14:00', end: '15:00', durationMinutes: 60 },
    { id: 'slot-7', start: '15:00', end: '16:00', durationMinutes: 60 },
    { id: 'slot-8', start: '16:00', end: '17:00', durationMinutes: 60 },
    { id: 'slot-9', start: '17:00', end: '18:00', durationMinutes: 60 }
  ];

  const insertBooking = db.prepare(`
    INSERT OR IGNORE INTO bookings (
      booking_id, request_id, user_id, machine_id, slot_id, booking_date,
      start_time, end_time, duration_minutes, demand_level, demand_ratio,
      semester_id, status, booked_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const existingBookings = db.prepare("SELECT user_id, slot_id, machine_id, start_time, end_time FROM bookings WHERE booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN')").all(today);
  const usedUserSlots = new Set(existingBookings.map(b => `${b.user_id}:${b.slot_id}`));
  const usedMachineSlots = new Set(existingBookings.map(b => `${b.machine_id}:${b.slot_id}`));
  usedUserSlots.add('usr-student-ganesh:slot-3');

  let bSeq = 1;
  let cohortCursor = 0;

  function seedMachineSlots(machineId, slotNums, demandLevel = 'NORMAL') {
    for (const sNum of slotNums) {
      const sId = `slot-${sNum}`;
      if (usedMachineSlots.has(`${machineId}:${sId}`)) continue;
      const slotMeta = slots.find(s => s.id === sId) || { start: '09:00', end: '10:00', durationMinutes: 60 };
      let chosenUser = null;
      for (let tries = 0; tries < cohortIds.length; tries++) {
        const candidate = cohortIds[(cohortCursor + tries) % cohortIds.length];
        if (!usedUserSlots.has(`${candidate}:${sId}`)) {
          chosenUser = candidate;
          cohortCursor = (cohortCursor + tries + 1) % cohortIds.length;
          break;
        }
      }
      if (!chosenUser) continue;
      usedUserSlots.add(`${chosenUser}:${sId}`);
      usedMachineSlots.add(`${machineId}:${sId}`);
      const bid = `L106-SEED-${today.replace(/-/g, '')}-${String(bSeq++).padStart(4, '0')}`;
      insertBooking.run(
        bid, null, chosenUser, machineId, sId, today,
        slotMeta.start, slotMeta.end, slotMeta.durationMinutes,
        demandLevel, demandLevel === 'HIGH_DEMAND' ? 1.8 : 0.6,
        semId, 'CONFIRMED', `${today} 08:30:00`, `${today} 08:35:00`
      );
    }
  }

  const tx = db.transaction(() => {
    seedMachineSlots('L106-PC-01', [1, 2, 3, 4, 5, 6, 7, 8, 9], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-26', [1, 2, 3, 4, 5, 6, 7, 8, 9], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-62', [1, 2, 3, 4, 5, 6, 7, 8, 9], 'HIGH_DEMAND');

    seedMachineSlots('L106-PC-02', [1, 2, 3, 4, 5, 7, 8], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-05', [1, 2, 3, 4, 5, 7, 8], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-27', [1, 2, 3, 4, 6, 7, 8], 'NORMAL');
    seedMachineSlots('L106-PC-23', [1, 2, 3, 5, 6, 7, 9], 'NORMAL');
    seedMachineSlots('L106-PC-65', [1, 2, 3, 4, 5, 7, 8], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-71', [1, 2, 4, 5, 6, 7, 8], 'NORMAL');

    seedMachineSlots('L106-PC-06', [1, 2, 3, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-08', [2, 3, 4, 6, 8], 'NORMAL');
    seedMachineSlots('L106-PC-15', [1, 3, 5, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-21', [1, 2, 4, 6, 8], 'NORMAL');
    seedMachineSlots('L106-PC-32', [2, 3, 5, 6, 9], 'NORMAL');
    seedMachineSlots('L106-PC-41', [1, 2, 4, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-63', [1, 3, 5, 6, 8], 'NORMAL');
    seedMachineSlots('L106-PC-74', [2, 4, 5, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-80', [1, 2, 5, 6, 9], 'NORMAL');

    seedMachineSlots('L106-PC-07', [2, 6], 'NORMAL');
    seedMachineSlots('L106-PC-28', [3, 6], 'NORMAL');
    seedMachineSlots('L106-PC-18', [1, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-25', [2, 4], 'NORMAL');
    seedMachineSlots('L106-PC-35', [3, 6], 'NORMAL');
    seedMachineSlots('L106-PC-50', [1, 5], 'NORMAL');
    seedMachineSlots('L106-PC-61', [2, 6], 'NORMAL');
    seedMachineSlots('L106-PC-77', [3, 7], 'NORMAL');
  });
  tx();
  console.log(`[Seed] Seeded realistic workstation occupancy for today (${today}).`);
}

async function seedDatabase() {
  const db = getDb();

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) {
    ensureLayoutUpgraded(db);
    try {
      const defaultHash = hashPassword('demo');
      db.prepare('UPDATE users SET password_hash = ? WHERE password_hash IS NULL').run(defaultHash);
    } catch {}
    ensureTodayBookingsSeeded(db);
    console.log('[Seed] Database already populated (84 workstations verified).');
    return;
  }

  console.log('[Seed] Populating FairLab database with IIT Bhilai L-106 (84 systems: Block A 6x10 + Block B 4x6)...');

  const today = getTodayDateString();

  const insertUser = db.prepare(`
    INSERT INTO users (user_id, name, roll_no, email, role, permissions, department, avatar_url, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSemester = db.prepare(`
    INSERT INTO semesters (semester_id, name, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertFairness = db.prepare(`
    INSERT INTO student_fairness (
      fairness_id, user_id, semester_id, initial_score, current_score,
      booking_count, total_hours_used, high_demand_count, high_demand_hours,
      cumulative_wait_seconds, penalty_points
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLab = db.prepare(`
    INSERT INTO labs (lab_id, name, code, location, total_nodes, active_nodes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertWorkstation = db.prepare(`
    INSERT INTO workstations (
      machine_id, lab_id, block_code, row_num, seat_num, block_seat_num, display_label,
      gpu_model, configured_gpu_model, vram_gb, ram_gb, cpu_model, status, active_job, current_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSlot = db.prepare(`
    INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, duration_minutes, capacity, round_number, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBooking = db.prepare(`
    INSERT INTO bookings (
      booking_id, request_id, user_id, machine_id, slot_id, booking_date,
      start_time, end_time, duration_minutes, demand_level, demand_ratio,
      semester_id, status, booked_at, confirmed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPass = db.prepare(`
    INSERT INTO access_passes (pass_id, booking_id, user_id, token_hash, signed_token, qr_payload, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEntryLog = db.prepare(`
    INSERT INTO entry_logs (entry_id, pass_id, booking_id, user_id, checked_by, check_in_time, check_out_time, gate_node, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (log_id, actor_id, actor_name, role, action, target_type, target_id, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPolicy = db.prepare(`
    INSERT OR REPLACE INTO policy_config (
      id, base_score, min_priority_floor, deduction_per_booking,
      deduction_per_hour, high_demand_deduction_per_hour, high_demand_threshold,
      no_show_penalty, cancellation_window_hours, grace_period_minutes,
      lab_open_time, lab_close_time, slot_interval_minutes, min_duration_minutes,
      max_duration_minutes, max_daily_hours, max_daily_bookings, require_ticket_release
    )
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, 120, ?, ?, 0)
  `);

  const insertRequest = db.prepare(`
    INSERT INTO booking_requests (
      request_id, user_id, slot_id, booking_date, start_time, end_time, duration_minutes,
      preferred_machine_id, compute_purpose, research_field,
      priority_score_snapshot, wait_time_seconds, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertWaitlist = db.prepare(`
    INSERT INTO waitlist_entries (waitlist_id, request_id, user_id, slot_id, booking_date, priority_score, position, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')
  `);

  const insertAllocHistory = db.prepare(`
    INSERT INTO allocation_history (
      allocation_id, user_id, semester_id, booking_id, machine_id, slot_id,
      demand_level, demand_ratio, duration_hours, completed, score_before, score_after, reason
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    // 1. Configurable Policy: Lab open 09:00-18:00, 60-min intervals, 2h daily max, 5 pts/hr normal, 10 pts/hr high-demand
    insertPolicy.run(
      100,    // base_score
      10,     // min_priority_floor
      10,     // deduction_per_booking (legacy compat)
      5.0,    // deduction_per_hour (normal)
      0.0,    // high_demand_deduction_per_hour (developed & configurable, disabled by default)
      1.5,    // high_demand_threshold (DemandRatio)
      5,      // no_show_penalty (+5 pts)
      2.0,    // cancellation_window_hours
      15,     // grace_period_minutes
      '09:00',// lab_open_time
      '18:00',// lab_close_time
      60,     // slot_interval_minutes
      2.0,    // max_daily_hours
      2       // max_daily_bookings
    );

    // 2. Active Semester
    const semId = 'sem-autumn-2026';
    insertSemester.run(semId, 'Autumn 2026 Semester · Active Cycle', '2026-08-01', '2026-12-15', 'active');

    // 3. Lab L-106 (84 Workstations)
    const labId = 'lab-l106';
    insertLab.run(labId, 'Computer Lab L-106', 'L-106', 'Academic Block 1, Ground Floor', 84, 82);

    // 4. Configurable Daily Slots (09:00 to 18:00, 60-minute intervals = 9 slots)
    const slots = generateSlotsFromSchedule('09:00', '18:00', 60);
    for (const s of slots) {
      insertSlot.run(s.id, labId, s.name, s.start, s.end, s.durationMinutes, 84, s.round, 1);
    }

    // 4b. Monday–Friday Academic Lab Timetable (General IIT Bhilai Lab Classes)
    const insertTimetable = db.prepare(`
      INSERT OR IGNORE INTO lab_timetable (entry_id, lab_id, day_of_week, start_time, end_time, title, course_code, instructor, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const academicClasses = [
      ['tt-mon-cs201', 1, '14:00', '16:00', 'Data Structures & Algorithms Lab', 'CS201', 'Dr. A. K. Sharma'],
      ['tt-tue-cs305', 2, '14:00', '16:00', 'Machine Learning & GPU Lab', 'CS305', 'Prof. Sneha Sen'],
      ['tt-wed-ds204', 3, '15:00', '17:00', 'Statistical Computing Lab', 'DS204', 'Dr. R. Mishra'],
      ['tt-thu-cs302', 4, '14:00', '16:00', 'Computer Architecture Lab', 'CS302', 'Prof. V. Rao'],
      ['tt-fri-cs401', 5, '15:00', '17:00', 'Parallel CUDA Practicum', 'CS401', 'Dr. A. K. Sharma']
    ];
    for (const [id, dow, st, et, title, code, inst] of academicClasses) {
      insertTimetable.run(id, labId, dow, st, et, title, code, inst);
    }

    // 4c. Initial Ticket Releases (Today & Tomorrow open access drops)
    const insertTicketRelease = db.prepare(`
      INSERT OR IGNORE INTO ticket_releases (release_id, lab_id, release_date, start_time, end_time, title, total_tickets, status, released_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RELEASED', 'usr-admin-sharma')
    `);
    const todayIso = getTodayDateString();
    const tmrwDate = new Date(`${todayIso}T00:00:00Z`);
    tmrwDate.setUTCDate(tmrwDate.getUTCDate() + 1);
    const tomorrowIso = tmrwDate.toISOString().split('T')[0];
    insertTicketRelease.run(`rel-seed-${todayIso}`, labId, todayIso, '09:00', '18:00', 'Lab L-106 Daily Open Access Tickets', 84);
    insertTicketRelease.run(`rel-seed-${tomorrowIso}`, labId, tomorrowIso, '09:00', '18:00', 'Lab L-106 Advance Tickets', 84);

    // 5. Users (Primary Personas + Cohort Students for realistic map occupancy)
    const primaryUsers = [
      { id: 'usr-student-ganesh', name: 'Ganesh Kumar', roll: 'BT23CSE001', email: 'ganesh.k@iitbhilai.ac.in', role: 'student', dept: 'M.Tech Computer Science & Engineering', bookings: 2, totalHrs: 2.0, highCnt: 0, highHrs: 0.0, waitSec: 600, score: 90 },
      { id: 'usr-student-priya', name: 'Priya Sharma', roll: 'BT23CSE015', email: 'priya.s@iitbhilai.ac.in', role: 'student', dept: 'B.Tech Computer Science & Engineering', bookings: 0, totalHrs: 0.0, highCnt: 0, highHrs: 0.0, waitSec: 1800, score: 100 },
      { id: 'usr-student-rahul', name: 'Rahul Verma', roll: 'BT23CSE022', email: 'rahul.v@iitbhilai.ac.in', role: 'student', dept: 'Dual Degree (B.Tech + M.Tech CSE)', bookings: 3, totalHrs: 3.0, highCnt: 1, highHrs: 1.0, waitSec: 1540, score: 80 },
      { id: 'usr-student-ananya', name: 'Ananya Patel', roll: 'BT23CSE034', email: 'ananya.p@iitbhilai.ac.in', role: 'student', dept: 'PhD Scholar (Computer Science)', bookings: 4, totalHrs: 4.0, highCnt: 2, highHrs: 2.0, waitSec: 980, score: 70 },
      { id: 'usr-student-vikram', name: 'Vikram Singh', roll: 'BT23CSE045', email: 'vikram.s@iitbhilai.ac.in', role: 'student', dept: 'M.Tech Data Science & AI', bookings: 6, totalHrs: 7.0, highCnt: 3, highHrs: 3.0, waitSec: 600, score: 50 },
      { id: 'usr-student-devansh', name: 'Devansh Roy', roll: 'BT23CSE058', email: 'devansh.r@iitbhilai.ac.in', role: 'student', dept: 'B.Tech Electrical & CS', bookings: 8, totalHrs: 8.0, highCnt: 4, highHrs: 4.0, waitSec: 320, score: 40 },
      { id: 'usr-watchman-ram', name: 'Ram Singh (Gate Desk)', roll: 'EMP-SEC-104', email: 'accessdesk.l106@iitbhilai.ac.in', role: 'admin', permissions: ['ACCESS_OPERATOR'], dept: 'Lab L-106 Access Desk' },
      { id: 'usr-admin-sharma', name: 'Dr. A. K. Sharma', roll: 'EMP-FAC-012', email: 'aksharma@iitbhilai.ac.in', role: 'admin', permissions: ['POLICY_ADMIN', 'ALLOCATION_ADMIN', 'ACCESS_OPERATOR'], dept: 'Lab L-106 Faculty Coordinator' },
      { id: 'usr-faculty-sneha', name: 'Prof. Sneha Sen', roll: 'EMP-FAC-031', email: 'ssen@iitbhilai.ac.in', role: 'admin', permissions: ['ALLOCATION_ADMIN'], dept: 'Department of Computer Science' }
    ];

    // Add 30 additional cohort students to populate realistic bookings across Block A & B
    const cohortNames = [
      'Aarav Mehta', 'Isha Nair', 'Rohan Kulkarni', 'Neha Joshi', 'Kabir Das',
      'Meera Iyer', 'Siddharth Rao', 'Tanvi Deshmukh', 'Arjun Reddy', 'Kavya Menon',
      'Aditya Gupta', 'Shreya Banerjee', 'Nikhil Verma', 'Pooja Tiwari', 'Pranav Shah',
      'Riya Agarwal', 'Varun Saxena', 'Sneha Mishra', 'Harsh Patel', 'Diya Kapoor',
      'Manish Kumar', 'Nandini Bose', 'Karan Malhotra', 'Swati Pillai', 'Akash Yadav',
      'Bhavna Chawla', 'Deepak Chauhan', 'Gauri Kulkarni', 'Yashwant Singh', 'Ritika Jain'
    ];

    const demoHash = hashPassword('demo');
    for (const u of primaryUsers) {
      insertUser.run(u.id, u.name, u.roll, u.email, u.role, JSON.stringify(u.permissions || []), u.dept, null, demoHash);
      if (u.role === 'student') {
        insertFairness.run(
          `fair-${u.id}-${semId}`, u.id, semId, 100, u.score,
          u.bookings, u.totalHrs, u.highCnt, u.highHrs, u.waitSec, 0
        );
      }
    }

    const cohortIds = [];
    cohortNames.forEach((name, idx) => {
      const uid = `usr-cohort-${String(idx + 1).padStart(2, '0')}`;
      const roll = `BT24CSE${String(101 + idx)}`;
      const email = `cohort${idx + 1}@iitbhilai.ac.in`;
      const bookings = idx % 6;
      const highCnt = Math.floor(bookings / 2);
      const normalHrs = bookings - highCnt;
      const highHrs = highCnt;
      const score = Math.max(10, 100 - normalHrs * 5 - highHrs * 10);
      insertUser.run(uid, name, roll, email, 'student', '[]', 'B.Tech Computer Science & Engineering', null, demoHash);
      insertFairness.run(
        `fair-${uid}-${semId}`, uid, semId, 100, score,
        bookings, bookings, highCnt, highHrs, (idx % 5) * 300, 0
      );
      cohortIds.push(uid);
    });

    // 6. Seed 84 Workstations (Block A: 6x10=60, Block B: 4x6=24)
    const layout = buildWorkstationLayout();
    for (const item of layout) {
      let status = 'AVAILABLE';
      let activeJob = null;
      let currUser = null;

      if (item.globalIdx === 3) {
        status = 'BOOKED';
        currUser = 'usr-student-ganesh';
        activeJob = 'Reserved: 11:00 – 12:00';
      } else if (item.globalIdx === 4 || item.globalIdx === 68) {
        status = 'MAINTENANCE';
        activeJob = 'Hardware maintenance scheduled';
      }

      insertWorkstation.run(
        item.machineId,
        labId,
        item.blockCode,
        item.rowNum,
        item.seatNum,
        item.blockSeatNum,
        item.displayLabel,
        'Lab L-106 Workstation',
        'Lab L-106 Workstation',
        12.0,
        32,
        'Lab L-106 Compute Node',
        status,
        activeJob,
        currUser
      );
    }

    // 7. Confirmed Booking & Signed QR Pass for Ganesh Kumar on L106-PC-03 (slot-3: 11:00-12:00)
    const bookingId = 'L106-2026-00125';
    const requestId = 'req-ganesh-slot3';
    insertRequest.run(
      requestId, 'usr-student-ganesh', 'slot-3', today, '11:00', '12:00', 60,
      'L106-PC-03', 'Algorithmic Fairness & Distributed Systems Project',
      'Systems & Fairness', 90, 600, 'ALLOCATED'
    );
    insertBooking.run(
      bookingId, requestId, 'usr-student-ganesh', 'L106-PC-03', 'slot-3', today,
      '11:00', '12:00', 60, 'NORMAL', 0.45, semId, 'CONFIRMED', `${today} 08:45:00`, `${today} 08:50:00`
    );

    const payload = JSON.stringify({
      bookingId,
      rollNo: 'BT23CSE001',
      studentName: 'Ganesh Kumar',
      machineId: 'L106-PC-03',
      slot: '11:00 – 12:00',
      date: today,
      lab: 'L-106'
    });
    const tokenHash = crypto.createHmac('sha256', config.HMAC_SECRET).update(payload).digest('hex');
    const signedToken = `FAIRPASS:${bookingId}:${tokenHash.substring(0, 16)}`;

    // Pass expires far in the future of today's lab hours so watchman demo works all day
    const expiresAt = `${today} 23:59:59`;
    insertPass.run(
      'pass-2026-00125',
      bookingId,
      'usr-student-ganesh',
      tokenHash,
      signedToken,
      JSON.stringify({ token: signedToken, bookingId, rollNo: 'BT23CSE001', machineId: 'L106-PC-03', slot: '11:00 – 12:00', hash: tokenHash }),
      expiresAt,
      'VALID'
    );

    // 8. Seed realistic occupancy patterns across Block A & Block B for today (so seat map shows real Green/Yellow/Orange/Red states)
    // Helper to assign cohort bookings without violating unique (user_id, slot_id, booking_date) or (machine_id, slot_id, booking_date)
    const usedUserSlots = new Set([`usr-student-ganesh:slot-3`]);
    let bSeq = 1;
    let cohortCursor = 0;

    function seedMachineSlots(machineId, slotNums, demandLevel = 'NORMAL') {
      for (const sNum of slotNums) {
        const sId = `slot-${sNum}`;
        const slotMeta = slots.find(s => s.id === sId) || { start: '09:00', end: '10:00', durationMinutes: 60 };
        let chosenUser = null;
        for (let tries = 0; tries < cohortIds.length; tries++) {
          const candidate = cohortIds[(cohortCursor + tries) % cohortIds.length];
          if (!usedUserSlots.has(`${candidate}:${sId}`)) {
            chosenUser = candidate;
            cohortCursor = (cohortCursor + tries + 1) % cohortIds.length;
            break;
          }
        }
        if (!chosenUser) continue;
        usedUserSlots.add(`${chosenUser}:${sId}`);
        const bid = `L106-SEED-${String(bSeq++).padStart(4, '0')}`;
        insertBooking.run(
          bid, null, chosenUser, machineId, sId, today,
          slotMeta.start, slotMeta.end, slotMeta.durationMinutes,
          demandLevel, demandLevel === 'HIGH_DEMAND' ? 1.8 : 0.6,
          semId, 'CONFIRMED', `${today} 08:30:00`, `${today} 08:35:00`
        );
      }
    }

    // Fully Booked (100% — all 9 slots) machines: PC-01, PC-26, PC-62
    seedMachineSlots('L106-PC-01', [1, 2, 3, 4, 5, 6, 7, 8, 9], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-26', [1, 2, 3, 4, 5, 6, 7, 8, 9], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-62', [1, 2, 3, 4, 5, 6, 7, 8, 9], 'HIGH_DEMAND');

    // High Occupancy (71-99% — 7 of 9 slots = 78%, still FREE at 14:00 & 17:00!)
    seedMachineSlots('L106-PC-02', [1, 2, 3, 4, 5, 7, 8], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-05', [1, 2, 3, 4, 5, 7, 8], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-27', [1, 2, 3, 4, 6, 7, 8], 'NORMAL');
    seedMachineSlots('L106-PC-23', [1, 2, 3, 5, 6, 7, 9], 'NORMAL');
    seedMachineSlots('L106-PC-65', [1, 2, 3, 4, 5, 7, 8], 'HIGH_DEMAND');
    seedMachineSlots('L106-PC-71', [1, 2, 4, 5, 6, 7, 8], 'NORMAL');

    // Medium Occupancy (50-70% — 5 of 9 slots = 56%)
    seedMachineSlots('L106-PC-06', [1, 2, 3, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-08', [2, 3, 4, 6, 8], 'NORMAL');
    seedMachineSlots('L106-PC-15', [1, 3, 5, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-21', [1, 2, 4, 6, 8], 'NORMAL');
    seedMachineSlots('L106-PC-32', [2, 3, 5, 6, 9], 'NORMAL');
    seedMachineSlots('L106-PC-41', [1, 2, 4, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-63', [1, 3, 5, 6, 8], 'NORMAL');
    seedMachineSlots('L106-PC-74', [2, 4, 5, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-80', [1, 2, 5, 6, 9], 'NORMAL');

    // Low Occupancy (11-44% — 1-3 slots booked)
    seedMachineSlots('L106-PC-07', [2, 6], 'NORMAL');
    seedMachineSlots('L106-PC-28', [3, 6], 'NORMAL');
    seedMachineSlots('L106-PC-18', [1, 6, 7], 'NORMAL');
    seedMachineSlots('L106-PC-25', [2, 4], 'NORMAL');
    seedMachineSlots('L106-PC-35', [3, 6], 'NORMAL');
    seedMachineSlots('L106-PC-50', [1, 5], 'NORMAL');
    seedMachineSlots('L106-PC-61', [2, 6], 'NORMAL');
    seedMachineSlots('L106-PC-77', [3, 7], 'NORMAL');

    // 9. Queue sample requests for Slot 6 (14:00 - 15:00 Afternoon Peak) and Slot 4 (12:00 - 13:00)
    const queueSample = [
      { user: 'usr-student-priya', score: 100, wait: 1800, pref: 'L106-PC-05', purpose: 'Compiler Optimization Lab Assignment', field: 'Systems' },
      { user: 'usr-student-rahul', score: 80, wait: 1540, pref: 'L106-PC-05', purpose: 'Graph Algorithm Benchmarking', field: 'Algorithms' },
      { user: 'usr-student-ananya', score: 70, wait: 980, pref: 'L106-PC-61', purpose: 'Simulation Modeling & Analysis', field: 'AI / Machine Learning' },
      { user: 'usr-student-vikram', score: 50, wait: 600, pref: null, purpose: 'NLP Dataset Preprocessing', field: 'NLP' },
      { user: 'usr-student-devansh', score: 40, wait: 320, pref: null, purpose: 'Signal Processing Simulation', field: 'Signal Processing' }
    ];

    queueSample.forEach((q, idx) => {
      const rid = `req-slot4-${idx + 1}`;
      insertRequest.run(rid, q.user, 'slot-4', today, '12:00', '13:00', 60, q.pref, q.purpose, q.field, q.score, q.wait, 'QUEUED');
      insertWaitlist.run(`wl-slot4-${idx + 1}`, rid, q.user, 'slot-4', today, q.score, idx + 1);
    });

    // 10. Historical allocation history entries for Ganesh & cohort
    insertAllocHistory.run(
      'alloc-seed-1', 'usr-student-ganesh', semId, null, 'L106-PC-08', 'slot-2',
      'NORMAL', 0.65, 1.0, 100, 95, 'Completed 1.0h NORMAL session on L106-PC-08 (-5 pts)'
    );
    insertAllocHistory.run(
      'alloc-seed-2', 'usr-student-ganesh', semId, null, 'L106-PC-12', 'slot-3',
      'NORMAL', 0.80, 1.0, 95, 90, 'Completed 1.0h NORMAL session on L106-PC-12 (-5 pts)'
    );
    insertAllocHistory.run(
      'alloc-seed-3', 'usr-student-ananya', semId, null, 'L106-PC-02', 'slot-6',
      'HIGH_DEMAND', 2.15, 1.0, 80, 70, 'Completed 1.0h HIGH_DEMAND session on L106-PC-02 (-10 pts)'
    );

    // 11. Gate Activity Stream
    insertEntryLog.run(
      'entry-log-1', null, null, 'usr-student-rahul', 'usr-watchman-ram',
      `${today} 09:04:15`, `${today} 10:00:08`, 'Edge Node Alpha', 'CHECKED_OUT',
      'Session completed (1.0h NORMAL). -5 pts applied.'
    );
    insertEntryLog.run(
      'entry-log-2', null, null, 'usr-student-ananya', 'usr-watchman-ram',
      `${today} 10:02:40`, `${today} 11:00:12`, 'Edge Node Alpha', 'CHECKED_OUT',
      'Session completed (1.0h HIGH_DEMAND). -10 pts applied.'
    );

    // 12. Audit logs
    insertAuditLog.run(
      'audit-log-1', 'usr-admin-sharma', 'Dr. A. K. Sharma', 'admin',
      'POLICY_INITIALIZE', 'policy_config', '1',
      'Initialized Lab L-106 policy: 84 systems (Block A 6x10 + Block B 4x6), Hours 09:00-18:00, 60-min intervals, 2h daily limit, -5 pts/hr normal, -10 pts/hr high-demand.',
      '10.12.4.1'
    );
    insertAuditLog.run(
      'audit-log-2', 'usr-admin-sharma', 'Dr. A. K. Sharma', 'admin',
      'MAINTENANCE_TOGGLE', 'workstations', 'L106-PC-04',
      'Flagged L106-PC-04 (A-R1-04) under maintenance.',
      '10.12.4.1'
    );
    insertAuditLog.run(
      'audit-log-3', 'usr-admin-sharma', 'Dr. A. K. Sharma', 'admin',
      'MAINTENANCE_TOGGLE', 'workstations', 'L106-PC-68',
      'Flagged L106-PC-68 (B-R2-02) under maintenance.',
      '10.12.4.1'
    );
  });

  tx();
  console.log('[Seed] Seeding completed successfully (84 workstations, 9 configurable hourly slots 09:00-18:00)!');
}

module.exports = {
  seedDatabase,
  ensureTodayBookingsSeeded,
  generateSlotsFromSchedule,
  buildWorkstationLayout,
  ensureLayoutUpgraded,
  parseTimeToMinutes,
  formatMinutesToTime,
  getTodayDateString,
  getCurrentTimeMinutes
};
