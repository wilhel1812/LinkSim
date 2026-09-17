# Full recovery history candidates

Target remains 1,000 registered users at representative activity, not 1,000 DAU.
This batch preserves full Manual Sync: recovery reads, full uploads even without
client dirty flags, and a final read. It does not establish overall capacity.

## Query changes

Site deletion checks use a partial tombstone index, excluding ordinary edits.
For full reads, revocation candidates come from indexed historical owners plus
history with public/shared visibility, grants, or relevant before-state. This is
a superset: the existing exact current-permission, prior-ID and before-state
conditions remain the authority. An unrelated grant cannot revoke a user's
record. Incremental reads retain the time-window query.

The full-read candidate query can be inlined so pagination does not first group
all remaining history. A sequence index makes MAX(id) lookups efficient; a
regression test caught repeated history scans without this index. MAX(id), not
timestamp order, still defines the prior-history boundary. No history is deleted,
no access cache is introduced, and no API/client/store implementation changes.

Four additive indexes cover historical owner, potential shared audience, Site
tombstones, and per-resource sequence. Existing bootstrap creates them locally.
CI migrates and probes them before shared deployment; manual deployment preflight
also probes them, and schema-changing PR previews are skipped. Keep indexes on
rollback. No version change: this remains the approved 0.29.0 development line.

## Measured local D1 costs

Baseline: staging commit `55e4c806738cfd4093a34958b976f6c0e4f0c581`.
The baseline mixed run uses the same extended harness against that commit.
Private baseline is the archived September 11 optimized history result.
Both history fixtures contain 119,880 edits over 999 background accounts.

| Operation | Private history before | Private history after | Mixed history before | Mixed history after |
|---|---:|---:|---:|---:|
| Load 12 records | 627,964 | 540 | 12,855,400 | 136,870 |
| Empty delta | 278 | 278 | 318 | 318 |
| Full recovery, 12 records | 1,256,113 | 1,261 | 25,712,185 | 275,533 |
| Full recovery, 400 records | 1,358,533 | 99,851 | 25,975,933 | 421,859 |

Mixed means 10% of background resources were public before becoming private;
1% were subsequently deleted. Every expected marker is asserted: 100 deleted
Sites, 20 deleted Simulations, 899 revoked Sites and 180 revoked Simulations.
Direct grants and former owners are covered by SQL correctness tests, not claimed
as measured production distributions. The fixture is a sensitivity, not usage
telemetry. The 12-record recovery drops 99.9% in private history and 98.9% in mixed
history. Public history still increases work for all users under existing semantics.

The sparse-history control also passes: 540 reads for a load and 1,259 for
12-record recovery (versus 592 and 1,369 previously).

HTTP counts are unchanged: 25 requests for private 12-record recovery, 82 for
400 records; mixed recovery uses 137 and 194 because of paged recovery markers.
This preserves every phase and does not reduce the Workers request budget.

Write costs increase: a private Site-plus-Simulation edit goes from 15 to 19;
one Simulation save from 9 to 11. Private full recovery is 147 to 171 writes
(12 records), and 2,646 to 3,446 (400 records). Mixed recovery is 483 to 507 and
2,982 to 3,782. Two full indexes add writes for every history insert; partial
indexes add costs when their predicates match. Public/grant edits can therefore
cost more than the measured private edits. Existing legacy identity writes are
already included, OAuth/session costs are not.

Index creation also consumes one-time reads/writes and storage. At large history
sizes that can itself exceed a free daily allowance; do not extrapolate these
runtime savings to a free migration. A read-only staging count was attempted but
local Cloudflare credentials were unavailable. CI must pass the migration and
probe before deployment. Production migration remains separately approved and
requires a measured build/quota plan. No production changes were made.

## Verification and reproduction

Install the root and experiment locked dependencies. Run:

```sh
node experiments/better-auth/application-d1-cost.mjs
node experiments/better-auth/application-d1-cost.mjs --history
node experiments/better-auth/application-d1-cost.mjs --mixed
```

Counters come from local Miniflare D1 using real handlers/client helpers. Setup is
excluded from workload totals; no remote billing, CPU, latency, abuse or concurrent
capacity is asserted. Raw results are in `2026-09-17-history-candidates.json`.
Tests cover growing unrelated private history, relevant deep history, owner and
grant revocations, cutoff/ID ordering, pagination, local bootstrap and idempotent
migration/probes. Manual Sync regression verifies that an unchanged local record
missing from the cloud is still uploaded with no automatic dirty changes. Existing
tombstone and in-flight-edit recovery tests remain intact.

Remaining capacity work: representative public/shared history and daily operation
mix, updated write budget, index storage/build costs, and full auth integration
costs. These improvements do not by themselves approve the authentication cutover.
