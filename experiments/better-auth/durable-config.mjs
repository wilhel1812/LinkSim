import { validateProbeConfig } from './probe-config.mjs';
import assert from 'node:assert/strict';

// Derive the pair from the existing strictly validated disposable configuration.
// No arbitrary bindings, routes, databases or entrypoints enter either deployment.
export function durableConfigs(input) {
  const base = validateProbeConfig(input);
  assert.equal(base.main,'live-worker.mjs','Durable Object probe requires the restricted live harness');
  const runtimeName = `${base.name}-runtime`;
  assert.ok(runtimeName.length <= 63,'runtime name too long');
  const common = {compatibility_date:base.compatibility_date,compatibility_flags:base.compatibility_flags,
    observability:{enabled:true},vars:{...base.vars}};
  return {
    gateway:{...common,name:base.name,main:'durable-gateway-worker.mjs',workers_dev:true,
      durable_objects:{bindings:[{name:'AUTH',class_name:'AuthProbe',script_name:runtimeName}]}},
    runtime:{...common,name:runtimeName,main:'durable-runtime.mjs',workers_dev:false,preview_urls:false,
      d1_databases:base.d1_databases,migrations:[{tag:'v1',new_sqlite_classes:['AuthProbe']}]},
  };
}
