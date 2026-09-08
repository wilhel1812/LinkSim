import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protectedDatabaseIds, validateProbeConfig } from './probe-config.mjs';
import { runSetup } from './remote-setup.mjs';

function config(id = '11111111-2222-4333-8444-555555555555') {
  const name = 'linksim-auth-probe-test';
  return { name, main: 'worker.mjs', compatibility_date: '2026-03-12',
    compatibility_flags: ['nodejs_compat'], workers_dev: true,
    vars: { PROBE_ENABLED: 'isolated-auth-probe', PROBE_ORIGIN: `https://${name}.example.workers.dev` },
    d1_databases: [{ binding: 'DB', database_name: name, database_id: id }] };
}

test('rejects actual production/staging IDs despite disposable display names', () => {
  const ids = protectedDatabaseIds();
  assert.ok(ids.size >= 2);
  for (const id of ids) {
    assert.throws(() => validateProbeConfig(config(id)), /protected D1/);
    assert.throws(() => validateProbeConfig(config(id.toUpperCase())), /protected D1/);
  }
  assert.doesNotThrow(() => validateProbeConfig(config()));
});

test('rejects missing IDs, extra bindings, routes and environment overrides', () => {
  for (const id of ['', undefined, '<new-disposable-database-id>']) {
    const value = config();
    value.d1_databases[0].database_id = id;
    assert.throws(() => validateProbeConfig(value));
  }
  for (const changes of [{ routes: ['linksim.link/*'] }, { env: { staging: config() } },
    { d1_databases: [...config().d1_databases, ...config().d1_databases] }]) {
    assert.throws(() => validateProbeConfig({ ...config(), ...changes }));
  }
});

test('rejects runtime drift that would invalidate compatibility and CPU evidence', () => {
  for (const changes of [
    { compatibility_date: '2026-09-08' }, { compatibility_date: undefined },
    { compatibility_flags: [] }, { compatibility_flags: undefined },
    { compatibility_flags: ['nodejs_compat_v2'] },
    { compatibility_flags: ['nodejs_compat', 'no_nodejs_compat_v2'] },
  ]) {
    assert.throws(() => validateProbeConfig({ ...config(), ...changes }), /probe runtime/);
  }
});

test('every remote setup action rejects protected IDs before invoking Wrangler', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-test-'));
  const configPath = join(dir, 'probe.json');
  try {
    for (const id of protectedDatabaseIds()) {
      writeFileSync(configPath, JSON.stringify(config(id)));
      for (const action of ['schema', 'deploy', 'secrets']) {
        let invoked = false;
        assert.throws(() => runSetup(action, { configPath, run: () => { invoked = true; } }), /protected D1/);
        assert.equal(invoked, false);
      }
    }
    writeFileSync(configPath, JSON.stringify(config()));
    for (const action of ['schema', 'deploy', 'secrets']) {
      let invoked = false;
      runSetup(action, { configPath, run: (_command, args) => {
        invoked = true;
        const snapshot = JSON.parse(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
        assert.equal(snapshot.d1_databases[0].database_id, config().d1_databases[0].database_id);
        assert.equal(args[args.indexOf('--env') + 1], '');
        if (action === 'schema') assert.equal(args[args.indexOf('execute') + 1], 'DB');
        return { status: 0 };
      } });
      assert.equal(invoked, true);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
