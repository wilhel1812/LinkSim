// Local synthetic SQL accounting. No deployment, secrets, or remote database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.ok(process.argv.slice(2).every(arg => arg === '--history'), 'only --history is supported');
const historyPerResource = process.argv.includes('--history') ? 10 : 0;
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm',
  stdin: { resolveDir: root, contents: `
    export * as library from './functions/api/library.ts';
    export * as me from './functions/api/me.ts';
    export * as notifications from './functions/api/notifications.ts';
    export * as client from './src/lib/cloudLibrary.ts';
    export { ensureUser } from './functions/_lib/db.ts';
  ` },
});
const app = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=synthetic-application.mjs').toString('base64')}`);
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, compatibilityDate: '2026-03-12',
  script: 'export default { fetch() { return new Response(null, {status: 403}); } };',
  d1Databases: ['DB'], outboundService: () => new Response(null, { status: 403 }),
}));
const originalFetch = globalThis.fetch;
const results = [];
let counters;
const add = (result) => {
  assert.ok(Number.isFinite(result.meta?.rows_read), 'D1 must return read metadata');
  assert.ok(Number.isFinite(result.meta?.rows_written), 'D1 must return write metadata');
  if (counters) {
    counters.queries++;
    counters.rowsRead += result.meta.rows_read;
    counters.rowsWritten += result.meta.rows_written;
  }
  return result;
};
try {
  const raw = await mf.getD1Database('DB');
  // Canonical schema and the application's own lazy upgrades, not a second schema.
  const schema = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
  for (const sql of schema.split(';').filter(s => s.trim())) await raw.prepare(sql).run();
  const unwrap = new WeakMap();
  const wrap = (statement) => {
    const wrapped = {
      bind: (...args) => wrap(statement.bind(...args)),
      all: async () => add(await statement.all()),
      run: async () => add(await statement.run()),
      // D1 first() hides metadata; execute the identical SQL with all() and
      // retain its documented first-row/column result. No extra query.
      first: async (column) => {
        const rows = add(await statement.all()).results;
        if (!rows.length) return null;
        if (column === undefined) return rows[0];
        assert.ok(Object.hasOwn(rows[0], column), 'requested D1 column exists');
        return rows[0][column];
      },
    };
    unwrap.set(wrapped, statement);
    return wrapped;
  };
  const DB = {
    prepare: (sql) => wrap(raw.prepare(sql)),
    batch: async (statements) => {
      assert.ok(statements.every(s => unwrap.has(s)));
      return (await raw.batch(statements.map(s => unwrap.get(s)))).map(add);
    },
  };
  // Check scalar/empty first semantics and that local counters include indexes.
  await raw.prepare('CREATE TABLE counter_calibration (id INTEGER PRIMARY KEY, value TEXT)').run();
  await raw.prepare('CREATE INDEX counter_calibration_value ON counter_calibration(value)').run();
  const calibration = await raw.prepare("INSERT INTO counter_calibration VALUES (1, 'test')").run();
  assert.ok(calibration.meta.rows_written >= 2, 'indexed write must count index work');
  assert.equal(await DB.prepare('SELECT value FROM counter_calibration').first('value'), 'test');
  assert.deepEqual(await DB.prepare('SELECT value FROM counter_calibration').first(), { value: 'test' });
  assert.equal(await DB.prepare('SELECT value FROM counter_calibration WHERE id = 2').first(), null);
  await raw.prepare('DROP TABLE counter_calibration').run();

  const env = { DB, ALLOW_INSECURE_DEV_AUTH: 'true', DEV_AUTH_USER_ID: 'synthetic-0', ADMIN_USER_IDS: '', AUTH_OBSERVABILITY: 'false' };
  globalThis.fetch = async (path, init) => {
    const request = new Request(new URL(path, 'http://localhost'), init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'http://localhost', 'never send external requests');
    const route = url.pathname.slice('/api/'.length);
    assert.ok(['library', 'me', 'notifications'].includes(route));
    const handler = app[route][request.method === 'PUT' ? 'onRequestPut' : 'onRequestGet'];
    assert.ok(['GET', 'PUT'].includes(request.method));
    const before = counters ? { ...counters } : undefined;
    if (counters) counters.requests++;
    const response = await handler({ request, env });
    if (response.status !== 200) throw new Error(`${route}: ${response.status}: ${await response.text()}`);
    if (counters && before) {
      const cursor = url.searchParams.get('cursor');
      const phase = route === 'library' && request.method === 'GET'
        ? (cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()).phase : 'sites') : '';
      const key = `${request.method} ${route}${phase ? '/' + phase : ''}`;
      const cost = counters.byRoute[key] ??= { requests: 0, queries: 0, rowsRead: 0, rowsWritten: 0 };
      for (const field of ['requests', 'queries', 'rowsRead', 'rowsWritten']) cost[field] += counters[field] - before[field];
    }
    return response;
  };
  const measure = async (operation, action) => {
    console.error(`Measuring: ${operation}`);
    counters = { requests: 0, queries: 0, rowsRead: 0, rowsWritten: 0, byRoute: {} };
    try {
      const value = await action();
      results.push({ operation, ...counters });
      return value;
    } finally { counters = undefined; }
  };
  const get = async path => (await fetch(path)).json();
  await measure('cold schema plus new identity (setup only)', () => get('/api/me'));
  const date = '2026-01-01T00:00:00.000Z';
  console.error('Seeding 1,000 synthetic accounts and private background resources');
  await raw.prepare(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<999)
    INSERT INTO users (id, username, is_approved, created_at)
    SELECT 'synthetic-'||n, 'synthetic-'||n, 1, ? FROM ids`).bind(date).run();
  const fixture = (sites, simulations) => ({
    siteLibrary: Array.from({ length: sites }, (_, i) => ({
      id: `site-${i}`, name: `Site ${i}`, visibility: 'private', sharedWith: [],
      position: { lat: 59.9, lon: 10.7 }, groundElevationM: 120, antennaHeightM: 12,
      txPowerDbm: 22, txGainDbi: 5, rxGainDbi: 5, cableLossDb: 1, createdAt: date, updatedAt: date,
    })),
    simulationPresets: Array.from({ length: simulations }, (_, i) => ({
      id: `simulation-${i}`, name: `Simulation ${i}`, visibility: 'private', sharedWith: [],
      snapshot: { sites: [], links: [], systems: [], networks: [] }, createdAt: date, updatedAt: date,
    })),
  });
  // Seed all other accounts with a small private library, avoiding an empty
  // background that would hide scans over unrelated resources.
  for (const [table, count] of [['sites', 10], ['simulations', 2]]) {
    await raw.prepare(`WITH RECURSIVE ids(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM ids WHERE n<?)
      INSERT INTO ${table} (id, owner_user_id, name, payload_json, updated_at)
      SELECT 'background-${table}-'||n, 'synthetic-'||(1+CAST(n/? AS INTEGER)),
        'Synthetic background', '{}', ? FROM ids`).bind(999 * count - 1, count, date).run();
    if (historyPerResource) {
      await raw.prepare(`WITH RECURSIVE entries(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM entries WHERE n < ?)
        INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at, details_json, snapshot_json)
        SELECT ?, resource.id, 'updated', resource.owner_user_id, ?, '{}',
          json_object('ownerUserId', resource.owner_user_id, 'visibility', 'private', 'sharedWith', json('[]'))
        FROM ${table} resource CROSS JOIN entries`).bind(historyPerResource, table === 'sites' ? 'site' : 'simulation', date).run();
    }
  }
  await app.client.pushCloudLibrary(fixture(10, 2));
  await measure('warm legacy identity ensure only (already included in handlers)',
    () => app.ensureUser(env, env.DEV_AUTH_USER_ID, { devAuth: true }));
  await measure('warm profile', () => get('/api/me'));
  const small = await measure('load 10 Sites + 2 Simulations', () => app.client.fetchCloudLibrary());
  assert.equal(small.siteLibrary.length, 10);
  assert.equal(small.simulationPresets.length, 2);
  const empty = await measure('empty delta', () => app.client.fetchCloudLibrary({ since: new Date().toISOString() }));
  assert.equal(empty.siteLibrary.length + empty.simulationPresets.length, 0);
  await measure('edit one Site + one Simulation', () => app.client.pushCloudLibrary({
    siteLibrary: [{ ...small.siteLibrary[0], name: 'Edited Site' }],
    simulationPresets: [{ ...small.simulationPresets[0], name: 'Edited Simulation' }],
  }));
  await measure('save one Simulation', () => app.client.pushCloudLibrary({
    siteLibrary: [], simulationPresets: [{ ...small.simulationPresets[1], name: 'Switched Simulation' }],
  }));
  await raw.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(env.DEV_AUTH_USER_ID).run();
  await measure('administrator notification poll', () => get('/api/notifications'));
  await raw.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(env.DEV_AUTH_USER_ID).run();
  // Store recovery sequence: read deletion/revocation state, force full upload,
  // read again. This all-owned fixture has no conflicts or revoked records.
  const recovery = async () => {
    const before = await app.client.fetchCloudLibrary();
    await app.client.pushCloudLibrary(before); // Helper throws on any conflict.
    const after = await app.client.fetchCloudLibrary();
    assert.equal(after.siteLibrary.length, before.siteLibrary.length);
    assert.equal(after.simulationPresets.length, before.simulationPresets.length);
  };
  await measure('full recovery: 12 records', recovery);
  await app.client.pushCloudLibrary(fixture(350, 50));
  await measure('full recovery: 400 records', recovery);
  console.log(JSON.stringify({
    source: 'local Miniflare D1 metadata; real handlers and client helpers',
    users: 1000, backgroundPrivateSites: 9990, backgroundPrivateSimulations: 1998,
    backgroundHistoryEntries: historyPerResource * (9990 + 1998),
    identity: 'existing explicit development auth; no OAuth or session costs included',
    limitations: 'Not remote billing, CPU, production distribution, or a concurrency test. Background has no sharing/tombstone history; --history adds old private edits. Cold setup excluded from steady-state model.',
    results,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await mf.dispose();
}
