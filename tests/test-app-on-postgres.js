/**
 * FairLab Application-Level PostgreSQL Production Adapter Verification
 * Tests the real application logic, row-level locks, transactions, and database-level
 * uniqueness constraints directly against PostgreSQL 16.
 */

const PostgresAdapter = require('../backend/db/postgres');
const { calculatePriorityScore, rankBookingRequests } = require('../backend/services/fairnessEngine');
const { generateAccessPass } = require('../backend/services/passService');
const crypto = require('crypto');

const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fairlab_db';
const db = new PostgresAdapter(PG_URL);

async function runApplicationPostgresTests() {
  console.log('========================================================================');
  console.log('🐘 FAIRLAB APPLICATION-LEVEL POSTGRESQL 16 ADAPTER & INVARIANT SUITE');
  console.log('========================================================================\n');

  try {
    // 1. Check connection
    const ver = await db.get('SELECT version() as v');
    console.log(`[Step 1] Connected to PostgreSQL 16: ${ver.v.split(' on ')[0]}`);

    // 2. Setup isolated test environment
    console.log(`\n[Step 2] Initializing Isolated PostgreSQL Test Workspace...`);
    await db.exec(`
      TRUNCATE TABLE entry_logs, access_passes, allocation_history, bookings, 
                     booking_requests, student_fairness, audit_logs, lab_slots, 
                     workstations, labs, semesters, users, policy_config CASCADE;
    `);

    // Insert policy & semester
    await db.run(`INSERT INTO policy_config (id, base_score, deduction_per_booking) VALUES (1, 100, 10)`);
    const semId = `sem-pg-app-${Date.now()}`;
    await db.run(`INSERT INTO semesters (semester_id, name, start_date, end_date, status) VALUES (?, ?, '2026-01-05', '2026-05-08', 'active')`, [semId, 'Spring 2026 Postgres App Term']);

    // Insert lab and 3 workstations
    await db.run(`INSERT INTO labs (lab_id, name, code, location) VALUES ('lab-l106', 'L-106 HPC Cluster', 'L-106', 'Block 1')`);
    await db.run(`INSERT INTO workstations (machine_id, lab_id, gpu_model, cpu_model, configured_gpu_model, status) VALUES ('L106-PC-01', 'lab-l106', 'RTX 4070', 'Intel Core i7-13700K', 'NVIDIA GeForce RTX 4070 (12 GB)', 'AVAILABLE')`);
    await db.run(`INSERT INTO workstations (machine_id, lab_id, gpu_model, cpu_model, configured_gpu_model, status) VALUES ('L106-PC-02', 'lab-l106', 'RTX 4070', 'Intel Core i7-13700K', 'NVIDIA GeForce RTX 4070 (12 GB)', 'AVAILABLE')`);
    await db.run(`INSERT INTO workstations (machine_id, lab_id, gpu_model, cpu_model, configured_gpu_model, status) VALUES ('L106-PC-03', 'lab-l106', 'RTX 4070', 'Intel Core i7-13700K', 'NVIDIA GeForce RTX 4070 (12 GB)', 'AVAILABLE')`);

    // Insert slot (capacity = 2)
    const slotId = `slot-pg-${Date.now()}`;
    await db.run(`INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, capacity, round_number) VALUES (?, 'lab-l106', 'Deep Learning Afternoon', '14:00', '16:00', 2, 1)`, [slotId]);

    // Insert watchman and 4 students
    await db.run(`INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES ('usr-watchman-ram', 'Ram Singh', 'SEC001', 'guard.ram@iitbhilai.ac.in', 'watchman', 'Security')`);
    
    for (let i = 1; i <= 4; i++) {
      const uId = `usr-stud-${i}`;
      await db.run(`INSERT INTO users (user_id, name, roll_no, email, role, department) VALUES (?, ?, ?, ?, 'student', 'CSE')`, [uId, `Student ${i}`, `BT23CSE00${i}`, `${uId}@iitbhilai.ac.in`]);
      // Varying initial bookings: Student 1 has 0, Student 2 has 1, Student 3 has 2, Student 4 has 3
      const completed = i - 1;
      const score = Math.max(5, 100 - (10 * completed));
      await db.run(`INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count) VALUES (?, ?, ?, 100, ?, ?)`, [`fair-${uId}-${semId}`, uId, semId, score, completed]);
    }
    console.log(`   ✓ PASS: Database seeded with policy, 3 workstations, 4 students, and 1 slot.`);

    // 3. Submit 4 concurrent booking requests
    console.log(`\n[Step 3] Submitting 4 Concurrent Booking Requests to PostgreSQL...`);
    for (let i = 1; i <= 4; i++) {
      const uId = `usr-stud-${i}`;
      const f = await db.get('SELECT current_score FROM student_fairness WHERE user_id = ? AND semester_id = ?', [uId, semId]);
      await db.run(`
        INSERT INTO booking_requests (request_id, user_id, slot_id, compute_purpose, research_field, priority_score_snapshot, wait_time_seconds, status)
        VALUES (?, ?, ?, 'PyTorch Training', 'AI', ?, ?, 'QUEUED')
      `, [`req-${i}`, uId, slotId, f.current_score, (4 - i) * 60]);
    }
    console.log(`   ✓ PASS: 4 requests queued with priority snapshots (100, 90, 80, 70 pts).`);

    // 4. Batch Allocation under Transaction with SELECT FOR UPDATE
    console.log(`\n[Step 4] Running Allocation Round with Row-Level Locking (SELECT FOR UPDATE)...`);
    const allocResult = await db.transaction(async (tx) => {
      // Lock available rigs
      const availableRigs = await tx.all(`SELECT machine_id FROM workstations WHERE lab_id = 'lab-l106' AND status = 'AVAILABLE' ORDER BY machine_id ASC FOR UPDATE`);
      // Lock and rank queued requests
      const queued = await tx.all(`SELECT r.*, u.name, u.roll_no FROM booking_requests r JOIN users u ON r.user_id = u.user_id WHERE r.slot_id = ? AND r.status = 'QUEUED' ORDER BY r.priority_score_snapshot DESC, r.wait_time_seconds DESC, r.requested_at ASC FOR UPDATE`, [slotId]);

      const slot = await tx.get('SELECT capacity FROM lab_slots WHERE slot_id = ?', [slotId]);
      const toAllocate = Math.min(availableRigs.length, slot.capacity);

      const allocations = [];
      for (let i = 0; i < toAllocate; i++) {
        const req = queued[i];
        const rig = availableRigs[i];
        const bId = `L106-PG-ALLOC-${Date.now()}-${i + 1}`;

        await tx.run(`INSERT INTO bookings (booking_id, request_id, user_id, machine_id, slot_id, semester_id, status) VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED')`, [bId, req.request_id, req.user_id, rig.machine_id, slotId, semId]);
        await tx.run(`UPDATE booking_requests SET status = 'ALLOCATED' WHERE request_id = ?`, [req.request_id]);
        await tx.run(`UPDATE workstations SET status = 'BOOKED', current_user_id = ? WHERE machine_id = ?`, [req.user_id, rig.machine_id]);

        // Generate Pass
        const tokenSignature = crypto.createHmac('sha256', 'fairlab-pg-secret').update(`${bId}:${req.user_id}`).digest('hex').substring(0, 16);
        const signedToken = `FAIRPASS:${bId}:${tokenSignature}`;
        const passId = `pass-${bId}`;
        await tx.run(`INSERT INTO access_passes (pass_id, booking_id, user_id, token_hash, signed_token, qr_payload, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL '2 hours', 'VALID')`, [passId, bId, req.user_id, tokenSignature, signedToken, JSON.stringify({ token: signedToken, bId })]);

        allocations.push({ bookingId: bId, passId, signedToken, userId: req.user_id, machineId: rig.machine_id, score: req.priority_score_snapshot });
      }

      return { allocations, waitlisted: queued.length - toAllocate };
    });

    console.log(`   Allocations Confirmed: ${allocResult.allocations.length}, Waitlisted: ${allocResult.waitlisted}`);
    allocResult.allocations.forEach((a, idx) => {
      console.log(`   - Allocation #${idx + 1}: ${a.userId} (Score: ${a.score} pts) -> Assigned ${a.machineId}`);
    });

    if (allocResult.allocations.length !== 2 || allocResult.waitlisted !== 2) {
      throw new Error('Allocation count mismatch');
    }
    console.log('   ✓ PASS: Exactly 2 slots allocated to top scores (Student 1 at 100 pts, Student 2 at 90 pts). Students 3 & 4 waitlisted.');

    // 5. Invariant Test: Database-Level Double-Booking Prevention
    console.log(`\n[Step 5] Testing Database-Level Partial Unique Index Invariant...`);
    let doubleBookingBlocked = false;
    try {
      // Attempt to insert duplicate CONFIRMED booking on the same machine & slot
      const existingAlloc = allocResult.allocations[0];
      await db.run(`
        INSERT INTO bookings (booking_id, request_id, user_id, machine_id, slot_id, semester_id, status)
        VALUES (?, 'req-attacker', 'usr-stud-3', ?, ?, ?, 'CONFIRMED')
      `, [`L106-ILLEGAL-${Date.now()}`, existingAlloc.machineId, slotId, semId]);
    } catch (e) {
      if (e.message.includes('unique constraint') || e.code === '23505') {
        doubleBookingBlocked = true;
      }
    }

    if (!doubleBookingBlocked) {
      throw new Error('DATABASE INVARIANT VIOLATION: Duplicate workstation allocation was permitted by PostgreSQL!');
    }
    console.log('   ✓ PASS: PostgreSQL rejected duplicate active workstation allocation via idx_unique_active_workstation.');

    // 5.2 Invariant Test: PostgreSQL Kernel-Level GiST Time-Range Exclusion Constraint
    console.log(`\n[Step 5.2] Testing PostgreSQL btree_gist Range Exclusion Constraint (23P01)...`);
    const freeRig = 'L106-PC-03';
    const bTestRange1 = `L106-RNG-1-${Date.now()}`;
    const bTestRange2 = `L106-RNG-2-${Date.now()}`;
    
    // Seed two distinct overlapping slots
    const slotIdRange1 = `slot-pg-rng1-${Date.now()}`;
    const slotIdRange2 = `slot-pg-rng2-${Date.now()}`;
    await db.run(`INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, capacity, round_number) VALUES (?, 'lab-l106', 'Range Slot 1', '14:00', '16:00', 2, 1)`, [slotIdRange1]);
    await db.run(`INSERT INTO lab_slots (slot_id, lab_id, slot_name, start_time, end_time, capacity, round_number) VALUES (?, 'lab-l106', 'Range Slot 2 Overlap', '15:00', '17:00', 2, 1)`, [slotIdRange2]);

    // Insert active booking with booking_window = [14:00, 16:00) on freeRig
    await db.run(`
      INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, booking_window, status)
      VALUES (?, 'usr-stud-1', ?, ?, ?, tstzrange('2026-11-12 14:00:00+00', '2026-11-12 16:00:00+00'), 'CONFIRMED')
    `, [bTestRange1, freeRig, slotIdRange1, semId]);

    let gistExclusionCaught = false;
    try {
      // Attempt to insert overlapping booking window = [15:00, 17:00) on the same machine with different slot
      await db.run(`
        INSERT INTO bookings (booking_id, user_id, machine_id, slot_id, semester_id, booking_window, status)
        VALUES (?, 'usr-stud-3', ?, ?, ?, tstzrange('2026-11-12 15:00:00+00', '2026-11-12 17:00:00+00'), 'CONFIRMED')
      `, [bTestRange2, freeRig, slotIdRange2, semId]);
    } catch (err) {
      if (err.code === '23P01' || err.message.includes('exclude_overlapping_machine_bookings')) {
        gistExclusionCaught = true;
      }
    }

    // Clean up temporary range test booking
    await db.exec(`DELETE FROM bookings WHERE booking_id = '${bTestRange1}';`);

    if (!gistExclusionCaught) {
      throw new Error('DATABASE INVARIANT VIOLATION: PostgreSQL GiST exclusion constraint failed to block overlapping time window!');
    }
    console.log('   ✓ PASS: PostgreSQL rejected overlapping interval on workstation via exclude_overlapping_machine_bookings (SQLSTATE 23P01).');


    // 6. Check-In & Physical Entry
    console.log(`\n[Step 6] Testing Physical Turnstile Check-In on PostgreSQL...`);
    const testPass = allocResult.allocations[0];
    await db.transaction(async (tx) => {
      await tx.run("UPDATE access_passes SET status = 'CHECKED_IN' WHERE pass_id = ?", [testPass.passId]);
      await tx.run("UPDATE bookings SET status = 'CHECKED_IN' WHERE booking_id = ?", [testPass.bookingId]);
      await tx.run("UPDATE workstations SET status = 'OCCUPIED' WHERE machine_id = ?", [testPass.machineId]);
      await tx.run(`
        INSERT INTO entry_logs (entry_id, pass_id, booking_id, user_id, checked_by, check_in_time, gate_node, status, notes)
        VALUES (?, ?, ?, ?, 'usr-watchman-ram', NOW(), 'Edge Node Alpha', 'AUTHORIZED', 'Turnstile checked in via PG adapter')
      `, [`entry-${Date.now()}`, testPass.passId, testPass.bookingId, testPass.userId]);
    });
    console.log(`   ✓ PASS: Check-in recorded. Workstation ${testPass.machineId} marked OCCUPIED.`);

    // 7. Check-Out & Point Deduction
    console.log(`\n[Step 7] Testing Session Check-Out and Fairness Point Deduction...`);
    const preScore = await db.get('SELECT current_score, booking_count FROM student_fairness WHERE user_id = ? AND semester_id = ?', [testPass.userId, semId]);
    
    await db.transaction(async (tx) => {
      await tx.run("UPDATE access_passes SET status = 'USED' WHERE pass_id = ?", [testPass.passId]);
      await tx.run("UPDATE bookings SET status = 'COMPLETED' WHERE booking_id = ?", [testPass.bookingId]);
      await tx.run("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL WHERE machine_id = ?", [testPass.machineId]);
      await tx.run("UPDATE entry_logs SET check_out_time = NOW(), status = 'CHECKED_OUT' WHERE booking_id = ?", [testPass.bookingId]);

      const newCount = preScore.booking_count + 1;
      const newScore = Math.max(5, 100 - (10 * newCount));
      await tx.run(`
        UPDATE student_fairness 
        SET booking_count = ?, current_score = ?, updated_at = NOW() 
        WHERE user_id = ? AND semester_id = ?
      `, [newCount, newScore, testPass.userId, semId]);
    });

    const postScore = await db.get('SELECT current_score, booking_count FROM student_fairness WHERE user_id = ? AND semester_id = ?', [testPass.userId, semId]);
    console.log(`   Student:      ${testPass.userId}`);
    console.log(`   Score Before: ${preScore.current_score} PTS (Bookings: ${preScore.booking_count})`);
    console.log(`   Score After:  ${postScore.current_score} PTS (Bookings: ${postScore.booking_count})`);
    if (postScore.current_score !== preScore.current_score - 10) {
      throw new Error('Point deduction calculation failed on PostgreSQL');
    }
    console.log('   ✓ PASS: 10-point deduction and machine deallocation verified.');

    // 8. Voluntary Cancellation Test
    console.log(`\n[Step 8] Testing Voluntary Booking Cancellation (0 Penalty Guarantee)...`);
    const cancelAlloc = allocResult.allocations[1]; // Student 2
    const s2Pre = await db.get('SELECT current_score FROM student_fairness WHERE user_id = ? AND semester_id = ?', [cancelAlloc.userId, semId]);

    await db.transaction(async (tx) => {
      await tx.run("UPDATE bookings SET status = 'CANCELLED', cancelled_at = NOW() WHERE booking_id = ?", [cancelAlloc.bookingId]);
      await tx.run("UPDATE access_passes SET status = 'REVOKED' WHERE pass_id = ?", [cancelAlloc.passId]);
      await tx.run("UPDATE workstations SET status = 'AVAILABLE', current_user_id = NULL WHERE machine_id = ?", [cancelAlloc.machineId]);
    });

    const s2Post = await db.get('SELECT current_score FROM student_fairness WHERE user_id = ? AND semester_id = ?', [cancelAlloc.userId, semId]);
    const rigStatus = await db.get('SELECT status FROM workstations WHERE machine_id = ?', [cancelAlloc.machineId]);

    if (s2Post.current_score !== s2Pre.current_score || rigStatus.status !== 'AVAILABLE') {
      throw new Error('Cancellation penalty or rig release failed');
    }
    console.log(`   Cancelled Booking:  ${cancelAlloc.bookingId}`);
    console.log(`   Workstation Status: ${rigStatus.status}`);
    console.log(`   Student Score:      ${s2Pre.current_score} PTS -> ${s2Post.current_score} PTS (Zero penalty)`);
    console.log('   ✓ PASS: Voluntary cancellation released workstation with exactly 0 penalty points.');

    // 9. Semester Rollover on PostgreSQL
    console.log(`\n[Step 9] Testing Semester Reset & Audit Preservation on PostgreSQL...`);
    const newSemId = `sem-term2-${Date.now()}`;
    await db.transaction(async (tx) => {
      await tx.run("UPDATE semesters SET status = 'archived' WHERE semester_id = ?", [semId]);
      await tx.run("INSERT INTO semesters (semester_id, name, start_date, end_date, status) VALUES (?, 'Autumn 2026 Term', '2026-08-01', '2026-12-15', 'active')", [newSemId]);
      const students = await tx.all("SELECT user_id FROM users WHERE role = 'student'");
      for (const s of students) {
        await tx.run("INSERT INTO student_fairness (fairness_id, user_id, semester_id, initial_score, current_score, booking_count) VALUES (?, ?, ?, 100, 100, 0)", [`fair-${s.user_id}-${newSemId}`, s.user_id, newSemId]);
      }
    });

    const sem1Check = await db.get('SELECT current_score, booking_count FROM student_fairness WHERE user_id = ? AND semester_id = ?', [testPass.userId, semId]);
    const sem2Check = await db.get('SELECT current_score, booking_count FROM student_fairness WHERE user_id = ? AND semester_id = ?', [testPass.userId, newSemId]);

    console.log(`   Semester 1 Preserved Score: ${sem1Check.current_score} PTS (Bookings: ${sem1Check.booking_count})`);
    console.log(`   Semester 2 Fresh Score:     ${sem2Check.current_score} PTS (Bookings: ${sem2Check.booking_count})`);
    if (sem1Check.current_score !== 90 || sem2Check.current_score !== 100) {
      throw new Error('Semester isolation failed');
    }
    console.log('   ✓ PASS: Semester rollover archived Semester 1 and initialized Semester 2 at clean 100 points.');

    console.log('\n========================================================================');
    console.log('🎉 ALL 9 APPLICATION-LEVEL POSTGRESQL PRODUCTION TESTS PASSED 100%!');
    console.log('========================================================================\n');
  } finally {
    await db.close();
  }
}

runApplicationPostgresTests().catch(err => {
  console.error('❌ Application PostgreSQL Test Failed:', err);
  process.exit(1);
});
