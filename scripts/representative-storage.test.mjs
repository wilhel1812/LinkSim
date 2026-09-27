import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql, seedSql, projectSql, authSql } from '../experiments/better-auth/representative-storage.mjs';

test('synthetic history fixture reflects the measured staging mix and projects only eligible rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql());
  for (const statement of seedSql()) db.exec(statement);
  const before = db.prepare(`SELECT resource_kind, COUNT(*) AS rows,
    SUM(LENGTH(snapshot_json)+LENGTH(details_json)) AS bytes
    FROM resource_changes GROUP BY resource_kind`).all();
  assert.deepEqual(before.map(row => [row.resource_kind, row.rows]), [['simulation', 3845], ['site', 5356]]);
  assert.ok(Math.abs(before[0].bytes - 17_778_010) < 1_777_801);
  assert.ok(Math.abs(before[1].bytes - 4_318_932) < 431_893);
  const candidate = db.prepare(`SELECT COUNT(*) AS rows,
    SUM(LENGTH(snapshot_json)-LENGTH(json_remove(snapshot_json,'$.snapshot'))
      +LENGTH(details_json)-LENGTH(json_remove(details_json,'$.diff.snapshot'))) AS removable
    FROM resource_changes WHERE id <= 2155`).get();
  assert.equal(candidate.rows, 2155);
  assert.ok(Math.abs(candidate.removable - 13_335_790) < 1_333_579);
  for (const statement of projectSql()) db.exec(statement);
  assert.equal(db.prepare('SELECT COUNT(*) AS rows FROM resource_changes WHERE archive_key IS NOT NULL').get().rows, 2155);
  assert.equal(db.prepare(`SELECT COUNT(*) AS rows FROM resource_changes WHERE id > 2155 AND archive_key IS NOT NULL`).get().rows, 0);
  for (const statement of authSql()) db.exec(statement);
  assert.equal(db.prepare('SELECT COUNT(*) AS rows FROM probe_user').get().rows, 1000);
  assert.equal(db.prepare('SELECT COUNT(*) AS rows FROM probe_account').get().rows, 1000);
  db.close();
});
