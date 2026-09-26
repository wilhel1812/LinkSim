# Synthetic R2/D1 history archive prototype

## Internal maintenance guardrails

`functions/_lib/historyArchiveMaintenance.ts` is an internal primitive with no
route, schedule, UI, or deployed caller. It returns `disabled` unless its caller
passes `enabled: true`. The existing archive implementation still owns object
creation, verification, compare-and-swap, hydration, and restore behavior.

An enabled run requires the additive maintenance migration. Before each page
scan, it persistently reserves the maximum rows scanned/read and the associated
D1 writes. Before each candidate can reach R2, it persistently reserves the R2
PUT/GET, D1 read/write allowance, UTC-day object attempt and envelope bytes, and
lifetime archive bytes. The UTC day is derived for each reservation. All
reservations are conservative and are not released after a later failure, so an
interrupted invocation cannot regain that allowance by resuming. Checkpoints contain
only counts, timestamps, a cursor, a bounded run ID, status, and a fixed failure
category; they never contain resource identifiers, user identifiers, JSON, keys,
digests, URLs, or error text.

Each invocation also reserves 64 D1 rows read and three D1 rows written in the
budget singleton as part of acquiring its lease. This conservatively covers the
three schema probes, lease acquisition, run-state lookup, and run-state setup.
Lower caller limits are rejected before bindings are touched. If an invocation
stops immediately after acquisition, the next acquisition for the same run adds
another setup reservation instead of regaining the earlier allowance.

The budget singleton is also the run lock. Each acquisition receives a unique
token. Reservations, checkpoints, and release require that token and an
unexpired 30-minute lease, fencing an older invocation after takeover. A
different run cannot replace a running checkpoint; after expiry only the same
run may resume. If an invocation is
interrupted without reaching its failure handler, the same numeric GitHub-style
run ID can resume its stored `running` checkpoint after the lease expires;
prior reservations and D1/R2 counters still count toward the per-run ceilings.
Completed and explicitly failed runs cannot resume.

The immutable ceilings are 1,000 attempted objects and 100,000,000 envelope
bytes per UTC day, 5,000,000,000 lifetime envelope bytes, 25,000 scanned rows,
50,000 D1 rows read, and 7,500 D1 rows written per run, with pages of at most ten
rows. Smaller caller limits are allowed for a bounded rehearsal; larger values
are rejected before bindings are touched. Missing schema or D1 metrics, an
invalid reference, R2/integrity failure, compare-and-swap conflict, or exhausted
budget stops the run before another candidate. Successfully committed rows and
immutable objects are retained; this primitive performs no deletion or restore.

The 5 GB lifetime ceiling is a hard implementation safety ceiling rather than
the approved operating target. Before activation, cap each environment at 3 GB
and production plus staging at 6 GB, including retained versions and orphans.
Those lower caps preserve approximately 4 GB of a clean 10 GB account for
avatars, state and growth. A complete account inventory must still pass because
unrelated buckets share the allowance.

Status: **storage and separate Durable Object runtime demonstrated; not approved
for application activation. Pages maintenance CPU gate failed.** No application
route or binding changes, and no new UI or authentication behavior. The additive
maintenance tables store only budgets and checkpoints and do not invoke writes.
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
may refer to an older object. The
[storage and retention decision](evidence/2026-09-25-r2-storage-capacity.md)
requires a complete reference inventory, the actual backup/Time Travel horizon,
no active or ambiguous operation, and a complete environment-scoped object
listing before a separately reviewed cleanup can delete anything. Current
unreferenced rehearsal objects are not proven safe to delete.

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
grant revoked during R2 read. Stable staging supplies the private history
binding and scope; archive writes remain disabled, so this is a read-path
integration rather than archive activation.
Disabling archive writes alone is not rollback once rows are archived: keep the
reader or restore rows.

