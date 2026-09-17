// Guarded disposable experiment only. No application database/service bindings.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = fileURLToPath(new URL('.', import.meta.url));
const scratch = `${directory}.wrangler/history-runtime`;
const configPath = `${scratch}/wrangler.json`;
const keyPath = `${scratch}/key`;
const name = 'linksim-history-probe-1107';
const origin = `https://${name}.wilhelm-francke.workers.dev`;
const action = process.argv[2];
assert.ok(['prepare', 'deploy', 'run', 'delete'].includes(action) && process.argv.length === 3, 'usage: history-runtime.mjs prepare|deploy|run|delete');
const expectedConfig = expires => ({
  name, account_id: '85c57e0c4da3a747a09212dc5b090f52',
  main: `${directory}history-runtime-worker.ts`, compatibility_date: '2026-03-12',
  workers_dev: true, preview_urls: false,
  observability: { enabled: true, head_sampling_rate: 1 },
  vars: { PROBE_ENABLED: 'history-runtime-only', PROBE_EXPIRES_AT: expires },
});
const invoke = (args, input) => {
  const result = spawnSync(process.execPath, [`${root}node_modules/wrangler/bin/wrangler.js`, ...args, '--config', configPath, '--env', ''], {
    cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'inherit', 'inherit'],
  });
  assert.equal(result.status, 0, 'Wrangler command failed');
};
if (action === 'prepare') {
  mkdirSync(scratch, { recursive: true });
  // Never replace an existing key: that could lock out a still-running probe.
  try { writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  writeFileSync(configPath, JSON.stringify(expectedConfig(new Date(Date.now() + 4 * 3600000).toISOString()), null, 2), { mode: 0o600 });
  console.log('Prepared isolated, expiring history probe; secrets omitted.');
} else {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(config, expectedConfig(config.vars?.PROBE_EXPIRES_AT), 'configuration or binding drift rejected');
  if (action !== 'delete') {
    const expiry = Date.parse(config.vars.PROBE_EXPIRES_AT);
    assert.ok(expiry > Date.now() && expiry <= Date.now() + 4 * 3600000, 'probe expired or lifetime exceeds four hours');
    assert.equal(statSync(keyPath).mode & 0o077, 0, 'probe key must be owner-only');
  }
  if (action === 'deploy') {
    invoke(['deploy']);
    invoke(['secret', 'put', 'PROBE_KEY'], readFileSync(keyPath, 'utf8'));
  } else if (action === 'delete') {
    invoke(['delete', '--force']);
  } else {
    const bundle = await build({ absWorkingDir: root, entryPoints: [`${directory}history-runtime-fixtures.ts`], bundle: true, write: false, platform: 'node', format: 'esm' });
    const { historyRuntimeFixture } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const key = readFileSync(keyPath, 'utf8').trim();
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal((await fetch(origin + '/probe/compress', { redirect: 'manual' })).status, 404, 'anonymous probe must fail closed');
    const results = [];
    try {
      // Worst-case compression first; firstInvocation in the response/tail marks
      // initialization. This is not a guarantee of infrastructure cold placement.
      for (const scenario of ['max-batch', 'max-record', 'large', 'small']) {
        for (const entropy of ['varied', 'repetitive']) {
          const body = historyRuntimeFixture(scenario, entropy);
          for (const mode of ['compress', 'baseline']) {
            // Five max-batch uploads model the compression component of 100
            // Simulation uploads in a full Manual Sync. Reads/revocations excluded.
            const repeats = scenario === 'max-batch' ? 5 : 3;
            for (let sample = 1; sample <= repeats; sample++) {
              const path = `/probe/${mode}`;
              const start = Date.now();
              let record;
              try {
                const response = await fetch(origin + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
                  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body });
                const aggregate = response.status === 200 ? await response.json() : null;
                record = { scenario, entropy, mode, sample, startedAt: start, status: response.status, elapsedMs: Date.now() - start, aggregate };
              } catch { record = { scenario, entropy, mode, sample, startedAt: start, outcome: 'transport-failure', elapsedMs: Date.now() - start }; }
              results.push(record); console.log(JSON.stringify(record));
            }
          }
        }
      }
    } finally {
      writeFileSync(`${scratch}/results.json`, JSON.stringify({ source: 'remote component test, not full Library request or CPU proof', results }, null, 2));
    }
  }
}
