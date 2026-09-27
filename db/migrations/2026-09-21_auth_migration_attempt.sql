-- Short-lived, single-use proof pairing for the temporary Access to Better Auth migration.
-- Attempts contain identifiers and timestamps only; authentication credentials never enter D1.

CREATE TABLE IF NOT EXISTS auth_migration_attempt (
  id TEXT NOT NULL PRIMARY KEY,
  legacy_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_subject TEXT NOT NULL,
  access_issued_at TEXT NOT NULL,
  auth_user_id TEXT REFERENCES auth_user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  completion_token TEXT,
  CHECK (access_subject = legacy_user_id),
  CHECK ((consumed_at IS NULL) = (completion_token IS NULL))
);

CREATE INDEX IF NOT EXISTS auth_migration_attempt_expiry_idx
  ON auth_migration_attempt(expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS auth_migration_attempt_auth_user_idx
  ON auth_migration_attempt(auth_user_id, expires_at);
