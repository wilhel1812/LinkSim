-- Additive: select resources changed in a sync window without scanning old history.
-- Apply before deploying the library query optimization; retain for rollback.
CREATE INDEX IF NOT EXISTS idx_resource_changes_window
  ON resource_changes(resource_kind, changed_at, resource_id);
