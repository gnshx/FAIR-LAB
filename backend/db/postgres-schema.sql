-- FairLab PostgreSQL Schema for IIT Bhilai L-106 Cluster (84 Workstations: Block A 6x10 + Block B 4x6)
-- Production PostgreSQL 16 Schema with Row-Level Locking, Range Exclusions & Foreign Key Cascades

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  roll_no VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(128) UNIQUE NOT NULL,
  role VARCHAR(32) NOT NULL CHECK(role IN ('student', 'faculty', 'admin', 'watchman')),
  department VARCHAR(128) NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS semesters (
  semester_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL CHECK(status IN ('active', 'archived', 'upcoming')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_fairness (
  fairness_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(semester_id) ON DELETE CASCADE,
  initial_score INT NOT NULL DEFAULT 100,
  current_score INT NOT NULL DEFAULT 100,
  booking_count INT NOT NULL DEFAULT 0,
  total_hours_used NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
  high_demand_count INT NOT NULL DEFAULT 0,
  high_demand_hours NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
  cumulative_wait_seconds INT NOT NULL DEFAULT 0,
  penalty_points INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, semester_id)
);

CREATE TABLE IF NOT EXISTS labs (
  lab_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(32) NOT NULL UNIQUE,
  location VARCHAR(128) NOT NULL,
  total_nodes INT NOT NULL DEFAULT 84,
  active_nodes INT NOT NULL DEFAULT 84
);

CREATE TABLE IF NOT EXISTS workstations (
  machine_id VARCHAR(64) PRIMARY KEY,
  lab_id VARCHAR(64) NOT NULL REFERENCES labs(lab_id),
  block_code VARCHAR(8) NOT NULL DEFAULT 'A',
  row_num INT NOT NULL DEFAULT 1,
  seat_num INT NOT NULL DEFAULT 1,
  block_seat_num INT NOT NULL DEFAULT 1,
  display_label VARCHAR(32),
  gpu_model VARCHAR(128) NOT NULL,
  configured_gpu_model VARCHAR(128) NOT NULL DEFAULT 'Lab L-106 Workstation',
  detected_gpu_model VARCHAR(128),
  telemetry_source VARCHAR(32) NOT NULL DEFAULT 'SEEDED_DEFAULT' CHECK(telemetry_source IN ('NVIDIA_SMI', 'PROBE_TEST', 'SIMULATED', 'SEEDED_DEFAULT')),
  last_telemetry_at TIMESTAMPTZ,
  is_hardware_verified BOOLEAN NOT NULL DEFAULT FALSE,
  vram_gb NUMERIC(4, 1) NOT NULL DEFAULT 12.0,
  ram_gb INT NOT NULL DEFAULT 32,
  cpu_model VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK(status IN ('AVAILABLE', 'BOOKED', 'OCCUPIED', 'MAINTENANCE')) DEFAULT 'AVAILABLE',
  current_vram_used NUMERIC(4, 1) NOT NULL DEFAULT 0.0,
  temperature_c NUMERIC(4, 1) NOT NULL DEFAULT 42.0,
  active_job TEXT,
  current_user_id VARCHAR(64) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS lab_slots (
  slot_id VARCHAR(64) PRIMARY KEY,
  lab_id VARCHAR(64) NOT NULL REFERENCES labs(lab_id),
  slot_name VARCHAR(128) NOT NULL,
  start_time VARCHAR(16) NOT NULL,
  end_time VARCHAR(16) NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  capacity INT NOT NULL DEFAULT 84,
  round_number INT NOT NULL DEFAULT 1,
  is_active INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS booking_requests (
  request_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  slot_id VARCHAR(64) REFERENCES lab_slots(slot_id),
  booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time VARCHAR(16),
  end_time VARCHAR(16),
  duration_minutes INT NOT NULL DEFAULT 60,
  preferred_machine_id VARCHAR(64) REFERENCES workstations(machine_id),
  compute_purpose TEXT NOT NULL,
  research_field VARCHAR(128) NOT NULL,
  priority_score_snapshot INT NOT NULL,
  wait_time_seconds INT NOT NULL DEFAULT 0,
  allocation_mode VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  policy_version VARCHAR(32) NOT NULL DEFAULT 'fairlab-v2',
  idempotency_key VARCHAR(128),
  requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(32) NOT NULL CHECK(status IN ('QUEUED', 'ALLOCATED', 'REJECTED', 'CANCELLED')) DEFAULT 'QUEUED'
);

CREATE TABLE IF NOT EXISTS booking_preferences (
  request_id VARCHAR(64) NOT NULL REFERENCES booking_requests(request_id) ON DELETE CASCADE,
  machine_id VARCHAR(64) NOT NULL REFERENCES workstations(machine_id),
  preference_rank SMALLINT NOT NULL CHECK(preference_rank BETWEEN 1 AND 3),
  PRIMARY KEY (request_id, machine_id),
  UNIQUE (request_id, preference_rank)
);

CREATE TABLE IF NOT EXISTS allocation_rounds (
  round_id VARCHAR(64) PRIMARY KEY,
  lab_id VARCHAR(64) NOT NULL REFERENCES labs(lab_id),
  slot_id VARCHAR(64),
  booking_date DATE NOT NULL,
  start_time VARCHAR(16) NOT NULL,
  end_time VARCHAR(16) NOT NULL,
  demand_ratio NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  demand_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  eligible_requests INT NOT NULL DEFAULT 0,
  allocated_count INT NOT NULL DEFAULT 0,
  waitlisted_count INT NOT NULL DEFAULT 0,
  policy_version VARCHAR(32) NOT NULL DEFAULT 'fairlab-v2',
  policy_snapshot TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  booking_id VARCHAR(64) PRIMARY KEY,
  request_id VARCHAR(64) REFERENCES booking_requests(request_id),
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  machine_id VARCHAR(64) NOT NULL REFERENCES workstations(machine_id),
  slot_id VARCHAR(64) REFERENCES lab_slots(slot_id),
  booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time VARCHAR(16),
  end_time VARCHAR(16),
  duration_minutes INT NOT NULL DEFAULT 60,
  demand_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK(demand_level IN ('NORMAL', 'HIGH_DEMAND')),
  demand_ratio NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  priority_snapshot NUMERIC(8, 2),
  policy_version VARCHAR(32) NOT NULL DEFAULT 'fairlab-v2',
  allocation_mode VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  round_id VARCHAR(64) REFERENCES allocation_rounds(round_id),
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(semester_id),
  booking_window TSTZRANGE,
  status VARCHAR(32) NOT NULL CHECK(status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')) DEFAULT 'CONFIRMED',
  booked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  waitlist_id VARCHAR(64) PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL UNIQUE REFERENCES booking_requests(request_id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  slot_id VARCHAR(64) NOT NULL REFERENCES lab_slots(slot_id),
  booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
  priority_score INT NOT NULL,
  position INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL CHECK(status IN ('WAITING', 'PROMOTED', 'EXPIRED', 'CANCELLED')) DEFAULT 'WAITING',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS allocation_history (
  allocation_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(semester_id),
  booking_id VARCHAR(64) REFERENCES bookings(booking_id),
  machine_id VARCHAR(64),
  slot_id VARCHAR(64),
  demand_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  demand_ratio NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  duration_hours NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
  completed BOOLEAN NOT NULL DEFAULT TRUE,
  score_before INT NOT NULL,
  score_after INT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_passes (
  pass_id VARCHAR(64) PRIMARY KEY,
  booking_id VARCHAR(64) NOT NULL UNIQUE REFERENCES bookings(booking_id),
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  signed_token VARCHAR(256) NOT NULL,
  qr_payload TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL CHECK(status IN ('VALID', 'CHECKED_IN', 'USED', 'EXPIRED', 'REVOKED')) DEFAULT 'VALID',
  issued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entry_logs (
  entry_id VARCHAR(64) PRIMARY KEY,
  pass_id VARCHAR(64) REFERENCES access_passes(pass_id),
  booking_id VARCHAR(64) REFERENCES bookings(booking_id),
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  checked_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  check_out_time TIMESTAMPTZ,
  gate_node VARCHAR(64) NOT NULL DEFAULT 'Edge Node Alpha',
  status VARCHAR(32) NOT NULL CHECK(status IN ('AUTHORIZED', 'DENIED', 'CHECKED_OUT')) DEFAULT 'AUTHORIZED',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id VARCHAR(64) PRIMARY KEY,
  actor_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
  actor_name VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  details TEXT NOT NULL,
  ip_address VARCHAR(45) DEFAULT '127.0.0.1',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id VARCHAR(64) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED' CHECK(status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policy_config (
  id INT PRIMARY KEY CHECK (id = 1),
  base_score INT NOT NULL DEFAULT 100,
  min_priority_floor INT NOT NULL DEFAULT 10,
  deduction_per_booking INT NOT NULL DEFAULT 10,
  deduction_per_hour NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
  high_demand_deduction_per_hour NUMERIC(5, 2) NOT NULL DEFAULT 10.0,
  high_demand_threshold NUMERIC(5, 2) NOT NULL DEFAULT 1.5,
  no_show_penalty INT NOT NULL DEFAULT 25,
  cancellation_window_hours NUMERIC(4, 1) NOT NULL DEFAULT 2.0,
  grace_period_minutes INT NOT NULL DEFAULT 15,
  lab_open_time VARCHAR(8) NOT NULL DEFAULT '09:00',
  lab_close_time VARCHAR(8) NOT NULL DEFAULT '18:00',
  slot_interval_minutes INT NOT NULL DEFAULT 60,
  max_daily_hours NUMERIC(4, 1) NOT NULL DEFAULT 2.0,
  max_daily_bookings INT NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Non-destructive migrations for existing PostgreSQL tables
ALTER TABLE student_fairness ADD COLUMN IF NOT EXISTS total_hours_used NUMERIC(8, 2) NOT NULL DEFAULT 0.0;
ALTER TABLE student_fairness ADD COLUMN IF NOT EXISTS high_demand_count INT NOT NULL DEFAULT 0;
ALTER TABLE student_fairness ADD COLUMN IF NOT EXISTS high_demand_hours NUMERIC(8, 2) NOT NULL DEFAULT 0.0;
ALTER TABLE student_fairness ADD COLUMN IF NOT EXISTS cumulative_wait_seconds INT NOT NULL DEFAULT 0;

ALTER TABLE workstations ADD COLUMN IF NOT EXISTS block_code VARCHAR(8) NOT NULL DEFAULT 'A';
ALTER TABLE workstations ADD COLUMN IF NOT EXISTS row_num INT NOT NULL DEFAULT 1;
ALTER TABLE workstations ADD COLUMN IF NOT EXISTS seat_num INT NOT NULL DEFAULT 1;
ALTER TABLE workstations ADD COLUMN IF NOT EXISTS block_seat_num INT NOT NULL DEFAULT 1;
ALTER TABLE workstations ADD COLUMN IF NOT EXISTS display_label VARCHAR(32);

ALTER TABLE lab_slots ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 60;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 60;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 60;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS demand_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS demand_ratio NUMERIC(6, 2) NOT NULL DEFAULT 0.0;

ALTER TABLE allocation_history ADD COLUMN IF NOT EXISTS machine_id VARCHAR(64);
ALTER TABLE allocation_history ADD COLUMN IF NOT EXISTS slot_id VARCHAR(64);
ALTER TABLE allocation_history ADD COLUMN IF NOT EXISTS demand_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE allocation_history ADD COLUMN IF NOT EXISTS demand_ratio NUMERIC(6, 2) NOT NULL DEFAULT 0.0;
ALTER TABLE allocation_history ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(6, 2) NOT NULL DEFAULT 1.0;
ALTER TABLE allocation_history ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS min_priority_floor INT NOT NULL DEFAULT 10;
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS deduction_per_hour NUMERIC(5, 2) NOT NULL DEFAULT 5.0;
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS high_demand_deduction_per_hour NUMERIC(5, 2) NOT NULL DEFAULT 10.0;
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS high_demand_threshold NUMERIC(5, 2) NOT NULL DEFAULT 1.5;
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS lab_open_time VARCHAR(8) NOT NULL DEFAULT '09:00';
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS lab_close_time VARCHAR(8) NOT NULL DEFAULT '18:00';
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS slot_interval_minutes INT NOT NULL DEFAULT 60;
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS max_daily_hours NUMERIC(4, 1) NOT NULL DEFAULT 2.0;
ALTER TABLE policy_config ADD COLUMN IF NOT EXISTS max_daily_bookings INT NOT NULL DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_workstations_lab_pg ON workstations(lab_id, status);
CREATE INDEX IF NOT EXISTS idx_workstations_block_pg ON workstations(lab_id, block_code, row_num, seat_num);
CREATE INDEX IF NOT EXISTS idx_student_fairness_pg ON student_fairness(user_id, semester_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_pg ON bookings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_date_slot_pg ON bookings(booking_date, slot_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_machine_date_pg ON bookings(machine_id, booking_date, status);
CREATE INDEX IF NOT EXISTS idx_access_passes_token_pg ON access_passes(token_hash);
CREATE INDEX IF NOT EXISTS idx_requests_slot_pg ON booking_requests(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_slot_pg ON waitlist_entries(slot_id, booking_date, status);

-- Database-Level Invariants to prevent double-booking
DROP INDEX IF EXISTS idx_unique_active_workstation;
DROP INDEX IF EXISTS idx_unique_active_user_slot;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_workstation ON bookings (machine_id, slot_id, booking_date) WHERE status IN ('CONFIRMED', 'CHECKED_IN');
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_user_slot ON bookings (user_id, slot_id, booking_date) WHERE status IN ('CONFIRMED', 'CHECKED_IN');
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_request_idempotency_pg ON booking_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- PostgreSQL 16 Kernel-Level Half-Open Range Exclusion Constraints:
-- 1. Physically blocks overlapping active bookings on the same workstation
-- 2. Physically blocks overlapping active bookings for the same student
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS exclude_overlapping_machine_bookings;
ALTER TABLE bookings ADD CONSTRAINT exclude_overlapping_machine_bookings
  EXCLUDE USING gist (
    machine_id WITH =,
    booking_window WITH &&
  )
  WHERE (status IN ('CONFIRMED', 'CHECKED_IN') AND booking_window IS NOT NULL);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS exclude_overlapping_user_bookings;
ALTER TABLE bookings ADD CONSTRAINT exclude_overlapping_user_bookings
  EXCLUDE USING gist (
    user_id WITH =,
    booking_window WITH &&
  )
  WHERE (status IN ('CONFIRMED', 'CHECKED_IN') AND booking_window IS NOT NULL);
