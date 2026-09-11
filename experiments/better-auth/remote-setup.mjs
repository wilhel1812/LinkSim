import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readProbeConfig } from './probe-config.mjs';
import { durableConfigs } from './durable-config.mjs';
import { buildBrowser } from './build-browser.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));

export function runSetup(action, { configPath, run = spawnSync } = {}) {
  assert.ok(['indexes-runtime', 'schema', 'deploy', 'secrets', 'deploy-runtime', 'deploy-gateway', 'secrets-runtime', 'bundle-runtime', 'bundle-gateway'].includes(action), 'expected schema, deploy or secrets');
  const base = readProbeConfig(configPath);
  const kind = action.split('-')[1];
  const config = kind ? durableConfigs(base)[kind] : base;
  if (['live-worker.mjs', 'durable-gateway-worker.mjs'].includes(config.main)) buildBrowser();
  // Pass the validated snapshot to Wrangler so setup cannot select another config.
  const scratch = join(directory, '.wrangler');
  mkdirSync(scratch, { recursive: true });
  const temporary = mkdtempSync(join(scratch, 'setup-'));
  try {
    const snapshot = join(temporary, 'wrangler.json');
    writeFileSync(snapshot, JSON.stringify({ ...config, main: join(directory, config.main) }), { mode: 0o600 });
    const commands = {
      'indexes-runtime': ['d1', 'execute', 'DB', '--remote', '--file', join(directory, 'indexes.sql')],
      schema: ['d1', 'execute', 'DB', '--remote', '--file', join(directory, 'schema.sql')],
      deploy: ['deploy'],
      secrets: ['secret', 'bulk', join(directory, '.probe-secrets.json')],
    };
    const invoke = (args, capture = false) => {
      const result = run(process.execPath, [join(directory, 'node_modules/wrangler/bin/wrangler.js'),
        ...args, '--config', snapshot, '--env', ''], { cwd: directory,
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
        encoding: 'utf8', env: { ...process.env, CI: 'true' } });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, 'Wrangler setup failed');
      return result;
    };
    const listSecrets = () => {
      const entries = JSON.parse(invoke(['secret', 'list', '--format', 'json'], true).stdout);
      assert.ok(Array.isArray(entries), 'invalid secret inventory');
      for (const entry of entries) assert.match(entry.name, /^[A-Z][A-Z0-9_]*$/, 'invalid secret name');
      return entries;
    };
    // Wrangler retains secrets during deploy. Inventory only names before the
    // switch, then remove them from this strictly validated disposable gateway.
    const retained = action === 'deploy-gateway' ? listSecrets() : [];
    invoke(commands[action] ?? (action.startsWith('secrets-') ? commands.secrets :
      action.startsWith('bundle-') ? ['deploy', '--dry-run', '--outdir', join(scratch, `durable-${kind}`)] : commands.deploy));
    for (const entry of retained) invoke(['secret', 'delete', entry.name]);
    if (action === 'deploy-gateway') assert.equal(listSecrets().length, 0, 'gateway still has secret bindings');

  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 3, 'usage: node remote-setup.mjs <indexes-runtime|schema|deploy|secrets|deploy-runtime|deploy-gateway|secrets-runtime|bundle-runtime|bundle-gateway>');
  runSetup(process.argv[2]);
}
