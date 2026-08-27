-- Private account-synced custom basemap definitions.
-- The deployment migration runner probes PRAGMA table_info(users) first so
-- this additive ALTER is applied once and repeated deployments are idempotent.
ALTER TABLE users ADD COLUMN basemap_preferences_json TEXT;
