# Application D1 workload measurements

This is the pre-optimization baseline. See the subsequent
[query optimization and remaining limits](2026-09-11-query-optimization.md).

Status: **the synthetic stress workload exceeds the database budget**. This is
not evidence that the 1,000-registered-user target fails. The maintainer clarified
that 1,000 daily active users was not their requirement. Keep the registered-user
target at representative activity, but do not proceed to application identity migration on
the strength of the earlier linear forecast. No production changes or Manual
Sync behavior changes are part of this batch.

## Reproduction and scope

From the repository root, after installing root and experiment dependencies:

```sh
node experiments/better-auth/application-d1-cost.mjs > application-d1-cost.json
```

The script bundles the actual library, profile and notification handlers and
the actual client pagination/batching helpers into memory. They execute against
ephemeral local Miniflare D1 with the canonical schema and application schema
initialization. No remote configuration, secrets, database or provider is used.
The existing explicit development-auth path supplies a synthetic identity.
Application behavior is from staging `5e9bfd5bed278a9c3293e5579547a160100dc27d`.

The fixture has 1,000 accounts. Each of 999 background accounts owns ten private
Sites and two private Simulations. The measured account starts with the same
library, then grows to 350 Sites and 50 Simulations for recovery sensitivity.
Background rows have minimal payloads and no grants or history; the measured
account's validated records and history are created through the actual handlers.
This is an explicit fixture, not an estimate of the maintainer's library size.

Counters are returned local D1 `meta.rows_read`/`rows_written`, including index
work. Calibration checks an indexed write and scalar/empty first-row reads.
Because `first()` hides metadata, the wrapper executes the identical SQL through
`all()` and returns its first row/column. Batch results are counted individually.
No SQL parameters or credentials are logged. Setup is separated from operations.
Results include legacy identity checks, not Better Auth or Access verification.

The captured counters, including per-route/phase attribution, are in
[`2026-09-11-application-d1-cost.json`](2026-09-11-application-d1-cost.json).

These are local SQL measurements, not remote billing, latency, gateway CPU or
concurrency evidence. Production query plans, data skew, sharing and accumulated
history can change costs. Empty background history is not a worst-case fixture.
The full-recovery sequence uses fetched, all-owned records: read deletion state,
upload everything, read again. It does not exercise failed uploads, revocation,
conflicts or unsynced local changes; existing store tests cover those semantics.

## Measurements

| Operation | HTTP requests | SQL statements | Rows read | Rows written |
|---|---:|---:|---:|---:|
| Warm legacy identity check alone, already included below | 0 | 4 | 10 | 3 |
| Profile | 1 | 5 | 11 | 3 |
| Load 10 Sites and 2 Simulations | 12 | 84 | 96,374 | 36 |
| Empty delta | 12 | 84 | 96,122 | 36 |
| Edit one Site and one Simulation | 1 | 18 | 43 | 13 |
| Save one Simulation | 1 | 12 | 24 | 8 |
| Administrator notification poll | 1 | 6 | 12 | 3 |
| Full recovery, 12 records | 25 | 227 | 192,909 | 135 |
| Full recovery, 400 records | 82 | 2,226 | 228,375 | 2,246 |

First schema initialization plus new identity, before the background fixture,
cost 46 statements, 95 reads and 13 writes. It is not a representative cold
request against an established production database and is excluded below.

The real server has six pagination phases, including deletion and revocation
phases, and the client drains another delta pass. A small full load therefore
uses twelve GETs even when almost all phases are empty. The 400-record recovery
uses 62 GETs and 20 PUTs. The earlier mock's 62 **total** requests omitted real
server phase transitions; it was explanatory, not a server workload result.
The maintainer's independently observed 62 total requests remains valid as a
sample, with unknown method and library-size breakdown.

For the empty delta, the two `removed_sites` phase requests read 59,986 rows and
the two `removed_simulations` requests read 12,018. Ordinary Sites/Simulations
phases read 20,024/4,024 respectively. Deleted phases account for the remaining
70. This local attribution points to both ordinary visibility selection and
revoked-access candidate selection, rather than response size or OAuth.

## Capacity implication

One such small-library load for each of 1,000 daily active accounts alone costs
**96,374,000 reads/day**, before authentication, other activity or staging. Even
subtracting all measured legacy identity work leaves 96,254,000. Replacing
Access verification with Better Auth therefore cannot by itself fix this cost.

For an explicit 30-request sensitivity per daily active account, use one load
(12), one empty delta (12), one profile (1), two Site-plus-Simulation edits (2),
and three Simulation saves (3). This is an assumption, not observed behavior.
It totals **192,665 reads and 125 writes per account/day**, or **192,665,000 reads
and 125,000 writes** for 1,000 DAU. Three administrator tabs open four hours each
add 1,443 polls: 17,316 reads and 4,329 writes. Ten 400-record recoveries add
2,283,750 reads and 22,460 writes. The application subtotal is **194,966,066 reads
and 151,789 writes/day**. Do not add the old 20-times historical application
baseline to this subtotal; that would count application work twice.

Keep auth costs separate: the prior probe measured two reads and zero writes for
a warm session check, with extra renewal/initialization costs; indexed returning
OAuth was 18 writes in one sequence and 19 in another, logout five, and limiter
cleanup seven reads/two writes in its test. For 32,263 protected app requests in
the above scenario, warm session checks add 64,526 reads. The prior renewal,
public-session, staging and abuse/cleanup reserves still apply, as do login and
logout costs. No complete combined acceptance total is claimed: the application
subtotal already exceeds both daily free quotas before those additions.

For this synthetic recovery size the request forecast is 48,263 Worker requests
and 46,263 object requests, using the earlier 16,000/14,000 fixed allowances.
Passing the request-count target does not rescue the database gate.

Cloudflare currently includes 5 million D1 reads and 100,000 writes per day on
Free; the planning target is half those allowances, with only the previously
accepted **53,700-write scenario** excepted. This result exceeds that exception
and the hard limits. It does not prove a maximum supported registered-user
count: resource population and daily activity are independent variables.
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 return metadata](https://developers.cloudflare.com/d1/worker-api/return-object/).

## Next bounded change to approve

Investigate and optimize the existing library read queries, preserving all six
phases, visibility, grants, deletion and revocation semantics. In particular,
`fetchLibraryForUser()` combines broad visibility predicates and per-resource
history checks; `removedRowsFor()` starts from other users' private resources.
Use this harness to verify that empty deltas and small owned libraries no longer
scan the whole population, alongside the existing authorization regression tests.
Do not omit revocation checks or reduce Manual Sync's recovery behavior.

Also plan to replace unconditional legacy identity reconciliation on every
request with the approved mapping and current-account-state checks during auth
integration. Its measured three writes/request are not free, but savings remain
unproven until implemented and measured with the required security semantics.

The notification handler currently returns empty items for administrators and
ordinary users alike. Its privileged polling is a separate consolidation
opportunity; changing it is outside this measurement batch. No additional manual
browser capture is needed to establish the SQL issue above.
