PRAGMA foreign_keys = OFF;

ALTER TABLE users ADD COLUMN username_set_at TEXT;

UPDATE users
SET username_set_at = COALESCE(updated_at, created_at)
WHERE COALESCE(TRIM(username), '') != '';

UPDATE users
SET is_approved = 1,
    approved_at = COALESCE(approved_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    approved_by_user_id = COALESCE(approved_by_user_id, 'system:open-registration'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_admin = 0
  AND is_moderator = 0
  AND is_approved = 0
  AND (approved_by_user_id IS NULL OR approved_by_user_id NOT LIKE 'revoked:%');

PRAGMA foreign_keys = ON;
