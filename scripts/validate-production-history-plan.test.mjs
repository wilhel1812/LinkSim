import { describe, expect, it } from 'vitest';
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
  ])('rejects %s', (_label, plan) => {
    expect(() => validateProductionHistoryPlan(plan)).toThrow(/production history plan/i);
  });
});
