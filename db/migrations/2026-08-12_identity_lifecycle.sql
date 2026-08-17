-- Identity lifecycle v1. This migration is intentionally fail-closed.
-- If any historical tombstone exists, origin/staging has no retained verified
-- email evidence from which to create a safe cross-subject deletion block.
-- An administrator must resolve those rows explicitly before retrying.

CREATE TABLE IF NOT EXISTS identity_lifecycle_migration_guard (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1)
);
DELETE FROM identity_lifecycle_migration_guard;
INSERT INTO identity_lifecycle_migration_guard (singleton)
SELECT 1 FROM deleted_users LIMIT 1;
INSERT INTO identity_lifecycle_migration_guard (singleton)
SELECT 1 FROM deleted_users LIMIT 1;

CREATE TABLE IF NOT EXISTS verified_identity_claims (
  normalized_email TEXT PRIMARY KEY,
  current_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  blocked_at TEXT,
  blocked_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS identity_subject_states (
  user_id TEXT PRIMARY KEY,
  normalized_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('current', 'superseded', 'blocked')),
  canonical_user_id TEXT,
  bootstrap_consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  changed_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS user_identity_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  source_user_id TEXT,
  actor_user_id TEXT,
  idp_email TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

DELETE FROM verified_identity_claims;
DELETE FROM identity_subject_states;

-- The primary key makes duplicate normalized verified identities abort this
-- statement. No arbitrary winner is selected.
INSERT INTO verified_identity_claims
  (normalized_email, current_user_id, status, created_at, updated_at, blocked_at, blocked_by_user_id)
SELECT lower(trim(idp_email)), id, 'active',
       COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, created_at, CURRENT_TIMESTAMP),
       NULL, NULL
FROM users
WHERE idp_email_verified = 1 AND COALESCE(trim(idp_email), '') <> '';

INSERT INTO identity_subject_states
  (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at, changed_by_user_id)
SELECT id, lower(trim(idp_email)), 'current', id, 1,
       COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), NULL
FROM users
WHERE idp_email_verified = 1 AND COALESCE(trim(idp_email), '') <> '';

CREATE INDEX IF NOT EXISTS idx_identity_claims_current_user
  ON verified_identity_claims(current_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_subject_current_canonical
  ON identity_subject_states(canonical_user_id) WHERE status = 'current';
CREATE INDEX IF NOT EXISTS idx_identity_audit_target
  ON user_identity_audit(target_user_id, created_at DESC);

CREATE TABLE identity_lifecycle_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
INSERT INTO identity_lifecycle_meta (singleton, version, applied_at)
VALUES (1, '2026-08-12-identity-lifecycle-v1', CURRENT_TIMESTAMP)
;

DROP TABLE identity_lifecycle_migration_guard;
