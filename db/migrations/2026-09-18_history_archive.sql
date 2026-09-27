-- Additive staging history archive references. Apply only after probing for both
-- columns; production remains inline until the separate cutover is approved.
ALTER TABLE resource_changes ADD COLUMN archive_key TEXT;
ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;
