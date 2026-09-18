#!/usr/bin/env node
// Temporary operator probe. This file deliberately names only staging resources.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const scratch = new URL('./.wrangler/history-staging-rehearsal/', import.meta.url);
const manifest = new URL('wrangler.json', scratch);
const secretFile = new URL('.dev.vars', scratch);
const staging = readFileSync(new URL('wrangler.staging.toml', root), 'utf8');
const d1 = staging.match(/\[\[d1_databases\]\]\s*binding = "DB"\s*database_name = "([^"]+)"\s*database_id = "([^"]+)"/);
const bucket = staging.match(/\[\[r2_buckets\]\]\s*binding = "HISTORY_BUCKET"\s*bucket_name = "([^"]+)"/);
assert.equal(d1?.[1], 'linksim_staging', 'Only the reviewed staging D1 is allowed');
assert.equal(d1?.[2], 'a35d016c-f2b8-40c8-ade9-b0f1b2b1bf1c', 'Review a changed staging D1 identifier');
assert.equal(bucket?.[1], 'linksim-history-staging', 'Only the reviewed staging history bucket is allowed');

export function stagingArchiveRehearsalConfig({ rowId, resourceKind, resourceId, actorUserId, expiresAt }) {
  assert.ok(Number.isSafeInteger(rowId) && rowId > 0, 'Positive history row ID required');
  assert.ok(['site', 'simulation'].includes(resourceKind), 'Known resource kind required');
  assert.ok(typeof resourceId === 'string' && resourceId.startsWith('archive-rehearsal-') && resourceId.length <= 128);
  assert.ok(typeof actorUserId === 'string' && actorUserId.startsWith('archive-rehearsal-') && actorUserId.length <= 128);
  const expiry = Date.parse(expiresAt);
  assert.ok(Number.isFinite(expiry) && expiry > Date.now() && expiry <= Date.now() + 30 * 60_000, 'Expiry must be within 30 minutes');
  return {
    name: 'linksim-history-staging-rehearsal-1107',
    account_id: '85c57e0c4da3a747a09212dc5b090f52',
    main: fileURLToPath(new URL('history-archive-staging-runtime.ts', import.meta.url)),
    compatibility_date: '2026-03-12', compatibility_flags: ['nodejs_compat'],
    workers_dev: false, preview_urls: false,
    observability: { enabled: true, head_sampling_rate: 1 },
    secrets: { required: ['REHEARSAL_KEY'] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['HistoryArchiveStagingRehearsal'] }],
    durable_objects: { bindings: [{ name: 'ARCHIVE', class_name: 'HistoryArchiveStagingRehearsal' }] },
    d1_databases: [{ binding: 'DB', database_name: d1[1], database_id: d1[2], remote: true }],
    r2_buckets: [{ binding: 'HISTORY_BUCKET', bucket_name: bucket[1], preview_bucket_name: bucket[1], remote: true }],
    vars: {
      HISTORY_SCOPE: 'staging', REHEARSAL_EXPIRES_AT: expiresAt,
      REHEARSAL_ROW_ID: String(rowId), REHEARSAL_RESOURCE_KIND: resourceKind,
      REHEARSAL_RESOURCE_ID: resourceId, REHEARSAL_ACTOR_USER_ID: actorUserId,
    },
  };
}

export function validStagingRehearsalResult(operation, body) {
  const result = body && typeof body === 'object' ? body.result : null;
  if (!result || typeof result !== 'object') return false;
  if (operation === 'dry-run') return result.scanned === 1 && result.candidates === 1 &&
    result.converted === 0 && result.conflicts === 0;
  if (operation === 'archive') return result.scanned === 1 && result.candidates === 1 &&
    result.converted === 1 && result.conflicts === 0;
  if (operation === 'hydrate') return result.found === true && result.archived === true &&
    Number.isSafeInteger(result.bytes) && result.bytes > 0;
  if (operation === 'object-count') return Number.isSafeInteger(result.objects) && result.objects > 0 && result.truncated === false;
  if (operation === 'restore') return result.restored === true;
  return false;
}

const ownCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (ownCli) {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'prepare' && args.length === 4) {
    assert.ok(!existsSync(manifest) && !existsSync(secretFile), 'Existing rehearsal files must be cleaned up first');
    const config = stagingArchiveRehearsalConfig({
      rowId: Number(args[0]), resourceKind: args[1], resourceId: args[2], actorUserId: args[3],
      expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    });
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    writeFileSync(manifest, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    writeFileSync(secretFile, `REHEARSAL_KEY="${randomBytes(32).toString('hex')}"\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`Prepared ${fileURLToPath(manifest)}; expires ${config.vars.REHEARSAL_EXPIRES_AT}.\n`);
    process.stdout.write(`Run: npx wrangler dev --config ${fileURLToPath(manifest)} --port 8799\n`);
  } else if (action === 'call' && args.length === 1 && ['dry-run', 'archive', 'hydrate', 'restore', 'object-count'].includes(args[0])) {
    assert.equal(statSync(manifest).mode & 0o077, 0, 'Manifest must be private');
    assert.equal(statSync(secretFile).mode & 0o077, 0, 'Secret must be private');
    const config = JSON.parse(readFileSync(manifest, 'utf8'));
    const key = readFileSync(secretFile, 'utf8').match(/^REHEARSAL_KEY="([a-f0-9]{64})"\n$/)?.[1];
    assert.ok(key, 'Invalid rehearsal secret');
    assert.deepEqual(config, stagingArchiveRehearsalConfig({
      rowId: Number(config.vars.REHEARSAL_ROW_ID), resourceKind: config.vars.REHEARSAL_RESOURCE_KIND,
      resourceId: config.vars.REHEARSAL_RESOURCE_ID, actorUserId: config.vars.REHEARSAL_ACTOR_USER_ID,
      expiresAt: config.vars.REHEARSAL_EXPIRES_AT,
    }), 'Manifest drift');
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:8799/${args[0]}`, {
      method: 'POST', headers: { authorization: `Bearer ${key}` },
      redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    const parsed = body ? JSON.parse(body) : null;
    const verified = response.ok && validStagingRehearsalResult(args[0], parsed);
    process.stdout.write(JSON.stringify({ operation: args[0], status: response.status, elapsedMs: Date.now() - started, verified, response: parsed }) + '\n');
    if (!verified) process.exitCode = 1;
  } else if (action === 'cleanup' && args.length === 0) {
    if (existsSync(manifest)) unlinkSync(manifest);
    if (existsSync(secretFile)) unlinkSync(secretFile);
    process.stdout.write('Private rehearsal files removed.\n');
  } else {
    throw Error('Usage: prepare-history-archive-staging.mjs prepare ROW_ID KIND RESOURCE_ID ACTOR_USER_ID | call dry-run|archive|hydrate|restore|object-count | cleanup');
  }
}
