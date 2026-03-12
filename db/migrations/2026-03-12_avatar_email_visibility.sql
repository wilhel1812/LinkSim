PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN email_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN avatar_object_key TEXT;
ALTER TABLE users ADD COLUMN avatar_thumb_key TEXT;
ALTER TABLE users ADD COLUMN avatar_hash TEXT;
ALTER TABLE users ADD COLUMN avatar_bytes INTEGER;
ALTER TABLE users ADD COLUMN avatar_content_type TEXT;

UPDATE users SET email_public = 1 WHERE email_public IS NULL;
