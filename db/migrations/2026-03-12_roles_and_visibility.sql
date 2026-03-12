PRAGMA foreign_keys = OFF;

ALTER TABLE users ADD COLUMN is_moderator INTEGER NOT NULL DEFAULT 0;

-- Legacy visibility default for existing resources: treat as shared.
UPDATE sites SET visibility = 'public_write' WHERE visibility = 'private';
UPDATE simulations SET visibility = 'public_write' WHERE visibility = 'private';

PRAGMA foreign_keys = ON;
