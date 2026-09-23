-- Operator-authorized, single-use bridge from a legacy privileged Access identity
-- to its first Better Auth passkey. No credential or WebAuthn challenge is stored.

CREATE TABLE IF NOT EXISTS auth_privileged_passkey_recovery (
  id TEXT NOT NULL PRIMARY KEY,
  linksim_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expected_access_subject TEXT NOT NULL,
  migration_attempt_id TEXT UNIQUE REFERENCES auth_migration_attempt(id) ON DELETE CASCADE,
  auth_user_id TEXT REFERENCES auth_user(id) ON DELETE CASCADE,
  browser_token TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  started_at TEXT,
  consumed_at TEXT,
  revoked_at TEXT,
  CHECK (expected_access_subject = linksim_user_id),
  CHECK (consumed_at IS NULL OR started_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_privileged_passkey_recovery_active_user_idx
  ON auth_privileged_passkey_recovery(linksim_user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_privileged_passkey_recovery_expiry_idx
  ON auth_privileged_passkey_recovery(expires_at, consumed_at, revoked_at);
