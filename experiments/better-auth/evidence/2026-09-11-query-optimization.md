# Library query optimization: measured results

Target: **1,000 registered users at activity comparable to current users**.
The maintainer clarified that 1,000 DAU was not a requirement. Earlier 1,000-DAU
calculations are stress sensitivities only; they cannot establish that the actual
target fails. Overall auth capacity acceptance still needs representative usage.

## Changes and preserved behavior

`fetchLibraryForUser()` selects ordinary users' visible IDs through the existing
owner, visibility and grant indexes, deduplicates overlaps, then loads metadata.
An explicit candidate-first join prevents the Simulation status index from
turning this back into a scan of all active Simulations. Administrators retain
their separate all-resource path; moderators retain ordinary read visibility.

Removal checks now group relevant changes once and look up only candidate
resources, retaining the previous history/audience conditions and MAX(id)
semantics. Bounded removal and Site-deletion windows explicitly use the new
`(resource_kind, changed_at, resource_id)` index. Grouping by resource otherwise
made SQLite prefer the old index and scan historical rows even for empty deltas.

All six phases, inclusive timestamps, fixed cutoff, keyset pagination, deletion
audiences, historical grants and current account/resource permissions remain.
The API/client/store contracts and Manual Sync full-upload/recovery behavior are
unchanged. No auth integration, UI, retention policy or production change is made.

## Reproduction

Install the root and experiment dependencies, then run from the repository root:

```sh
node experiments/better-auth/application-d1-cost.mjs
node experiments/better-auth/application-d1-cost.mjs --history
```

The original sparse fixture is unchanged: 1,000 accounts, with 999 background
accounts each owning ten private Sites and two private Simulations. `--history`
adds ten old private edit records per background resource (119,880 total), with
no sharing, ownership transfer or deletion. The measured account starts with
12 records and later grows to 400 for recovery. Setup is excluded from costs.

The history comparison ran this identical extended harness against original
application commit `b3055db57bf79dd1b1f072670a36279cd47a9d9b` in a disposable local
checkout, and against the optimized code. The old schema lacked the new index;
the new schema includes it. The original sparse baseline remains archived in
`2026-09-11-application-d1-cost.json`. Full counters and phase attribution are in
[`2026-09-11-query-optimization.json`](2026-09-11-query-optimization.json).

## Local D1 rows read

| Operation | Sparse before | Sparse after | History before | History after |
|---|---:|---:|---:|---:|
| Load 12 records | 96,374 | 592 | 907,562 | 627,964 |
| Empty delta | 96,122 | 278 | 295,922 | 278 |
| Edit Site + Simulation | 43 | 43 | 43 | 43 |
| Save one Simulation | 24 | 24 | 24 | 24 |
| Administrator notification poll | 12 | 12 | 12 | 12 |
| Full recovery, 12 records | 192,909 | 1,369 | 1,815,285 | 1,256,113 |
| Full recovery, 400 records | 228,375 | 103,789 | 1,850,751 | 1,358,533 |

The sparse small-library load drops 99.4%; the empty delta drops 99.7% in the
sparse fixture and 99.9% with history. **Full loads with accumulated history
remain expensive**: the improvement there is only about 31%. They must still
inspect historical access and deletion audiences. Do not extrapolate the sparse
improvement to all libraries or claim an overall 1,000-user capacity pass.

HTTP counts are unchanged: a small load/delta uses 12 requests, small recovery
25, and the 400-record recovery 82. There is no polling or upload suppression.
These are local metadata counts, not remote billing, CPU, latency or concurrency
measurements. Both fixtures are synthetic and omit public/shared history and
tombstones; correctness tests exercise those cases, not their production costs.

## Write and deployment costs

The new index adds one write per inserted history record. Site-plus-Simulation
edits increase from 13 to 15 writes; Simulation-only saves from 8 to 9. Small
recovery rises from 135 to 147; 400-record recovery from 2,246 to 2,646. Loads and
empty deltas remain 36 writes, including legacy identity updates per request.
The three-write legacy identity check is unchanged and already included; do not
count it twice or assume future mapping integration has removed it.

Index construction is a one-time operation over existing history, requiring
additional storage and quota. It was not run on a remote database here. The
idempotent `2026-09-11_library_change_window.sql` migration is additive and keeps
every history record. CI applies and probes it before shared staging/production
deployment, and schema-changing previews are skipped. The local deploy preflight
also checks index availability. Production still requires its existing separate
approval. Keep the index during application rollback; do not drop it while an
optimized deployment may still serve requests.

## Validation and next boundary

New failing-first cost tests exposed private-population scans, the bounded
history scan and the Site-deletion delta scan. The passing tests cover growth
from 100 to 10,000 unrelated resources, 1,000 to 100,000 old history rows, and
the existing history-depth regression. SQLite tests preserve owner/public/grant
overlaps, moderator/admin visibility, deleted Simulations, timestamps, pagination
and legacy first-audit revocations. Index replay preserves all history unchanged.

Full application tests (1,468), build, and the required deep-link/calculation/
store suites (90 tests) passed. No live browser verification was performed.
After manual merge, shared-staging verification remains required.

The next investigation should address history-heavy full-load costs using
representative resource/history distributions before proposing a new capacity
ceiling. A persistent per-user change/audience index would be a broader data-model
decision with migration and revocation requirements, not an implicit extension
of this SQL batch. Do not trim audit history or omit recovery checks to make
the budget pass. The separately identified empty notification feed/polling and
duplicated metadata projection remain consolidation opportunities, not changes
included here.
