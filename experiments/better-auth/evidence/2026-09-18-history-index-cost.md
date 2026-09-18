# Local archive accounting for private Simulation history

This is a synthetic local workerd/D1/R2 comparison on staging commit
`b8c3d947afcf0b9f431619c0b560997e61dbbe54`. It uses the same disposable
gateway and Durable Object fixture in two modes: the original minimal history
table and the complete `db/schema.sql` application schema plus the two proposed
archive columns. No user data, live database, external provider, or deployment
was involved. Every measured history row is a private Simulation. The indexed
mode creates all six current `resource_changes` indexes, but the shared-audience
and deleted-Site partial indexes have no matching rows in this fixture.

| Operation | Minimal-table D1 writes | Application-indexed D1 writes | Reads in either mode |
| --- | ---: | ---: | ---: |
| Archive one eligible row | 1 | 2 | 2 |
| Archive ten eligible rows | 10 | 20 | 20 |
| Hydrate one row | 0 | 0 | 1 |
| Restore one row | 1 | 2 | 2 |
| Entire 26-request fixture | **54** | **108** | **116** |

The 26-request totals also remained at 80 D1 queries, 46 R2 PUTs and 62 R2
GETs in both modes. Each eligible private Simulation archive and restore update
in this fixture therefore added one measured D1 row write. Fixture
insertion, schema/index creation, later application edits, retention, failed
attempts, and staging activity are excluded. A run archiving 5,000 eligible rows
of the same private Simulation mix would consume about 10,000 D1 writes for the
archive updates alone **if this local per-row cost holds remotely**. Shared,
public, deleted-Site and other history mixes need separate measurements before
using the figure for the complete archive. Maintenance must be throttled within
the account-wide budget; it is not ordinary interactive traffic.

These are D1 metadata counters, not billed CPU. Local elapsed time (3–105 ms
in indexed mode) is not a Cloudflare CPU measurement, and index behavior may
change with a larger populated database or revised schema. The earlier remote
minimal-table result of 54 writes must not be reused as the indexed estimate.
Remote indexed CPU/write checks across representative history mixes,
authenticated application integration, staging activity, and a representative
account-wide quota model remain gates
before enabling archive conversion or replacing Access.

Reproduce locally with `node experiments/better-auth/history-archive-durable-local.mjs`
and `node experiments/better-auth/history-archive-durable-local.mjs --indexed`.
The exact request results are in
[minimal fixture JSON](2026-09-18-history-minimal-local.json) and
[indexed fixture JSON](2026-09-18-history-indexed-local.json).
