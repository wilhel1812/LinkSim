-- Add structured change details + snapshot payloads for non-destructive revert-as-copy.
ALTER TABLE resource_changes ADD COLUMN details_json TEXT;
ALTER TABLE resource_changes ADD COLUMN snapshot_json TEXT;
