CREATE TABLE IF NOT EXISTS site_notice (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  tone TEXT NOT NULL DEFAULT 'information' CHECK (tone IN ('information', 'warning', 'incident')),
  message TEXT NOT NULL DEFAULT '' CHECK (length(message) <= 280),
  dismissible INTEGER NOT NULL DEFAULT 0 CHECK (dismissible IN (0, 1)),
  starts_at TEXT,
  expires_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_notice_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('publish', 'clear')),
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  previous_json TEXT,
  next_json TEXT,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO site_notice
  (singleton, active, tone, message, dismissible, starts_at, expires_at, revision, updated_at, updated_by)
VALUES
  (1, 1, 'warning', 'LinkSim is temporarily not accepting new user registrations. We’re working on a solution.', 0, NULL, NULL, 1, '2026-08-20T00:00:00.000Z', 'migration:2026-08-20');

INSERT INTO site_notice_audit
  (action, actor_id, source, previous_json, next_json, created_at)
SELECT
  'publish',
  'migration:2026-08-20',
  'migration',
  NULL,
  json_object(
    'active', active = 1,
    'tone', tone,
    'message', message,
    'dismissible', dismissible = 1,
    'startsAt', starts_at,
    'expiresAt', expires_at,
    'revision', revision,
    'updatedAt', updated_at,
    'updatedBy', updated_by
  ),
  '2026-08-20T00:00:00.000Z'
FROM site_notice
WHERE singleton = 1
  AND updated_by = 'migration:2026-08-20'
  AND NOT EXISTS (SELECT 1 FROM site_notice_audit WHERE source = 'migration');
