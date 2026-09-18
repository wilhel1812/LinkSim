import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexedArchiveSchema } from '../experiments/better-auth/history-archive-indexed-schema.mjs';

describe('indexed history archive fixture', () => {
  it('uses the application history schema and all current history indexes', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(indexedArchiveSchema());
      const columns = db.prepare('PRAGMA table_info(resource_changes)').all().map(row => row.name);
      expect(columns).toEqual(expect.arrayContaining(['archive_key', 'archive_digest', 'snapshot_json', 'details_json']));
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='resource_changes'").all().map(row => row.name);
      expect(indexes).toEqual(expect.arrayContaining([
        'idx_resource_changes_lookup', 'idx_resource_changes_window',
        'idx_resource_changes_owner_audience', 'idx_resource_changes_shared_audience',
        'idx_resource_changes_site_tombstones', 'idx_resource_changes_sequence',
      ]));
    } finally { db.close(); }
  });
});
