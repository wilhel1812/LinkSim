# 1,000 registered accounts: capacity decision (2026-09-18)

**Decision updated September 19: qualified acceptance for reversible staging
schema only.** The maintainer accepted the evidence below for installing the
additive Better Auth schema and identity-map primitive on staging. The target
remains **1,000 registered accounts with activity comparable to the current
population**. This does not approve production schema, auth runtime, routes,
credentials, archive writes, Access removal or cutover. Account-wide runtime
and quota gates remain open before those steps. Production remains on Access.
This decision uses existing observations; it adds no new live measurement.

**Later same-day update:** [representative physical storage](2026-09-18-representative-physical-storage.md)
measured 32.60 MB before and 23.77 MB after synthetic projection, with a
further 0.92 MB for a 1,000-account auth probe allowance. A staging-like
20-fold sensitivity now gives 476.3 MB, only 4.7% below the conservative
500 MB ceiling. The maintainer accepted the earlier narrow storage-only
sensitivity as a planning risk; do not reopen that accepted margin as a new
approval gate. This experiment does not settle the larger production-vs-staging
mix difference or the account-wide request/write/CPU measurements. It makes
physical savings and archive write amplification measured for one fixture,
while the overall capacity gate remains open for those other reasons.

## Request sensitivity, not a daily-active target

The [activity model](2026-09-11-revised-activity-model.md) separates ordinary
protected app requests from a **hypothetical** 1,443 administrator notification
requests, ten sampled 62-request full-recovery syncs and 16,000 account-wide
login, logout, staging, notice, other-Worker and abuse requests per day. Its
formula is `Worker requests = daily active accounts * app requests per active
account + 18,063`; the private object has 2,000 fewer requests. The fixed
reserves are planning assumptions, not measurements. The 30- and 50-request
activity figures are likewise sensitivities, not measured averages. Existing
staging capture cannot establish a daily request rate or active-user fraction.

| Daily active out of 1,000 registered | 30 app requests/active | 50 app requests/active |
| ---: | ---: | ---: |
| 50 | 19,563 Worker / 17,563 object | 20,563 Worker / 18,563 object |
| 100 | 21,063 / 19,063 | 23,063 / 21,063 |
| 250 | 25,563 / 23,563 | 30,563 / 28,563 |
| 500 | 33,063 / 31,063 | 43,063 / 41,063 |
| 1,000 (stress case, **not** the target) | 48,063 / 46,063 | 68,063 / 66,063 |

The account-wide free allowances are currently 100,000 Worker requests/day and
100,000 object requests/day. With these reserves, the 50%-of-allowance planning
line would allow at most about 1,064 daily active accounts at 30 ordinary
requests each, or 638 at 50. That is a **request-only conditional threshold**,
not a supported-user count. The one observed production 24-hour count of 5,824
successful Pages requests was on the older 0.28.1 tree without the staging
traffic reductions; multiplying it by 20 would yield 116,480 requests, but
would mix changed software and unknown activity. Do not use it as a forecast.
Static assets, guest traffic, additional devices and attack spikes need their
own attribution before acceptance.

## D1 and object costs

The [disposable Better Auth experiment](2026-09-11-capacity.md) measured a warm
session check at one D1 query/two rows read/no write and an aged renewal at two
queries/four rows read/one write. OAuth and rate-limit operations cost more;
the local returning initiation/callback examples varied between 18 and 19
writes, with environment and counter state affecting them. The earlier
**53,700 D1 writes/day** scenario is an explicitly accepted *sensitivity*, not
an observed account-wide total, a maximum, or an exception for other quotas.
It includes the previous application baseline extrapolation plus assumed
login/session/logout, staging and abuse writes. Do not add the same allowances
again. Current application query optimizations and [full-recovery costs](2026-09-17-history-candidates.md)
have not been reconciled into a measured representative daily mix. The last
normal/recovery D1 row counts are per fixture, not per account/day. Actual
billable object duration and persistent rate-limit cleanup over time are also
not proven by the one-tester or local workload.

The 50-concurrent session test and 20 simultaneous OAuth-initiation test passed
in their respective samples; [live session telemetry](2026-09-11-capacity.md)
reported gateway CPU average 1.407 ms/max 3 ms and object CPU average 2.661
ms/max 47 ms across 59 requests. The [deployed staging archive probe](2026-09-18-history-deployed-cpu.md)
recorded at most 6 ms CPU for either invocation of one small synthetic-row
operation. Neither establishes a cold authenticated Pages request or a
representative application-wide CPU distribution. Elapsed milliseconds are
not CPU milliseconds; success during an occasional overrun is not headroom.

