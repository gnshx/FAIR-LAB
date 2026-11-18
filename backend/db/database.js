const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

function getDb() {
  if (!db) {
    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    initializeSchema(db);
  }
  return db;
}

function addColumnIfMissing(database, table, column, definition) {
  try {
    const tableInfo = database.prepare(`PRAGMA table_info(${table})`).all();
    const colNames = tableInfo.map(c => c.name);
    if (!colNames.includes(column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (e) {
    // Column migration safely handled
  }
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      roll_no TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'faculty', 'admin', 'watchman')),
      permissions TEXT NOT NULL DEFAULT '[]',
      department TEXT NOT NULL,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS semesters (
      semester_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'upcoming')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_fairness (
      fairness_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      semester_id TEXT NOT NULL REFERENCES semesters(semester_id) ON DELETE CASCADE,
      initial_score INTEGER NOT NULL DEFAULT 100,
      current_score INTEGER NOT NULL DEFAULT 100,
      booking_count INTEGER NOT NULL DEFAULT 0,
      total_hours_used REAL NOT NULL DEFAULT 0.0,
      high_demand_count INTEGER NOT NULL DEFAULT 0,
      high_demand_hours REAL NOT NULL DEFAULT 0.0,
      cumulative_wait_seconds INTEGER NOT NULL DEFAULT 0,
      penalty_points INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, semester_id)
    );

    CREATE TABLE IF NOT EXISTS labs (
      lab_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL,
      total_nodes INTEGER NOT NULL DEFAULT 84,
      active_nodes INTEGER NOT NULL DEFAULT 84
    );

    CREATE TABLE IF NOT EXISTS workstations (
      machine_id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL REFERENCES labs(lab_id),
      block_code TEXT NOT NULL DEFAULT 'A',
      row_num INTEGER NOT NULL DEFAULT 1,
      seat_num INTEGER NOT NULL DEFAULT 1,
      block_seat_num INTEGER NOT NULL DEFAULT 1,
      display_label TEXT,
      gpu_model TEXT NOT NULL,
      configured_gpu_model TEXT NOT NULL DEFAULT 'Lab L-106 Workstation',
      detected_gpu_model TEXT,
      telemetry_source TEXT NOT NULL DEFAULT 'SEEDED_DEFAULT' CHECK(telemetry_source IN ('NVIDIA_SMI', 'PROBE_TEST', 'SIMULATED', 'SEEDED_DEFAULT')),
      last_telemetry_at DATETIME,
      is_hardware_verified INTEGER NOT NULL DEFAULT 0,
      vram_gb REAL NOT NULL DEFAULT 12.0,
      ram_gb INTEGER NOT NULL DEFAULT 32,
      cpu_model TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('AVAILABLE', 'BOOKED', 'OCCUPIED', 'MAINTENANCE')) DEFAULT 'AVAILABLE',
      current_vram_used REAL NOT NULL DEFAULT 0.0,
      temperature_c REAL NOT NULL DEFAULT 42.0,
      active_job TEXT,
      current_user_id TEXT REFERENCES users(user_id)
    );

    CREATE TABLE IF NOT EXISTS lab_slots (
      slot_id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL REFERENCES labs(lab_id),
      slot_name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      capacity INTEGER NOT NULL DEFAULT 84,
      round_number INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS booking_requests (
      request_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      slot_id TEXT REFERENCES lab_slots(slot_id),
      booking_date TEXT NOT NULL DEFAULT (date('now')),
      start_time TEXT,
      end_time TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      preferred_machine_id TEXT REFERENCES workstations(machine_id),
      compute_purpose TEXT NOT NULL,
      research_field TEXT NOT NULL,
      priority_score_snapshot INTEGER NOT NULL,
      wait_time_seconds INTEGER NOT NULL DEFAULT 0,
      allocation_mode TEXT NOT NULL DEFAULT 'SCHEDULED',
      policy_version TEXT NOT NULL DEFAULT 'fairlab-v2',
      idempotency_key TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL CHECK(status IN ('QUEUED', 'ALLOCATED', 'REJECTED', 'CANCELLED')) DEFAULT 'QUEUED'
    );

    CREATE TABLE IF NOT EXISTS booking_preferences (
      request_id TEXT NOT NULL REFERENCES booking_requests(request_id) ON DELETE CASCADE,
      machine_id TEXT NOT NULL REFERENCES workstations(machine_id),
      preference_rank INTEGER NOT NULL CHECK(preference_rank BETWEEN 1 AND 3),
      PRIMARY KEY (request_id, machine_id),
      UNIQUE (request_id, preference_rank)
    );

    CREATE TABLE IF NOT EXISTS allocation_rounds (
      round_id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL REFERENCES labs(lab_id),
      slot_id TEXT,
      booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      demand_ratio REAL NOT NULL DEFAULT 0.0,
      demand_level TEXT NOT NULL DEFAULT 'NORMAL',
      eligible_requests INTEGER NOT NULL DEFAULT 0,
      allocated_count INTEGER NOT NULL DEFAULT 0,
      waitlisted_count INTEGER NOT NULL DEFAULT 0,
      policy_version TEXT NOT NULL DEFAULT 'fairlab-v2',
      policy_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      booking_id TEXT PRIMARY KEY,
      request_id TEXT REFERENCES booking_requests(request_id),
      user_id TEXT NOT NULL REFERENCES users(user_id),
      machine_id TEXT NOT NULL REFERENCES workstations(machine_id),
      slot_id TEXT REFERENCES lab_slots(slot_id),
      booking_date TEXT NOT NULL DEFAULT (date('now')),
      start_time TEXT,
      end_time TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      demand_level TEXT NOT NULL DEFAULT 'NORMAL' CHECK(demand_level IN ('NORMAL', 'HIGH_DEMAND')),
      demand_ratio REAL NOT NULL DEFAULT 0.0,
      priority_snapshot REAL,
      policy_version TEXT NOT NULL DEFAULT 'fairlab-v2',
      allocation_mode TEXT NOT NULL DEFAULT 'SCHEDULED',
      round_id TEXT REFERENCES allocation_rounds(round_id),
      semester_id TEXT NOT NULL REFERENCES semesters(semester_id),
      status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')) DEFAULT 'CONFIRMED',
      booked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS waitlist_entries (
      waitlist_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE REFERENCES booking_requests(request_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      slot_id TEXT REFERENCES lab_slots(slot_id),
      booking_date TEXT NOT NULL DEFAULT (date('now')),
      start_time TEXT,
      end_time TEXT,
      priority_score INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('WAITING', 'PROMOTED', 'EXPIRED', 'CANCELLED')) DEFAULT 'WAITING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS allocation_history (
      allocation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      semester_id TEXT NOT NULL REFERENCES semesters(semester_id),
      booking_id TEXT REFERENCES bookings(booking_id),
      machine_id TEXT,
      slot_id TEXT,
      demand_level TEXT NOT NULL DEFAULT 'NORMAL',
      demand_ratio REAL NOT NULL DEFAULT 0.0,
      duration_hours REAL NOT NULL DEFAULT 1.0,
      policy_version TEXT NOT NULL DEFAULT 'fairlab-v2',
      completed INTEGER NOT NULL DEFAULT 1,
      score_before INTEGER NOT NULL,
      score_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS access_passes (
      pass_id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(booking_id),
      user_id TEXT NOT NULL REFERENCES users(user_id),
      token_hash TEXT NOT NULL UNIQUE,
      signed_token TEXT NOT NULL,
      qr_payload TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('VALID', 'CHECKED_IN', 'USED', 'EXPIRED', 'REVOKED')) DEFAULT 'VALID',
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entry_logs (
      entry_id TEXT PRIMARY KEY,
      pass_id TEXT REFERENCES access_passes(pass_id),
      booking_id TEXT REFERENCES bookings(booking_id),
      user_id TEXT NOT NULL REFERENCES users(user_id),
      checked_by TEXT NOT NULL REFERENCES users(user_id),
      check_in_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      check_out_time DATETIME,
      gate_node TEXT NOT NULL DEFAULT 'Edge Node Alpha',
      status TEXT NOT NULL CHECK(status IN ('AUTHORIZED', 'DENIED', 'CHECKED_OUT')) DEFAULT 'AUTHORIZED',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      log_id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES users(user_id),
      actor_name TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL,
      ip_address TEXT DEFAULT '127.0.0.1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      notification_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS outbox_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK(status IN ('PENDING', 'PUBLISHED', 'FAILED')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS policy_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      policy_version TEXT NOT NULL DEFAULT 'fairlab-v2',
      base_score INTEGER NOT NULL DEFAULT 100,
      min_priority_floor INTEGER NOT NULL DEFAULT 10,
      deduction_per_booking INTEGER NOT NULL DEFAULT 10,
      deduction_per_hour REAL NOT NULL DEFAULT 5.0,
      high_demand_deduction_per_hour REAL NOT NULL DEFAULT 10.0,
      high_demand_threshold REAL NOT NULL DEFAULT 1.5,
      no_show_penalty INTEGER NOT NULL DEFAULT 25,
      cancellation_window_hours REAL NOT NULL DEFAULT 2.0,
      grace_period_minutes INTEGER NOT NULL DEFAULT 15,
      lab_open_time TEXT NOT NULL DEFAULT '09:00',
      lab_close_time TEXT NOT NULL DEFAULT '18:00',
      slot_interval_minutes INTEGER NOT NULL DEFAULT 60,
      min_duration_minutes INTEGER NOT NULL DEFAULT 30,
      max_duration_minutes INTEGER NOT NULL DEFAULT 120,
      cutoff_minutes_before_start INTEGER NOT NULL DEFAULT 15,
      max_preferences_per_request INTEGER NOT NULL DEFAULT 3,
      max_daily_hours REAL NOT NULL DEFAULT 2.0,
      max_daily_bookings INTEGER NOT NULL DEFAULT 2,
      require_ticket_release INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lab_timetable (
      entry_id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL DEFAULT 'lab-l106' REFERENCES labs(lab_id),
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      title TEXT NOT NULL,
      course_code TEXT DEFAULT '',
      instructor TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lab_date_overrides (
      override_id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL DEFAULT 'lab-l106' REFERENCES labs(lab_id),
      override_date TEXT NOT NULL UNIQUE,
      override_type TEXT NOT NULL CHECK(override_type IN ('HOLIDAY', 'EXTRA_DAY', 'CUSTOM_HOURS')),
      is_open INTEGER NOT NULL DEFAULT 0,
      open_time TEXT,
      close_time TEXT,
      ignore_timetable INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      created_by TEXT DEFAULT 'usr-admin-sharma',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_releases (
      release_id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL DEFAULT 'lab-l106' REFERENCES labs(lab_id),
      release_date TEXT NOT NULL,
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '18:00',
      title TEXT NOT NULL,
      total_tickets INTEGER NOT NULL DEFAULT 84,
      status TEXT NOT NULL DEFAULT 'RELEASED' CHECK(status IN ('DRAFT', 'RELEASED', 'PAUSED', 'CLOSED')),
      released_by TEXT DEFAULT 'usr-admin-sharma',
      released_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_workstations_lab ON workstations(lab_id, status);
    CREATE INDEX IF NOT EXISTS idx_workstations_block ON workstations(lab_id, block_code, row_num, seat_num);
    CREATE INDEX IF NOT EXISTS idx_workstations_label ON workstations(display_label);
    CREATE INDEX IF NOT EXISTS idx_student_fairness ON student_fairness(user_id, semester_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_date_slot ON bookings(booking_date, slot_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_machine_window ON bookings(machine_id, booking_date, start_time, end_time, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_user_window ON bookings(user_id, booking_date, start_time, end_time, status);
    CREATE INDEX IF NOT EXISTS idx_access_passes_token ON access_passes(token_hash);
    CREATE INDEX IF NOT EXISTS idx_requests_slot ON booking_requests(slot_id, status);
    CREATE INDEX IF NOT EXISTS idx_requests_window ON booking_requests(booking_date, start_time, end_time, status);
    CREATE INDEX IF NOT EXISTS idx_preferences_req ON booking_preferences(request_id, preference_rank);
    CREATE INDEX IF NOT EXISTS idx_waitlist_slot ON waitlist_entries(slot_id, booking_date, status);
    CREATE INDEX IF NOT EXISTS idx_timetable_lab_day ON lab_timetable(lab_id, day_of_week, is_active);
    CREATE INDEX IF NOT EXISTS idx_overrides_date ON lab_date_overrides(lab_id, override_date);
    CREATE INDEX IF NOT EXISTS idx_tickets_date ON ticket_releases(lab_id, release_date, status);
  `);

  // Non-destructive column migrations for existing databases
  addColumnIfMissing(database, 'users', 'permissions', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(database, 'student_fairness', 'total_hours_used', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing(database, 'student_fairness', 'high_demand_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'student_fairness', 'high_demand_hours', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing(database, 'student_fairness', 'cumulative_wait_seconds', 'INTEGER NOT NULL DEFAULT 0');

  addColumnIfMissing(database, 'workstations', 'block_code', "TEXT NOT NULL DEFAULT 'A'");
  addColumnIfMissing(database, 'workstations', 'row_num', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'workstations', 'seat_num', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'workstations', 'block_seat_num', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'workstations', 'display_label', 'TEXT');
  addColumnIfMissing(database, 'workstations', 'configured_gpu_model', "TEXT DEFAULT 'Lab L-106 Workstation'");
  addColumnIfMissing(database, 'workstations', 'detected_gpu_model', 'TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'workstations', 'telemetry_source', "TEXT DEFAULT 'SEEDED_DEFAULT'");
  addColumnIfMissing(database, 'workstations', 'last_telemetry_at', 'DATETIME DEFAULT NULL');
  addColumnIfMissing(database, 'workstations', 'is_hardware_verified', 'INTEGER DEFAULT 0');

  addColumnIfMissing(database, 'lab_slots', 'duration_minutes', 'INTEGER NOT NULL DEFAULT 60');

  addColumnIfMissing(database, 'booking_requests', 'booking_date', "TEXT NOT NULL DEFAULT '2026-11-18'");
  addColumnIfMissing(database, 'booking_requests', 'start_time', 'TEXT');
  addColumnIfMissing(database, 'booking_requests', 'end_time', 'TEXT');
  addColumnIfMissing(database, 'booking_requests', 'duration_minutes', 'INTEGER NOT NULL DEFAULT 60');
  addColumnIfMissing(database, 'booking_requests', 'allocation_mode', "TEXT NOT NULL DEFAULT 'SCHEDULED'");
  addColumnIfMissing(database, 'booking_requests', 'policy_version', "TEXT NOT NULL DEFAULT 'fairlab-v2'");
  addColumnIfMissing(database, 'booking_requests', 'idempotency_key', 'TEXT');

  addColumnIfMissing(database, 'bookings', 'booking_date', "TEXT NOT NULL DEFAULT '2026-11-18'");
  addColumnIfMissing(database, 'bookings', 'start_time', 'TEXT');
  addColumnIfMissing(database, 'bookings', 'end_time', 'TEXT');
  addColumnIfMissing(database, 'bookings', 'duration_minutes', 'INTEGER NOT NULL DEFAULT 60');
  addColumnIfMissing(database, 'bookings', 'demand_level', "TEXT NOT NULL DEFAULT 'NORMAL'");
  addColumnIfMissing(database, 'bookings', 'demand_ratio', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing(database, 'bookings', 'priority_snapshot', 'REAL');
  addColumnIfMissing(database, 'bookings', 'policy_version', "TEXT NOT NULL DEFAULT 'fairlab-v2'");
  addColumnIfMissing(database, 'bookings', 'allocation_mode', "TEXT NOT NULL DEFAULT 'SCHEDULED'");
  addColumnIfMissing(database, 'bookings', 'round_id', 'TEXT');

  addColumnIfMissing(database, 'waitlist_entries', 'start_time', 'TEXT');
  addColumnIfMissing(database, 'waitlist_entries', 'end_time', 'TEXT');

  addColumnIfMissing(database, 'allocation_history', 'machine_id', 'TEXT');
  addColumnIfMissing(database, 'allocation_history', 'slot_id', 'TEXT');
  addColumnIfMissing(database, 'allocation_history', 'demand_level', "TEXT NOT NULL DEFAULT 'NORMAL'");
  addColumnIfMissing(database, 'allocation_history', 'demand_ratio', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing(database, 'allocation_history', 'duration_hours', 'REAL NOT NULL DEFAULT 1.0');
  addColumnIfMissing(database, 'allocation_history', 'policy_version', "TEXT NOT NULL DEFAULT 'fairlab-v2'");
  addColumnIfMissing(database, 'allocation_history', 'completed', 'INTEGER NOT NULL DEFAULT 1');

  addColumnIfMissing(database, 'policy_config', 'policy_version', "TEXT NOT NULL DEFAULT 'fairlab-v2'");
  addColumnIfMissing(database, 'policy_config', 'min_priority_floor', 'INTEGER NOT NULL DEFAULT 10');
  addColumnIfMissing(database, 'policy_config', 'deduction_per_hour', 'REAL NOT NULL DEFAULT 5.0');
  addColumnIfMissing(database, 'policy_config', 'high_demand_deduction_per_hour', 'REAL NOT NULL DEFAULT 10.0');
  addColumnIfMissing(database, 'policy_config', 'high_demand_threshold', 'REAL NOT NULL DEFAULT 1.5');
  addColumnIfMissing(database, 'policy_config', 'lab_open_time', "TEXT NOT NULL DEFAULT '09:00'");
  addColumnIfMissing(database, 'policy_config', 'lab_close_time', "TEXT NOT NULL DEFAULT '18:00'");
  addColumnIfMissing(database, 'policy_config', 'slot_interval_minutes', 'INTEGER NOT NULL DEFAULT 60');
  addColumnIfMissing(database, 'policy_config', 'min_duration_minutes', 'INTEGER NOT NULL DEFAULT 30');
  addColumnIfMissing(database, 'policy_config', 'max_duration_minutes', 'INTEGER NOT NULL DEFAULT 120');
  addColumnIfMissing(database, 'policy_config', 'cutoff_minutes_before_start', 'INTEGER NOT NULL DEFAULT 15');
  addColumnIfMissing(database, 'policy_config', 'max_preferences_per_request', 'INTEGER NOT NULL DEFAULT 3');
  addColumnIfMissing(database, 'policy_config', 'max_daily_hours', 'REAL NOT NULL DEFAULT 2.0');
  addColumnIfMissing(database, 'policy_config', 'max_daily_bookings', 'INTEGER NOT NULL DEFAULT 2');
  addColumnIfMissing(database, 'policy_config', 'require_ticket_release', 'INTEGER NOT NULL DEFAULT 0');

  // Database-level invariants: partial unique indexes + SQLite half-open [start_time, end_time) overlap triggers
  try {
    database.exec(`DROP INDEX IF EXISTS idx_unique_active_workstation`);
    database.exec(`DROP INDEX IF EXISTS idx_unique_active_user_slot`);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_workstation
      ON bookings (machine_id, slot_id, booking_date)
      WHERE status IN ('CONFIRMED', 'CHECKED_IN') AND slot_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_user_slot
      ON bookings (user_id, slot_id, booking_date)
      WHERE status IN ('CONFIRMED', 'CHECKED_IN') AND slot_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_request_idempotency
      ON booking_requests (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);

    // Database-level half-open [start_time, end_time) overlap protection for arbitrary custom intervals
    database.exec(`DROP TRIGGER IF EXISTS trg_prevent_overlapping_machine_booking`);
    database.exec(`DROP TRIGGER IF EXISTS trg_prevent_overlapping_user_booking`);
    database.exec(`
      CREATE TRIGGER trg_prevent_overlapping_machine_booking
      BEFORE INSERT ON bookings
      WHEN NEW.status IN ('CONFIRMED', 'CHECKED_IN') AND NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'OVERLAP_CONFLICT: Workstation already booked for an overlapping time interval')
        WHERE EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.machine_id = NEW.machine_id
            AND b.booking_date = NEW.booking_date
            AND b.status IN ('CONFIRMED', 'CHECKED_IN')
            AND b.start_time IS NOT NULL
            AND b.end_time IS NOT NULL
            AND b.start_time < NEW.end_time
            AND NEW.start_time < b.end_time
        );
      END;

      CREATE TRIGGER trg_prevent_overlapping_user_booking
      BEFORE INSERT ON bookings
      WHEN NEW.status IN ('CONFIRMED', 'CHECKED_IN') AND NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'USER_OVERLAP_CONFLICT: Student already holds an overlapping booking on this date')
        WHERE EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.user_id = NEW.user_id
            AND b.booking_date = NEW.booking_date
            AND b.status IN ('CONFIRMED', 'CHECKED_IN')
            AND b.start_time IS NOT NULL
            AND b.end_time IS NOT NULL
            AND b.start_time < NEW.end_time
            AND NEW.start_time < b.end_time
        );
      END;
    `);
  } catch (e) {
    // Trigger/index setup safely handled
  }
}

module.exports = {
  getDb,
  initializeSchema
};
