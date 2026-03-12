PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  email TEXT,
  bio TEXT,
  access_request_note TEXT,
  idp_email TEXT,
  idp_email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
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
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility);
CREATE INDEX IF NOT EXISTS idx_site_roles_user ON site_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_owner ON simulations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_visibility ON simulations(visibility);
CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_changes_lookup ON resource_changes(resource_kind, resource_id, changed_at DESC);