## Storage is the critical unresolved constraint

This section preserves the September 18 lower-bound evidence. The later
[R2 storage capacity decision](2026-09-25-r2-storage-capacity.md) supersedes its
2.77 GB payload-only estimate with an envelope-inclusive 3.31 GB point
sensitivity, a 6 GB combined operating cap, and the current account inventory.
It qualifies the architecture for 1,000 registered accounts on an otherwise
clean account, while finding no sustained Free headroom in this account because
unrelated account use currently exceeds 10 GB. The billing-period average was
not measured.

The [read-only production snapshot](2026-09-18-d1-storage-reclamation.md)
measured 50 users and a 90,234,880-byte D1. About 69,348,172 logical bytes
in 5,426 Simulation history revisions matched the current archive
projection. Pure arithmetic gives these **illustrative, unvalidated** values:

| 20-fold copy of the observed 50-account mix | D1 bytes | Against conservative 500,000,000-byte ceiling |
| --- | ---: | ---: |
| Entire present database, no archiving | 1,804,697,600 | Exceeds by 1,304,697,600 |
| Present database less identified removable history | 417,734,160 | 82,265,840 remaining (16.5%) |
| Same projected size plus 20% growth | 501,280,992 | Exceeds by 1,280,992 |

This is *not* evidence that the archive yields 417 MB in production. Subtracting
logical payload from physical file size ignores page layout, indexes, auth
schema, ongoing history and reclamation behavior. The largest of 42 measured
history-owner groups held 25.4% of history bytes; those groups are not an
account count. A separate synthetic D1 did physically shrink when rows were
projected, but its layout does not prove that the populated application D1
will. The free limit is 500 MB **per database** and 5 GB per account, so
splitting databases is an architectural alternative requiring a separate
identity/ownership design, not a transparent escape hatch.

If all 5,426 measured candidate objects and their removable payload scaled
exactly twentyfold, they would carry **at least** about 1.39 GB of that
payload in production, or 2.77 GB with a full separate staging copy, *before*
their remaining JSON, envelopes, retained object versions, avatars and future
growth. The prototype stores the full history fields in each R2 object, so
these figures are lower bounds rather than object-size predictions. Standard R2's
current free monthly allowances are 10 GB-month storage, one million Class A
operations and ten million Class B operations. The corresponding initial
candidate count would be 108,520 objects in production and the same in staging.
At the [local private-only indexed cost](2026-09-18-history-index-cost.md)
of two D1 writes per row, **217,040 production maintenance writes** is one
sensitivity, not the estimated total: the production snapshot did not classify
candidate visibility. A [mixed-audience fixture](2026-09-18-history-mix-local.md)
wrote 236 D1 rows for 99 archives, reflecting additional index updates. The
production audience mix and write amplification must be measured before any
maintenance schedule is accepted. Even the private-only sensitivity cannot be
spent in one day within the 100,000 D1 daily write allowance. These are
planning sensitivities, not a migration schedule or proof of free R2 headroom.
R2 retention and object-read volume remain unknown.

## Required next evidence, in order

1. Complete the archive-aware operational path: a consistent sanitized
   production-to-staging refresh without production-only object references,
   authenticated revert and full Manual Sync on mixed archived/inline rows,
   missing/corrupt-object and interrupted-update behavior, rollback, and a
   bounded maintenance schedule. Keep production and staging buckets distinct.
2. Measure physical D1 size and R2 operation/storage cost on a **representative
   synthetic staging mix**, including indexes and auth-table allowance; use
   retention and user-skew sensitivities instead of claiming linear growth.
3. Reconcile current post-foundations production request volume and observed
   active fraction with account-wide D1 reads/writes, object duration,
   staging/abuse reserve and gateway/object CPU including cold authenticated
   requests. The measured activity mix must fit the 1,000-registered target.
4. Record a go/no-go decision in issue #1107 against the existing 50% normal
   daily budget, its narrow 53,700-write exception, no resource-limit errors,
   and storage margin. If it cannot pass, revise the architecture before
   application auth integration. Production cutover still needs separate
   approval even after the gate passes.

Current platform limits: [Workers](https://developers.cloudflare.com/workers/platform/limits/),
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/limits/),
[R2](https://developers.cloudflare.com/r2/pricing/). Limits and product terms
should be rechecked at the eventual release gate.
