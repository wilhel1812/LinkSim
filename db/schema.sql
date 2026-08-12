PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  email TEXT,
  username_set_at TEXT,
  bio TEXT,
  access_request_note TEXT,
  idp_email TEXT,
  idp_email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  email_public INTEGER NOT NULL DEFAULT 1,
  avatar_object_key TEXT,
  avatar_thumb_key TEXT,
  avatar_hash TEXT,
  avatar_bytes INTEGER,
  avatar_content_type TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_moderator INTEGER NOT NULL DEFAULT 0,
  is_approved INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  approved_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS deleted_users (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by_user_id TEXT
);

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

CREATE TABLE IF NOT EXISTS identity_lifecycle_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

INSERT INTO identity_lifecycle_meta (singleton, version, applied_at)
VALUES (1, '2026-08-12-identity-lifecycle-v1', CURRENT_TIMESTAMP)
ON CONFLICT(singleton) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at;

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  created_by_user_id TEXT,
  last_edited_by_user_id TEXT,
  created_at TEXT,
  last_edited_at TEXT,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public_read', 'public_write')),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_roles (
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (site_id, user_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  created_by_user_id TEXT,
  last_edited_by_user_id TEXT,
  created_at TEXT,
  last_edited_at TEXT,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public_read', 'public_write')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation_roles (
  simulation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (simulation_id, user_id),
  FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resource_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('site','simulation')),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated')),
  actor_user_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  note TEXT,
  details_json TEXT,
  snapshot_json TEXT
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

CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility);
CREATE INDEX IF NOT EXISTS idx_site_roles_user ON site_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_owner ON simulations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_visibility ON simulations(visibility);
CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status);
CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_changes_lookup ON resource_changes(resource_kind, resource_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_claims_current_user ON verified_identity_claims(current_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_subject_current_canonical
  ON identity_subject_states(canonical_user_id) WHERE status = 'current';
CREATE INDEX IF NOT EXISTS idx_identity_audit_target ON user_identity_audit(target_user_id, created_at DESC);
