import { expect, it } from 'vitest';
import { SqliteD1 } from './testSqliteD1';
import { handleStagingArchiveRehearsal } from '../../experiments/better-auth/history-archive-staging-rehearsal';
import { stagingArchiveRehearsalConfig, validStagingRehearsalResult } from '../../experiments/better-auth/prepare-history-archive-staging.mjs';

const setup = () => {
  const db = new SqliteD1();
  db.db.exec('ALTER TABLE resource_changes ADD COLUMN archive_key TEXT; ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT');
  const snapshot = JSON.stringify({ id: 'archive-rehearsal-sim', snapshot: { padding: 'x'.repeat(4096) } });
  db.db.prepare("INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json) VALUES(7,'simulation','archive-rehearsal-sim','updated','archive-rehearsal-owner','2026-09-18',?)").run(snapshot);
  const objects = new Map<string, string>();
  const bucket = {
    put: async (key: string, value: string) => { objects.set(key, value); },
    get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: new TextEncoder().encode(value).length, text: async () => value }; },
  };
  const measuredDb = { prepare(sql: string) {
    const stmt = db.prepare(sql);
    const wrapped = { bind(...values: unknown[]) { stmt.bind(...values); return wrapped; },
      async all() { const result = await stmt.all(); return { ...result, meta: { rows_read: result.results.length, rows_written: 0 } }; },
      async run() { const result = await stmt.run(); return { ...result, meta: { ...result.meta, rows_read: 0, rows_written: result.meta.changes } }; } };
    return wrapped;
  } };
  const env = { DB: measuredDb as unknown as D1Database, HISTORY_BUCKET: bucket as unknown as R2Bucket,
    REHEARSAL_KEY: 'a'.repeat(64), REHEARSAL_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
    REHEARSAL_ROW_ID: '7', REHEARSAL_RESOURCE_KIND: 'simulation', REHEARSAL_RESOURCE_ID: 'archive-rehearsal-sim',
    REHEARSAL_ACTOR_USER_ID: 'archive-rehearsal-owner', HISTORY_SCOPE: 'staging' };
  const call = (path: string, authorization = `Bearer ${'a'.repeat(64)}`) => handleStagingArchiveRehearsal(
    new Request(`https://test${path}`, { method: 'POST', headers: { authorization } }), env);
  return { db, objects, env, call, snapshot };
};

it('keeps the staging rehearsal dry until the exact row and secret are supplied', async () => {
  const f = setup();
  try {
    expect((await f.call('/archive', 'Bearer wrong')).status).toBe(404);
    expect((await f.call('/archive?row=8')).status).toBe(404);
    expect((await handleStagingArchiveRehearsal(new Request('https://test/archive', { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(64)}` } }), f.env)).status).toBe(404);
    const dry = await (await f.call('/dry-run')).json() as { result: { candidates: number; converted: number } };
    expect(dry.result).toMatchObject({ candidates: 1, converted: 0 });
    const inline = await (await f.call('/hydrate')).json() as { result: { archived: boolean } };
    expect(inline.result.archived).toBe(false);
    expect(validStagingRehearsalResult('hydrate', inline)).toBe(false);
    expect(f.objects.size).toBe(0);
    expect((await f.call('/archive')).status).toBe(200);
    expect(f.objects.size).toBe(1);
    const hydrated = await (await f.call('/hydrate')).json() as { result: { found: boolean; archived: boolean; bytes: number } };
    expect(hydrated.result).toMatchObject({ found: true, archived: true, bytes: new TextEncoder().encode(f.snapshot).length });
    expect((await f.call('/restore')).status).toBe(200);
    expect(f.db.db.prepare('SELECT snapshot_json, archive_key FROM resource_changes WHERE id=7').get()).toEqual({ snapshot_json: f.snapshot, archive_key: null });
  } finally { f.db.db.close(); }
});

it('rejects changed identity, expired key, and any non-staging scope before archive writes', async () => {
  const f = setup();
  try {
    for (const patch of [
      { REHEARSAL_RESOURCE_ID: 'other' }, { REHEARSAL_ACTOR_USER_ID: 'other' },
      { REHEARSAL_EXPIRES_AT: '2020-01-01' }, { HISTORY_SCOPE: 'production' },
    ]) {
      const response = await handleStagingArchiveRehearsal(new Request('https://test/archive', { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}` } }), { ...f.env, ...patch });
      expect(response.status).not.toBe(200);
    }
    expect(f.objects.size).toBe(0);
    expect(f.db.db.prepare('SELECT archive_key FROM resource_changes WHERE id=7').get()).toEqual({ archive_key: null });
  } finally { f.db.db.close(); }
});

it('generates only a short-lived staging D1/R2 remote-development config', () => {
  const config = stagingArchiveRehearsalConfig({ rowId: 7, resourceKind: 'simulation', resourceId: 'archive-rehearsal-sim', actorUserId: 'archive-rehearsal-owner', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  expect(config.d1_databases).toEqual([{ binding: 'DB', database_name: 'linksim_staging', database_id: 'a35d016c-f2b8-40c8-ade9-b0f1b2b1bf1c', remote: true }]);
  expect(config.r2_buckets).toEqual([{ binding: 'HISTORY_BUCKET', bucket_name: 'linksim-history-staging', preview_bucket_name: 'linksim-history-staging', remote: true }]);
  expect(config.vars.HISTORY_SCOPE).toBe('staging');
  expect(config.vars.REHEARSAL_KEY).toBeUndefined();
  expect(config.secrets.required).toEqual(['REHEARSAL_KEY']);
  expect(JSON.stringify(config)).not.toContain('d669aac0-37ea-4c68-9b27-ece888e1966a');
  expect(() => stagingArchiveRehearsalConfig({ rowId: 0, resourceKind: 'simulation', resourceId: 'archive-rehearsal-sim', actorUserId: 'archive-rehearsal-owner', expiresAt: new Date(Date.now() + 60_000).toISOString() })).toThrow();
  expect(() => stagingArchiveRehearsalConfig({ rowId: 7, resourceKind: 'simulation', resourceId: 'archive-rehearsal-sim', actorUserId: 'archive-rehearsal-owner', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })).toThrow();
});

it('reports a successful command only when its archive result actually succeeded', () => {
  expect(validStagingRehearsalResult('dry-run', { result: { scanned: 1, candidates: 1, converted: 0, conflicts: 0 } })).toBe(true);
  expect(validStagingRehearsalResult('archive', { result: { scanned: 1, candidates: 1, converted: 1, conflicts: 0 } })).toBe(true);
  expect(validStagingRehearsalResult('hydrate', { result: { found: true, archived: true, bytes: 4285 } })).toBe(true);
  expect(validStagingRehearsalResult('restore', { result: { restored: true } })).toBe(true);
  for (const [operation, result] of [
    ['dry-run', { scanned: 1, candidates: 0, converted: 0, conflicts: 0 }],
    ['archive', { scanned: 1, candidates: 1, converted: 0, conflicts: 1 }],
    ['hydrate', { found: true, archived: false, bytes: 4285 }],
    ['restore', { restored: false }],
  ] as const) expect(validStagingRehearsalResult(operation, { result })).toBe(false);
});
