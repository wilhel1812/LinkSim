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
  assert.ok(['schema', 'deploy', 'secrets', 'deploy-runtime', 'deploy-gateway', 'secrets-runtime', 'bundle-runtime', 'bundle-gateway'].includes(action), 'expected schema, deploy or secrets');
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
      schema: ['d1', 'execute', 'DB', '--remote', '--file', join(directory, 'schema.sql')],
      deploy: ['deploy'],
      secrets: ['secret', 'bulk', join(directory, '.probe-secrets.json')],
    };
    const result = run(process.execPath, [join(directory, 'node_modules/wrangler/bin/wrangler.js'),
      ...(commands[action] ?? (action.startsWith('secrets-') ? commands.secrets :
        action.startsWith('bundle-') ? ['deploy', '--dry-run', '--outdir', join(scratch, `durable-${kind}`)] : commands.deploy)), '--config', snapshot, '--env', ''], { cwd: directory, stdio: 'inherit' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Wrangler setup failed');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 3, 'usage: node remote-setup.mjs <schema|deploy|secrets|deploy-runtime|deploy-gateway|secrets-runtime|bundle-runtime|bundle-gateway>');
  runSetup(process.argv[2]);
}
