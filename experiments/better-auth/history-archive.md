# Synthetic R2/D1 history archive prototype

Status: **storage and separate Durable Object runtime demonstrated; not approved
for application activation. Pages maintenance CPU gate failed.** No application
route, schema or binding changes, and no new UI or authentication behavior.
Keep `HISTORY_DETAILS_COMPRESSION` disabled. The target remains 1,000 registered
accounts, not 1,000 daily-active users.

## Storage contract

Reuse the bounded primary-key scan / dry-run / compare-and-swap approach from
`historyCompaction.ts`. Two extra columns exist only in disposable fixtures:
`archive_key` and `archive_digest`. Full original snapshot/details JSON strings
are stored in one private, immutable R2 object per history row. Only bulky
`snapshot.snapshot` and `details.diff.snapshot` are removed from the D1 projection;
all other keys, grants, visibility and identity metadata stay queryable. Small or
non-bulky rows are skipped. This prototype does not compact all possible Site data.

Default is dry-run, at most ten rows. Applying uploads to a unique object key,
verifies a bounded read using platform SHA-256 and exact original field equality,
then replaces both D1 fields only if their original contents still match and no
other archive won. A failed or ambiguous D1 response never deletes the object:
the database update may have committed. Conflicts leave harmless unreferenced
objects, not dangling committed references. Retrying rescans conflicted rows;
advancing the cursor alone is insufficient. No automatic garbage collector exists.

Hydration checks the object identity, scope, size and digest. Unchanged projections
restore exact original JSON text. Changed projections reinsert only the removed
bulky values, leaving current D1 ownership/grants authoritative. This preserves
legacy identity reconciliation without resurrecting stale metadata. Original audit
details remain in the immutable object. Missing/corrupt objects fail closed.

Rollback restores the hydrated fields with a compare-and-swap against the current
reference and both projections. Objects remain retained for in-flight readers and
backup rollback. Never add automatic bucket expiry: a D1 backup/Time Travel restore
may refer to an older object. Object retention, safe orphan cleanup and backups
must be designed together before activation.

## Reuse, authorization and remaining integration

Existing Library permission/deletion/revocation queries and history response
allowlists work with the projection; tests use the real database functions.
Hydration is an internal storage helper, not an authorization boundary. The
prototype probe requires a short-lived secret and synthetic bindings and emits
only aggregate results. Production integration must call the existing current
resource authorization before loading an object and must not expose an R2 key or
use the avatar endpoint/public bucket/caching/fallback origin.

Application revert now uses the authorized archive-aware reader when both
`HISTORY_BUCKET` and `HISTORY_SCOPE` are bound. It verifies the archived object,
the unchanged D1 projection, and current permission before applying the full
snapshot. If an archived row is encountered without the binding, revert fails
closed instead of saving the compact projection. Tests cover corruption and a
grant revoked during R2 read. No application deployment supplies these bindings
yet, so this is a disabled read-path integration, not archive activation.
Disabling archive writes alone is not rollback once rows are archived: keep the
reader or restore rows.

The authorized reader shared with application revert reuses
`resolveResourceChangeAccess` for revert permission, scopes the change ID to the
requested Site or Simulation before R2 access, verifies the D1 archive reference
did not change during hydration, and checks permission again after the R2 read.
Tests deny a stranger and a mismatched change without touching R2, and deny a
grant revoked during the read. The existing API route verifies identity and
current account state before calling this reader; staging still needs a bound
bucket, additive schema and an end-to-end rehearsal before archiving is enabled.

The archive writer now has a separate disposable SQLite-backed Durable Object
runtime. A thin public gateway holds only a short-lived probe credential and a
private object binding; only the object holds synthetic D1 and R2 bindings. The
gateway forwards no cookies or identity headers. The probe uses a separate object
from the proposed authentication object, and adds no scheduler. The archived
content and application-owned permissions remain in D1/R2, not DO storage. Local
workerd tests completed 26 synthetic operations through the full chain. Remote
traces matched all 26 requests at the gateway and object. See
[Durable Object measurements](evidence/2026-09-18-history-durable.md).

Staging isolation tests reject foreign scope references before loading an object.
Production requires physically separate buckets and bindings. Never copy
production references into staging or introduce a production fallback. The
prototype leaves Manual Sync client behavior unchanged; end-to-end staging
rehearsal remains a gate. The staging exporter rejects production archive
references because it cannot read their R2 objects. A refresh from inline
production data safely replaces staging-only archived rows; a regression test
covers this case. Production archive activation still requires an archive-aware
export or another reviewed refresh strategy.

