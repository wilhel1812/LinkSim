#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = Object.freeze({
  accountId: '85c57e0c4da3a747a09212dc5b090f52',
  address: 'cloudflare_r2_bucket.history',
  bucketName: 'linksim-history',
  jurisdiction: 'default',
});

const fail = () => { throw new Error('Production history plan must create only the protected linksim-history bucket'); };

export function validateProductionHistoryPlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.resource_changes)) fail();
  if (plan.resource_drift !== undefined &&
      (!Array.isArray(plan.resource_drift) || plan.resource_drift.length !== 0)) fail();
  const changes = plan.resource_changes.filter(resource =>
    JSON.stringify(resource?.change?.actions) !== JSON.stringify(['no-op']));
  if (changes.length !== 1) fail();
  const resource = changes[0];
  const after = resource?.change?.after;
  if (resource?.address !== EXPECTED.address || resource?.mode !== 'managed' ||
      resource?.type !== 'cloudflare_r2_bucket' ||
      JSON.stringify(resource?.change?.actions) !== JSON.stringify(['create']) ||
      after?.account_id !== EXPECTED.accountId || after?.name !== EXPECTED.bucketName ||
      after?.jurisdiction !== EXPECTED.jurisdiction) fail();
  return { address: EXPECTED.address, name: EXPECTED.bucketName };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planPath = 'prod.tfplan'] = process.argv.slice(2);
  const environment = resolve(dirname(fileURLToPath(import.meta.url)), '../environments/prod');
  const shown = spawnSync('terraform', [`-chdir=${environment}`, 'show', '-json', planPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (shown.error) throw shown.error;
  if (shown.status !== 0) throw new Error('Terraform could not read the production history plan');
  const result = validateProductionHistoryPlan(JSON.parse(shown.stdout));
  process.stdout.write(`[production-history-plan] Accepted ${result.address} (${result.name}) as the only resource change.\n`);
}
