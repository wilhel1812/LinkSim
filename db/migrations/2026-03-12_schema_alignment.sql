PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS deleted_users (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by_user_id TEXT
);

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN access_request_note TEXT;
ALTER TABLE users ADD COLUMN idp_email TEXT;
ALTER TABLE users ADD COLUMN idp_email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN approved_at TEXT;
ALTER TABLE users ADD COLUMN approved_by_user_id TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

ALTER TABLE sites ADD COLUMN created_by_user_id TEXT;
ALTER TABLE sites ADD COLUMN last_edited_by_user_id TEXT;
ALTER TABLE sites ADD COLUMN created_at TEXT;
ALTER TABLE sites ADD COLUMN last_edited_at TEXT;

ALTER TABLE simulations ADD COLUMN created_by_user_id TEXT;
ALTER TABLE simulations ADD COLUMN last_edited_by_user_id TEXT;
ALTER TABLE simulations ADD COLUMN created_at TEXT;
ALTER TABLE simulations ADD COLUMN last_edited_at TEXT;
