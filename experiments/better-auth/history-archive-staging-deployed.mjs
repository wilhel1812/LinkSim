#!/usr/bin/env node
// Short-lived deployed runtime probe. Its delete action targets its own random
// Worker only; application D1/R2 resources are never created or deleted here.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stagingArchiveRehearsalConfig, validStagingRehearsalResult } from './prepare-history-archive-staging.mjs';

const root = new URL('../../', import.meta.url);
const scratch = new URL('./.wrangler/history-staging-deployed/', import.meta.url);
const manifest = new URL('wrangler.json', scratch);
const keyFile = new URL('key', scratch);
const workerPrefix = 'linksim-history-staging-probe-';

export function stagingDeployedArchiveConfig({ name, rowId, resourceKind, resourceId, actorUserId, expiresAt }) {
  assert.match(name, /^linksim-history-staging-probe-[a-f0-9]{12}$/);
  const base = stagingArchiveRehearsalConfig({ rowId, resourceKind, resourceId, actorUserId, expiresAt });
  const { secrets: _devSecrets, ...shared } = base;
  return {
    ...shared, name, workers_dev: true,
    d1_databases: base.d1_databases.map(({ remote: _remote, ...binding }) => binding),
    r2_buckets: base.r2_buckets.map(({ remote: _remote, ...binding }) => binding),
  };
}

const ownCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (ownCli) {
  const [action, ...args] = process.argv.slice(2);
  const wrangler = (...command) => {
    const input = command[0] === 'secret' ? `${readFileSync(keyFile, 'utf8').trim()}\n` : undefined;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)),
      ...command, '--config', fileURLToPath(manifest)], { cwd: fileURLToPath(root), encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw Error(command[0] === 'secret'
      ? 'Wrangler secret upload failed; output withheld to protect the key'
      : `Wrangler ${command[0]} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  if (action === 'prepare' && args.length === 4) {
    assert.ok(!existsSync(manifest) && !existsSync(keyFile), 'Existing deployed rehearsal must be deleted first');
    const name = workerPrefix + randomBytes(6).toString('hex');
    const config = stagingDeployedArchiveConfig({ name, rowId: Number(args[0]), resourceKind: args[1],
      resourceId: args[2], actorUserId: args[3], expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() });
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    writeFileSync(manifest, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    writeFileSync(keyFile, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
    process.stdout.write(`Prepared ${name}; expires ${config.vars.REHEARSAL_EXPIRES_AT}. Run deploy, call, then delete.\n`);
  } else if (['deploy', 'call', 'delete'].includes(action)) {
    assert.equal(statSync(manifest).mode & 0o077, 0, 'Manifest must be private');
    const config = JSON.parse(readFileSync(manifest, 'utf8'));
    const expiry = Date.parse(config.vars?.REHEARSAL_EXPIRES_AT ?? '');
    assert.ok(Number.isFinite(expiry), 'Invalid expiry');
    // A past expiry must not prevent deletion. Normalize only for static drift
    // validation, then require the real expiry for deploy and calls.
    const normalizedExpiry = new Date(Date.now() + 60_000).toISOString();
    const expected = stagingDeployedArchiveConfig({ name: config.name,
      rowId: Number(config.vars.REHEARSAL_ROW_ID), resourceKind: config.vars.REHEARSAL_RESOURCE_KIND,
      resourceId: config.vars.REHEARSAL_RESOURCE_ID, actorUserId: config.vars.REHEARSAL_ACTOR_USER_ID,
      expiresAt: normalizedExpiry });
    assert.deepEqual({ ...config, vars: { ...config.vars, REHEARSAL_EXPIRES_AT: normalizedExpiry } }, expected, 'Deployment config drift');
    if (action === 'delete' && args.length === 0) {
      wrangler('delete', '--force');
      unlinkSync(manifest);
      if (existsSync(keyFile)) unlinkSync(keyFile);
      process.stdout.write(`Deleted only Worker ${config.name}; staging D1/R2 retained.\n`);
    } else {
      assert.ok(expiry > Date.now() && expiry <= Date.now() + 30 * 60_000, 'Probe expired');
      assert.equal(statSync(keyFile).mode & 0o077, 0, 'Secret must be private');
      const key = readFileSync(keyFile, 'utf8').trim();
      assert.match(key, /^[a-f0-9]{64}$/);
      if (action === 'deploy' && args.length === 0) {
        wrangler('deploy'); // No secret yet: the gateway fails closed.
        wrangler('secret', 'put', 'REHEARSAL_KEY');
        process.stdout.write(`Deployed ${config.name} with a short-lived secret.\n`);
      } else if (action === 'call' && args.length === 1 && ['dry-run', 'archive', 'hydrate', 'restore', 'object-count'].includes(args[0])) {
        const started = Date.now();
        const response = await fetch(`https://${config.name}.wilhelm-francke.workers.dev/${args[0]}`, {
          method: 'POST', headers: { authorization: `Bearer ${key}` }, redirect: 'manual', signal: AbortSignal.timeout(30_000),
        });
        const body = await response.text();
        const parsed = body ? JSON.parse(body) : null;
        const verified = response.ok && validStagingRehearsalResult(args[0], parsed);
        process.stdout.write(JSON.stringify({ operation: args[0], status: response.status, elapsedMs: Date.now() - started, verified, response: parsed }) + '\n');
        if (!verified) process.exitCode = 1;
      } else throw Error('Invalid deployed rehearsal command');
    }
  } else throw Error('Usage: history-archive-staging-deployed.mjs prepare ROW_ID KIND RESOURCE_ID ACTOR_ID | deploy | call dry-run|archive|hydrate|restore|object-count | delete');
}
