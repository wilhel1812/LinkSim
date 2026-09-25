import { describe, expect, it } from 'vitest';
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateProductionHistoryPlan } from '../infra/terraform/scripts/validate-production-history-plan.mjs';

const expected = {
  format_version: '1.2',
  resource_changes: [{
    address: 'cloudflare_r2_bucket.history',
    mode: 'managed',
    type: 'cloudflare_r2_bucket',
    change: {
      actions: ['create'],
      after: {
        account_id: '85c57e0c4da3a747a09212dc5b090f52',
        name: 'linksim-history',
        jurisdiction: 'default',
      },
    },
  }],
};

describe('production history Terraform plan validation', () => {
  it('uses an explicit refreshed target plan and a dedicated saved-plan name', () => {
    const script = readFileSync(
      new URL('../infra/terraform/scripts/plan-production-history.sh', import.meta.url),
      'utf8',
    );
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    expect(script).toContain('-target=cloudflare_r2_bucket.history');
    expect(script).toContain('TEMP_PLAN_PATH="${ENV_DIR}/prod-history.tmp.tfplan"');
    expect(script).toContain('-out="${TEMP_PLAN_PATH}"');
    expect(script).toContain('mv "${TEMP_PLAN_PATH}" "${PLAN_PATH}"');
    expect(script).not.toContain('-refresh=false');
    expect(packageJson.scripts['tf:plan:prod-history']).toBe(
      'infra/terraform/scripts/plan-production-history.sh',
    );
    expect(packageJson.scripts['tf:validate:prod-history-plan']).toBe(
      'node infra/terraform/scripts/validate-production-history-plan.mjs prod-history.tfplan',
    );
    const ignored = spawnSync('git', [
      'check-ignore',
      'infra/terraform/environments/prod/prod-history.tmp.tfplan',
      'infra/terraform/environments/prod/prod-history.tfplan',
    ], { encoding: 'utf8' });
    expect(ignored.status).toBe(0);
  });

  it('removes a stale saved plan before a failed preflight', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'linksim-prod-history-plan-'));
    const scripts = join(fixture, 'scripts');
    const environment = join(fixture, 'environments', 'prod');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(environment, { recursive: true });
    copyFileSync(
      new URL('../infra/terraform/scripts/plan-production-history.sh', import.meta.url),
      join(scripts, 'plan-production-history.sh'),
    );
    writeFileSync(join(environment, 'backend.hcl'), 'fixture');
    const stalePlan = join(environment, 'prod-history.tfplan');
    writeFileSync(stalePlan, 'stale plan');

    try {
      const env = { ...process.env };
      delete env.TF_VAR_cloudflare_api_token;
      const result = spawnSync('bash', [join(scripts, 'plan-production-history.sh')], {
        env,
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(existsSync(stalePlan)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('removes both plan artifacts after Terraform writes a temporary plan and fails', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'linksim-prod-history-plan-'));
    const scripts = join(fixture, 'scripts');
    const environment = join(fixture, 'environments', 'prod');
    const fakeBin = join(fixture, 'bin');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(environment, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    copyFileSync(
      new URL('../infra/terraform/scripts/plan-production-history.sh', import.meta.url),
      join(scripts, 'plan-production-history.sh'),
    );
    writeFileSync(join(environment, 'backend.hcl'), 'fixture');
    writeFileSync(join(scripts, 'init.sh'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(scripts, 'init.sh'), 0o755);
    writeFileSync(join(fakeBin, 'terraform'), `#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    -out=*) output="\${argument#-out=}" ;;
  esac
done
printf 'partial plan' > "$output"
exit 1
`);
    chmodSync(join(fakeBin, 'terraform'), 0o755);
    const finalPlan = join(environment, 'prod-history.tfplan');
    const temporaryPlan = join(environment, 'prod-history.tmp.tfplan');
    writeFileSync(finalPlan, 'stale plan');

    try {
      const result = spawnSync('bash', [join(scripts, 'plan-production-history.sh')], {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          TF_VAR_cloudflare_api_token: 'fixture-token',
        },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(existsSync(finalPlan)).toBe(false);
      expect(existsSync(temporaryPlan)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('accepts exactly the protected LinkSim history bucket creation', () => {
    const withExistingNoOp = {
      ...expected,
      resource_changes: [{
        address: 'module.stack.cloudflare_d1_database.database',
        mode: 'managed',
        type: 'cloudflare_d1_database',
        change: { actions: ['no-op'], after: { name: 'linksim' } },
      }, ...expected.resource_changes],
    };
    expect(validateProductionHistoryPlan(withExistingNoOp)).toEqual({
      address: 'cloudflare_r2_bucket.history',
      name: 'linksim-history',
    });
  });

  it.each([
    ['an additional resource change', {
      ...expected,
      resource_changes: [...expected.resource_changes, {
        address: 'module.stack.cloudflare_pages_project.project',
        mode: 'managed',
        type: 'cloudflare_pages_project',
        change: { actions: ['update'], after: {} },
      }],
    }],
    ['an update', {
      ...expected,
      resource_changes: [{ ...expected.resource_changes[0], change: {
        ...expected.resource_changes[0].change, actions: ['update'],
      } }],
    }],
    ['the wrong bucket name', {
      ...expected,
      resource_changes: [{ ...expected.resource_changes[0], change: {
        ...expected.resource_changes[0].change,
        after: { ...expected.resource_changes[0].change.after, name: 'linksim-history-staging' },
      } }],
    }],
    ['the wrong account', {
      ...expected,
      resource_changes: [{ ...expected.resource_changes[0], change: {
        ...expected.resource_changes[0].change,
        after: { ...expected.resource_changes[0].change.after, account_id: '00000000000000000000000000000000' },
      } }],
    }],
    ['a replacement', {
      ...expected,
      resource_changes: [{ ...expected.resource_changes[0], change: {
        ...expected.resource_changes[0].change, actions: ['delete', 'create'],
      } }],
    }],
    ['unrelated detected drift', {
      ...expected,
      resource_drift: [{
        address: 'module.stack.cloudflare_pages_project.project',
        mode: 'managed',
        type: 'cloudflare_pages_project',
        change: { actions: ['update'], after: { name: 'linksim' } },
      }],
    }],
    ['a malformed drift report', { ...expected, resource_drift: {} }],
  ])('rejects %s', (_label, plan) => {
    expect(() => validateProductionHistoryPlan(plan)).toThrow(/production history plan/i);
  });
});
