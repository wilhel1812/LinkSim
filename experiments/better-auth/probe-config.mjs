import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unstable_readConfig as readConfig } from 'wrangler';
import { isRealTurnstileKey } from './turnstile-policy.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedKeys = new Set(['name', 'main', 'compatibility_date', 'compatibility_flags',
  'workers_dev', 'observability', 'vars', 'd1_databases']);

export function protectedDatabaseIds() {
  const ids = new Set();
  // Use Wrangler's parser and the authoritative configs, not copied IDs or names.
  for (const path of ['../../wrangler.toml', '../../wrangler.staging.toml']) {
    const config = readConfig({ config: fileURLToPath(new URL(path, import.meta.url)), env: '' });
    assert.ok(config.d1_databases?.length, 'missing protected D1 configuration');
    for (const binding of config.d1_databases) {
      assert.match(binding.database_id, uuid, 'invalid protected D1 configuration');
      ids.add(binding.database_id.toLowerCase());
    }
  }
  return ids;
}

export function validateProbeConfig(config) {
  for (const key of Object.keys(config)) assert.ok(allowedKeys.has(key), `unsupported probe config key: ${key}`);
  assert.match(config.name, /^linksim-auth-probe-[a-z0-9-]+$/);
  const live = config.vars?.PROBE_ENABLED === 'github-passkey-validation';
  assert.equal(config.main, live ? 'live-worker.mjs' : 'worker.mjs');
  assert.equal(config.compatibility_date, '2026-03-12', 'probe runtime date must match the measured Pages bundle');
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat'], 'probe runtime flags must match the measured Pages bundle');
  assert.equal(config.workers_dev, true);
  assert.equal(config.vars.PROBE_ENABLED, live ? 'github-passkey-validation' : 'isolated-auth-probe');
  const variableKeys = ['PROBE_ENABLED', 'PROBE_ORIGIN'];
  if (live) {
    variableKeys.push('PROBE_GITHUB_ID', 'PROBE_EXPIRES_AT');
    assert.match(config.vars.PROBE_GITHUB_ID, /^\d+$/, 'one stable tester ID required');
    const expires = Date.parse(config.vars.PROBE_EXPIRES_AT);
    assert.ok(expires > Date.now() && expires <= Date.now() + 7 * 86400000, 'live probe must expire within seven days');
    if (config.vars.PROBE_TURNSTILE_MODE !== undefined) {
      assert.equal(config.vars.PROBE_TURNSTILE_MODE, 'real');
      assert.ok(isRealTurnstileKey(config.vars.TURNSTILE_SITE_KEY), 'real public Turnstile site key required');
      variableKeys.push('PROBE_TURNSTILE_MODE', 'TURNSTILE_SITE_KEY');
    }
  }
  assert.deepEqual(Object.keys(config.vars).sort(), variableKeys.sort(), 'only approved non-secret variables allowed');
  const origin = config.vars.PROBE_ORIGIN;
  const target = new URL(origin);
  assert.equal(target.protocol, 'https:');
  assert.equal(target.origin, origin);
  assert.ok(target.hostname.startsWith(`${config.name}.`) && target.hostname.endsWith('.workers.dev'));
  assert.equal(config.d1_databases.length, 1);
  const binding = config.d1_databases[0];
  assert.deepEqual(Object.keys(binding).sort(), ['binding', 'database_id', 'database_name']);
  assert.equal(binding.binding, 'DB');
  assert.equal(binding.database_name, config.name);
  assert.match(binding.database_id, uuid, 'explicit disposable database_id required');
  assert.ok(!protectedDatabaseIds().has(binding.database_id.toLowerCase()), 'protected D1 database_id rejected');
  return config;
}

export function readProbeConfig(path = new URL('./wrangler.probe.jsonc', import.meta.url)) {
  // Deliberately require strict JSON: reject ambiguous/unsupported config shapes.
  return validateProbeConfig(JSON.parse(readFileSync(path, 'utf8')));
}
