import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexedArchiveSchema, remoteArchiveFixtureSql } from '../experiments/better-auth/history-archive-indexed-schema.mjs';
import { archiveMixedFixtureRows } from '../experiments/better-auth/history-archive-fixtures';

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
  it('creates an indexed remote fixture with exact large JSON strings and bounded SQL statements', () => {
    const db = new DatabaseSync(':memory:');
    const row = { id: 1, snapshot_json: JSON.stringify({ ownerUserId: 'synthetic-owner', visibility: 'private', snapshot: { padding: "it's synthetic".repeat(5000) } }), details_json: JSON.stringify({ diff: { snapshot: { before: "it's synthetic".repeat(1000) } } }) };
    try {
      db.exec(indexedArchiveSchema());
      const sql = remoteArchiveFixtureSql([row], { indexed: true });
      expect(sql.split(';').filter(Boolean).every(statement => new TextEncoder().encode(statement).length < 16_384)).toBe(true);
      db.exec(sql);
      expect(db.prepare('SELECT snapshot_json, details_json, resource_kind, resource_id FROM resource_changes WHERE id=1').get())
        .toEqual({ snapshot_json: row.snapshot_json, details_json: row.details_json, resource_kind: 'simulation', resource_id: 'synthetic-1' });
    } finally { db.close(); }
  });
});

describe('mixed history archive fixture', () => {
  it('models public, shared, formerly public, private and deleted Site rows without confusing their audience indexes', () => {
    const rows = archiveMixedFixtureRows();
    expect(rows).toHaveLength(100);
    expect(rows.map(row => row.id)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(rows.filter(row => row.resource_kind === 'site')).toHaveLength(1);
    expect(rows.at(-1)).toMatchObject({ resource_kind: 'site', note: 'Deleted Site' });
    expect(JSON.parse(rows.at(-1).snapshot_json).snapshot).toBeUndefined();

    const db = new DatabaseSync(':memory:');
    try {
      db.exec(indexedArchiveSchema());
      const insert = db.prepare(`INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,note,snapshot_json,details_json)
        VALUES(?,?,?,'updated','synthetic-owner','2026-09-18',?,?,?)`);
      for (const row of rows) insert.run(row.id, row.resource_kind, row.resource_id, row.note, row.snapshot_json, row.details_json);
      expect(db.prepare(`SELECT count(*) AS n FROM resource_changes INDEXED BY idx_resource_changes_shared_audience
        WHERE (json_extract(snapshot_json, '$.visibility') IN ('public', 'shared')
          OR COALESCE(json_extract(snapshot_json, '$.sharedWith'), '[]') != '[]'
          OR json_extract(details_json, '$.diff.visibility.before') IN ('public', 'shared')
          OR COALESCE(json_extract(details_json, '$.diff.sharedWith.before'), '[]') != '[]')`).get().n).toBe(39);
      expect(db.prepare("SELECT count(*) AS n FROM resource_changes INDEXED BY idx_resource_changes_site_tombstones WHERE resource_kind = 'site' AND note = 'Deleted Site'").get().n).toBe(1);
    } finally { db.close(); }
  });
});
