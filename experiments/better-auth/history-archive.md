# Synthetic R2/D1 history archive prototype

Status: **storage/recovery compatibility demonstrated; not approved for application
activation. Pages maintenance CPU gate failed.** No application imports this code,
no application schema or binding changes, and no new UI or authentication behavior.
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

Actual application revert is intentionally not changed: it still expects a full
snapshot in D1. Tests verify exact restoration and then the existing revert path.
Before activation, wire an authorized archive-aware snapshot reader into revert;
test it with concurrent permission changes and corruption. Disabling new writes
alone is not rollback once rows are archived: keep that reader or restore rows.

Staging isolation tests reject foreign scope references before loading an object.
Production requires physically separate buckets and bindings. The existing staging
exporter is **not archive-aware**: before integration it must reject or explicitly
sanitize/materialize archive references. Never copy production references into
staging or introduce a production fallback. Full live identity migration, staged
export, direct archived revert and end-to-end Manual Sync rehearsal remain gates.
The prototype leaves Manual Sync client behavior unchanged.

## Reproduce

Local (workerd/D1/R2, outbound network disabled):

```
node experiments/better-auth/history-archive-local.mjs
npm run test -- --run functions/_lib/historyArchivePrototype.test.ts
```

Remote synthetic test only, explicitly authorized disposable infrastructure:

```
node experiments/better-auth/history-archive-remote.mjs prepare
node experiments/better-auth/history-archive-remote.mjs create
node experiments/better-auth/history-archive-remote.mjs deploy
```

Start the existing sanitized tail collector before running measurements:

```
archive_root="$PWD"
(cd experiments/better-auth/.wrangler/history-archive && \
  "$archive_root/node_modules/.bin/wrangler" tail --config wrangler.json --format json | \
  node "$archive_root/experiments/better-auth/summarize-tail.mjs")
node experiments/better-auth/history-archive-remote.mjs run
node experiments/better-auth/history-archive-remote.mjs delete
```

Run cleanup while the four-hour secret-authenticated probe is still active. If
setup/teardown is interrupted or the Worker expires, use the saved manifest to
finish cleanup of **only** `linksim-history-r2-probe-1107`. Do not point the script
at application databases/buckets. Prepare refuses an existing manifest; retain the
sanitized results before removing completed scratch files for another run. Never
save raw tail events, which contain the Authorization header.

Remote fixture inserts use short SQL chunks to respect D1's statement-length
limit; their setup cost is excluded from workload figures. Runtime operations use
bound values. The remote table has no production indexes, so its D1 writes are a
lower bound, not a production projection.

See [measured results](evidence/2026-09-17-history-r2.md).
