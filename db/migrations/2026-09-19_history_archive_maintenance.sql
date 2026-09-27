-- Persistent fail-closed budgets and payload-free checkpoints for the internal
-- history archive maintenance primitive. This migration does not invoke it.
CREATE TABLE IF NOT EXISTS history_archive_maintenance_budget (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  utc_day TEXT NOT NULL,
  daily_attempted_objects INTEGER NOT NULL DEFAULT 0 CHECK (daily_attempted_objects >= 0),
  daily_archive_bytes INTEGER NOT NULL DEFAULT 0 CHECK (daily_archive_bytes >= 0),
  lifetime_archive_bytes INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_archive_bytes >= 0),
  active_run_id TEXT,
  active_run_token TEXT,
  lease_expires_at TEXT,
  setup_run_id TEXT,
  setup_d1_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (setup_d1_rows_read >= 0),
  setup_d1_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (setup_d1_rows_written >= 0),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO history_archive_maintenance_budget
  (singleton, utc_day, daily_attempted_objects, daily_archive_bytes, lifetime_archive_bytes,
   active_run_id, active_run_token, lease_expires_at, setup_run_id, setup_d1_rows_read,
   setup_d1_rows_written, updated_at)
VALUES (1, '1970-01-01', 0, 0, 0, NULL, NULL, NULL, NULL, 0, 0, '1970-01-01T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS history_archive_maintenance_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  checkpoint_at TEXT NOT NULL,
  next_after_id INTEGER NOT NULL DEFAULT 0 CHECK (next_after_id >= 0),
  scanned_rows INTEGER NOT NULL DEFAULT 0 CHECK (scanned_rows >= 0),
  candidate_rows INTEGER NOT NULL DEFAULT 0 CHECK (candidate_rows >= 0),
  attempted_objects INTEGER NOT NULL DEFAULT 0 CHECK (attempted_objects >= 0),
  converted_rows INTEGER NOT NULL DEFAULT 0 CHECK (converted_rows >= 0),
  archive_bytes INTEGER NOT NULL DEFAULT 0 CHECK (archive_bytes >= 0),
  d1_queries INTEGER NOT NULL DEFAULT 0 CHECK (d1_queries >= 0),
  d1_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (d1_rows_read >= 0),
  d1_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (d1_rows_written >= 0),
  r2_puts INTEGER NOT NULL DEFAULT 0 CHECK (r2_puts >= 0),
  r2_gets INTEGER NOT NULL DEFAULT 0 CHECK (r2_gets >= 0),
  reserved_scanned_rows INTEGER NOT NULL DEFAULT 0 CHECK (reserved_scanned_rows >= 0),
  reserved_d1_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (reserved_d1_rows_read >= 0),
  reserved_d1_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (reserved_d1_rows_written >= 0),
  reserved_r2_puts INTEGER NOT NULL DEFAULT 0 CHECK (reserved_r2_puts >= 0),
  reserved_r2_gets INTEGER NOT NULL DEFAULT 0 CHECK (reserved_r2_gets >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('budget','schema','conflict','archive','metrics','runtime'))
);
