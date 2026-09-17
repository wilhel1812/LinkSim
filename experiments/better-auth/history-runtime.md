# Remote history CPU gate

This is a disposable compression component test, not a deployed application
feature or a complete authentication/Library capacity proof. Application
compression remains disabled. No D1, R2, OAuth, service or production bindings
are attached. The guarded setup fixes the account, worker name, runtime date,
allowed configuration and four-hour expiry. All work requires the ephemeral
probe key. No data is stored by the Worker.

Use the approved disposable name `linksim-history-probe-1107`. The scripts run
from the root using root dependencies, not the nested Better Auth package.

```
node experiments/better-auth/history-runtime.mjs prepare
node experiments/better-auth/history-runtime.mjs deploy
```

Start the existing sanitized tail collector before `run` (run the collector
from a scratch directory to keep generated evidence untracked):

```
history_probe_root="$PWD"
(cd experiments/better-auth/.wrangler/history-runtime && \
  "$history_probe_root/node_modules/.bin/wrangler" tail --config wrangler.json --format json | \
  node "$history_probe_root/experiments/better-auth/summarize-tail.mjs")
node experiments/better-auth/history-runtime.mjs run
```

The subshell writes `probe-tail.jsonl` directly into ignored scratch storage. Never persist raw tail events: they
contain the probe authorization header. Missing CPU fields mean unavailable,
not zero; use Cloudflare invocation analytics for billed CPU if tail omits it.
The runner records timestamps, sample labels, aggregate byte counts and statuses
in `.wrangler/history-runtime/results.json`, never keys or input payloads.

## Scenarios and interpretation

Fixtures reuse the application validator and constants: 256 KiB per Simulation,
20 records and 2 MiB per request. Client-side deterministic filler is repetitive
or varied to exercise different compression behavior. Snapshots contain 12/100/250 valid nested Sites and a Path, plus filler to
reach exact size boundaries. These synthetic fixtures exercise validation but
are not a measured distribution of real user content.

Small: 4 KiB; large: 64 KiB; max-record: 256 KiB; max-batch: 20 records with total
request size just below 2 MiB. Run three samples per mode/entropy/size, and five
for max-batch. Five max-batch requests represent the compression component of
100 Simulation uploads during full Manual Sync. They do not include the other
Sites, fetch, permission, deletion and revocation work and are not the entire
Manual Sync cost. Max-record and max-batch are separate legal worst cases.

The first authorized request is max-batch varied compression. An explicit marker
identifies first invocation of this module instance; this is not proof of a
Cloudflare infrastructure cold start. Request-specific data stays local; only the
first-invocation boolean is shared. Baseline requests perform the same validation,
snapshot-copy construction, JSON serialization and byte accounting, but skip the
codec. Compressed requests use the application codec unchanged. Neither variant
performs a database operation or authenticates an application user.

A compression component request over the gateway CPU budget is sufficient to
reject gateway execution. A pass cannot establish full-request headroom: actual
application authentication, D1 work, real nested snapshots, cold starts and
concurrency still need measurement before enabling compact writes. Never infer
CPU from elapsed response time or accept a successful overrun as headroom.
Record exact worker version, account plan, CPU distribution, errors and payload
sizes. Preserve failed requests; the runner does not hide or automatically retry
them. Its anonymous probe must fail closed.

When finished:

```
node experiments/better-auth/history-runtime.mjs delete
```

Delete only this disposable Worker. Keep aggregate evidence and remove its local
ephemeral key after teardown. No application setting is changed by these steps.
