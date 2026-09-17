SELECT resource_id FROM resource_changes INDEXED BY idx_resource_changes_owner_audience LIMIT 0;
SELECT resource_id FROM resource_changes INDEXED BY idx_resource_changes_shared_audience WHERE (json_extract(snapshot_json, '$.visibility') IN ('public', 'shared') OR COALESCE(json_extract(snapshot_json, '$.sharedWith'), '[]') != '[]' OR json_extract(details_json, '$.diff.visibility.before') IN ('public', 'shared') OR COALESCE(json_extract(details_json, '$.diff.sharedWith.before'), '[]') != '[]') LIMIT 0;
SELECT resource_id FROM resource_changes INDEXED BY idx_resource_changes_site_tombstones WHERE resource_kind = 'site' AND note = 'Deleted Site' LIMIT 0;
SELECT resource_id FROM resource_changes INDEXED BY idx_resource_changes_sequence LIMIT 0;