## Reproduce

Local (workerd/D1/R2, outbound network disabled):

```
node experiments/better-auth/history-archive-local.mjs
node experiments/better-auth/history-archive-durable-local.mjs
npm run test -- --run functions/_lib/historyArchivePrototype.test.ts
```

Remote synthetic test only, explicitly authorized disposable infrastructure:

```
node experiments/better-auth/history-archive-remote.mjs prepare
node experiments/better-auth/history-archive-remote.mjs create
node experiments/better-auth/history-archive-remote.mjs deploy
```

Start one sanitized tail collector for each Worker before running measurements.
The gateway and runtime manifests are in the same scratch directory; use separate
output directories because the collector writes `probe-tail.jsonl` in its current
working directory. The tail records must be matched to the 26 result paths and
statuses, excluding the anonymous 404 and cleanup. The runtime manifest owns D1
and R2, while the gateway manifest owns only the Durable Object binding:

```
archive_root="$PWD"
mkdir -p experiments/better-auth/.wrangler/history-archive/gateway-tail \
  experiments/better-auth/.wrangler/history-archive/runtime-tail
(cd experiments/better-auth/.wrangler/history-archive/gateway-tail && \
  "$archive_root/node_modules/.bin/wrangler" tail --config ../gateway.wrangler.json --format json | \
  node "$archive_root/experiments/better-auth/summarize-tail.mjs")
(cd experiments/better-auth/.wrangler/history-archive/runtime-tail && \
  "$archive_root/node_modules/.bin/wrangler" tail --config ../wrangler.json --format json | \
  node "$archive_root/experiments/better-auth/summarize-tail.mjs")
node experiments/better-auth/history-archive-remote.mjs run
node experiments/better-auth/history-archive-remote.mjs delete
```

On a **fresh disposable database**, pass `--indexed` to `run` to load the
application schema and history indexes before recording private Simulation
fixture costs. Do not mix minimal and indexed runs in the same database.

The `run` action saves all results and exits nonzero for failed or incomplete
measurements. Repeating `create` verifies the persisted D1 identity and resumes
missing bucket creation; it does not recreate D1. `delete` verifies that identity,
recreates a missing disposable bucket if necessary, and redeploys both
secret-protected Workers with a ten-minute cleanup window before emptying/deleting
resources. This works after expiry or interrupted initial deployment. If a
provider operation still fails, retain the manifest/key and retry cleanup of
**only** `linksim-history-r2-probe-1107`. Do not point the script
at application databases/buckets. Prepare refuses an existing manifest; retain the
sanitized results before removing completed scratch files for another run. Never
save raw tail events, which contain the Authorization header.

Remote fixture inserts use short SQL chunks to respect D1's statement-length
limit; their setup cost is excluded from workload figures. Runtime operations use
bound values. That earlier minimal-table remote run had no application history
indexes, so its D1 writes were a lower bound, not a production projection.

A later [local application-index comparison](evidence/2026-09-18-history-index-cost.md)
measured 108 D1 writes across the same 26 private Simulation operations, versus
54 in the minimal fixture. Shared/public and deleted-Site rows were not measured;
the [disposable remote indexed run](evidence/2026-09-18-history-indexed-remote.md)
also measured 108 writes and gateway CPU of 0–1 ms. Account-wide quota,
authenticated application requests and representative history mixes remain open.

A later [staging size snapshot and synthetic mixed-audience local run](evidence/2026-09-18-history-mix-local.md)
found 2,155 approximate archive candidates in 9,201 staging history rows.
The indexed local probe wrote 236 D1 rows to archive 99 bulky Simulations
with a staging-shaped audience fraction, while a compact deleted Site was
skipped. Its large record sizes are a stress case, not staging's mean;
production-sized archive retention and the auth capacity gate remain open.

A separate [remote D1 storage-reclamation check](evidence/2026-09-18-d1-storage-reclamation.md)
observed physical size reduction after updating indexed synthetic history JSON,
including a mixed set with full revisions retained. This does not activate
archiving or establish long-term 1,000-account storage headroom.

See [measured results](evidence/2026-09-17-history-r2.md).
