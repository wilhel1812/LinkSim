PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  email TEXT,
  bio TEXT,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility);
CREATE INDEX IF NOT EXISTS idx_site_roles_user ON site_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_owner ON simulations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_visibility ON simulations(visibility);
CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id);