The authorized reader shared with application revert reuses
`resolveResourceChangeAccess` for revert permission, scopes the change ID to the
requested Site or Simulation before R2 access, verifies the D1 archive reference
did not change during hydration, and checks permission again after the R2 read.
Tests deny a stranger and a mismatched change without touching R2, and deny a
grant revoked during the read. The existing API route verifies identity and
current account state before calling this reader. Staging has the additive
schema migration and isolated private bucket binding, but still needs an
end-to-end rehearsal before archiving is enabled.

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
Production requires physically separate buckets and bindings. Never reuse a
production R2 key or introduce a production fallback. The archive-aware staging
refresh copies and verifies archived production objects into staging's private
bucket, then rewrites only their sanitized staging references. It also handles
inline-only exports without R2 credentials. The fixed, unbound production bucket
was provisioned through #1198, and the live path was rehearsed after #1200 with
one approved disposable object and separate 15-minute production-read and
staging-write credentials. The copy, sanitized staging reference, and digest
were verified before both new copies were removed. The five older retained
staging rehearsal objects remain governed by the backup-aware cleanup contract
below. Archive writes remain disabled.
The prototype leaves Manual Sync client behavior unchanged. A SQLite-backed
regression now exercises full Library fetch/push and both revert paths with an
archived and an inline revision. The authenticated mixed-history staging
rehearsal completed on 2026-09-18; archive writes remain disabled and separately
gated by the production cutover checklist.

## Bounded backfill and maintenance

The writer scans at most ten history rows per call and returns `nextId`; a
caller must persist its own progress and retry a page if any row conflicts.
There is no scheduler, automatic retention, or orphan deletion. A failed or
ambiguous write can leave an unreferenced R2 object, which is safer than deleting
an object that a committed D1 row may use. Operators must keep those objects
until a separately reviewed backup-aware cleanup exists. Archive writes remain
disabled in the application.

The dated 50-account production snapshot had 13,149 history rows, including
5,426 large Simulation candidates. At ten scanned rows per page, one complete
conflict-free scan would require at least 1,315 page calls and one R2 upload
and verification read per candidate that still qualifies. Retried pages,
compare-and-swap conflicts, and ambiguous D1 responses can create additional
uploads, verification reads, and retained orphan objects; 5,426 is not an
upper bound for R2 operations. This is an initial backfill baseline, not a
daily maintenance load or a measured completion time.
The four synthetic full pages took 4.3–5.3 seconds wall time and 62–72 ms
object CPU each; sparsity, conflicts, production indexes, and R2 latency make
linear extrapolation unreliable. Progress should be checkpointed between small
batches and verified against D1 references and R2 object integrity before
continuing. Measure actual row counts, quota use, elapsed time and physical D1
size on a synthetic staging rehearsal, then reassess free-tier headroom.

A [temporary staging-only rehearsal](history-archive-staging-rehearsal.md)
uses the real staging D1 and private R2 bindings through a local Durable
Object with remote bindings, restricted to one synthetic history row and a short-lived
secret. It does not enable application archive writes or replace the remaining
end-to-end revert, refresh and Manual Sync checks.
The [first staging round trip](evidence/2026-09-18-history-staging-rehearsal.md)
converted and restored one synthetic row with exact D1 equality. It did not
measure deployed CPU, and R2 bucket summary counts remained unconfirmed.

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

## Synthetic staging-refresh copy proof

`copyArchivedHistoryRowForStaging` accepts production or synthetic-production
scope and reuses the archive reader, digest check, projection check, and
destination verification. The local test copies a synthetic production-scoped
revision into a distinct synthetic staging bucket, then hydrates it through a
staging-scoped D1 reference. Corrupt source objects, failed writes, corrupt
destination reads, wrong scope, and inline rows fail without changing source
D1. An interrupted copy may leave an unreferenced staging object, which is
safer than deleting an object after an ambiguous write.

The routine refresh now calls `sanitize-with-archives`. It requires separate
production-read and staging-write R2 credentials only when the exported D1
snapshot contains archived references. The transfer copies and verifies every
referenced object in bounded groups, rewrites keys and digests in the sanitized
SQL, and imports only after all copies succeed. The configured bucket names are
distinct; the helper itself cannot prove that two arbitrary R2 bindings do not
alias. The live production-to-staging rehearsal described above supplemented
the local integration tests with a bounded disposable object; it did not copy
real production history or authentication data. The workflow does not provide
an atomic D1 import or backup-aware cleanup of unreferenced objects.

See [measured results](evidence/2026-09-17-history-r2.md).
