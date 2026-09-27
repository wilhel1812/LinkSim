// Disposable workerd + D1 experiment. Synthetic data only; no remote access.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'browser',
  stdin: { resolveDir: root, contents: `
    import { encodeHistoryDetails, decodeHistoryDetails } from './functions/_lib/historyDetails';
    import { compactHistoryDetailsPage } from './functions/_lib/historyCompaction';
    export default { async fetch(request, env) {
      const { raw, snapshot, apply } = await request.json();
      if (raw === undefined) return Response.json(await compactHistoryDetailsPage(env.DB, { apply }));
      const start = Date.now();
      const stored = await encodeHistoryDetails(raw);
      const decoded = await decodeHistoryDetails(stored);
      const detailsMs = Date.now() - start;
      const bytes = new TextEncoder().encode(snapshot);
      const packed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      const unpacked = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      return Response.json({ rawBytes: new TextEncoder().encode(raw).length,
        storedBytes: new TextEncoder().encode(stored).length,
        snapshotBytes: bytes.length, snapshotGzipBytes: packed.byteLength,
        roundTrip: decoded === raw && unpacked === snapshot, detailsMs, stored });
    }};
  ` },
});
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, compatibilityDate: '2026-03-12', script: bundle.outputFiles[0].text,
  d1Databases: ['DB'], outboundService: () => new Response(null, { status: 403 }),
}));
const call = async body => (await mf.dispatchFetch('http://localhost', { method: 'POST', body: JSON.stringify(body) })).json();
try {
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
  for (const sql of schema.split(';').filter(s => s.trim())) await db.prepare(sql).run();
  const results = [];
  let first;
  for (const count of [12, 100, 400]) {
    const before = { sites: Array.from({ length: count }, (_, id) => ({ id: 'synthetic-' + id, name: 'Synthetic Site ' + id, position: { lat: 60 + id / 10000, lon: 10 + id / 10000 }, frequencyMHz: 868, antennaHeightM: 2 })) };
    const after = structuredClone(before); after.sites[0].antennaHeightM = 3;
    const raw = JSON.stringify({ changedFields: ['snapshot', 'visibility', 'sharedWith'], diff: {
      snapshot: { before, after }, visibility: { before: 'public', after: 'private' },
      sharedWith: { before: [{ userId: 'synthetic-reader', role: 'viewer' }], after: [] },
    }});
    const result = await call({ raw, snapshot: JSON.stringify(after) });
    assert.equal(result.roundTrip, true);
    const stored = result.stored; delete result.stored;
    results.push({ sites: count, ...result });
    if (!first) first = { raw, stored };
  }
  await db.prepare("INSERT INTO resource_changes (resource_kind,resource_id,action,actor_user_id,changed_at,details_json,snapshot_json) VALUES ('simulation','synthetic','updated','synthetic-actor','2026-01-01',?,'{}')").bind(first.raw).run();
  const dry = await call({}); assert.equal(dry.converted, 0); assert.equal(dry.candidates, 1);
  assert.equal((await db.prepare('SELECT details_json FROM resource_changes').first()).details_json, first.raw);
  const apply = await call({ apply: true }); assert.equal(apply.converted, 1);
  const row = await db.prepare("SELECT details_json, snapshot_json, json_extract(details_json, '$.diff.visibility.before') AS old_visibility, json_extract(details_json, '$.diff.sharedWith.before[0].userId') AS old_reader FROM resource_changes").first();
  assert.equal(row.snapshot_json, '{}'); assert.equal(row.old_visibility, 'public'); assert.equal(row.old_reader, 'synthetic-reader');
  const again = await call({ apply: true }); assert.equal(again.converted, 0); assert.equal(again.candidates, 0);
  console.log(JSON.stringify({ source: 'local synthetic workerd and D1; duration is wall time, not production CPU', results, dry, apply, repeat: again }, null, 2));
} finally { await mf.dispose(); }
