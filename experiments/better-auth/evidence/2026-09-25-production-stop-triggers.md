# Production authentication stop and rollback triggers (2026-09-25)

**Decision:** the maintainer approves these manual production safeguards for the
0.29.0 authentication transition. `wilhel1812` is both the operator authorized
to apply them and the maintainer reviewer who approved them in the auth epic
thread on 2026-09-25. This evidence does not authorize the production cutover.

The target remains **1,000 registered accounts with activity comparable to the
current population**. The values below protect the transition while real
production use replaces the dated sensitivities. They do not claim that 1,000
daily active accounts are required or proven.

## Daily service quotas

Use the latest available account-wide Cloudflare daily metrics. Record their
timestamp because dashboard data can lag. A threshold on one resource is enough
to take its action; do not average different resources together.

| Resource | Warning | Stop new account intake | Start rollback if use continues after intake stops | Free daily allowance |
| --- | ---: | ---: | ---: | ---: |
| Workers requests | 70,000 (70%) | 80,000 (80%) | 90,000 (90%) | 100,000 |
| Durable Object requests | 70,000 (70%) | 80,000 (80%) | 90,000 (90%) | 100,000 |
| Durable Object duration | 9,100 GB-s (70%) | 10,400 GB-s (80%) | 11,700 GB-s (90%) | 13,000 GB-s |
| D1 rows read | 3,500,000 (70%) | 4,000,000 (80%) | 4,500,000 (90%) | 5,000,000 |
| D1 rows written | 70,000 (70%) | 80,000 (80%) | 90,000 (90%) | 100,000 |

The warning level starts investigation and increases monitoring. The intake
stop disables `AUTH_REGISTRATION_ENABLED`, `AUTH_LEGACY_CLAIM_ENABLED`, and
`AUTH_DUAL_LOGIN_MIGRATION_ENABLED`; existing mapped sessions and credentials
remain valid. Stop bounded archive maintenance as well if D1 writes triggered
the action. Do not re-enable a gate until a fresh daily window and a reviewed
cause show adequate headroom.

The 1,000-account sensitivities remain below the warning or intake-stop lines
except that the 50-request Worker/DO stress case approaches the 70% warning:
68,063 Worker requests, 66,063 object requests, 2.235 million D1 reads, up to
61,700 D1 writes with archive maintenance, and 3,072 GB-s object duration.
Those figures are models, not live measurements.

## Monthly R2 operation quotas

Use account-wide R2 operation metrics for the current billing month. Storage,
Class A operations, and Class B operations are independent gates; remaining
storage does not provide operation headroom.

| Resource | Warning | Stop new account intake and non-essential R2 operations | Start rollback if use continues after the stop | Free monthly allowance |
| --- | ---: | ---: | ---: | ---: |
| R2 Class A operations | 700,000 (70%) | 800,000 (80%) | 900,000 (90%) | 1,000,000 |
| R2 Class B operations | 7,000,000 (70%) | 8,000,000 (80%) | 9,000,000 (90%) | 10,000,000 |

At the stop line, disable registration, claims, and migrations and stop archive
maintenance, verification scans, retries, and other non-essential R2 work.
Existing mapped users may continue normal reads while the operator identifies
which buckets and operation classes are growing. Do not resume until a fresh
account-wide measurement and reviewed cause show adequate monthly headroom.

## Resource-limit and availability failures

- One successful production Pages/Worker gateway invocation above the 10 ms
  Free CPU budget warns immediately; elapsed time is not CPU time. Stop new
  account intake if three such CPU overruns occur within five minutes, or if a
  five-minute window with at least 20 measured gateway invocations reaches
  8 ms p95 CPU. Start the ordered rollback if, after intake stops, another
  three overruns occur within five minutes or the measured five-minute p95
  reaches 10 ms. Durable Object duration remains governed by the separate
  daily quota above; its resource-limit responses still trigger the rules below.
- Measure Worker startup CPU separately from request CPU for every deployed
  gateway version using Cloudflare's reported `startup_time_ms`, and retain a
  known cold-isolate observation with platform startup telemetry. Warn at
  700 ms startup CPU, keep or turn new account intake off at 800 ms, and start
  the ordered rollback at 900 ms, preserving headroom below Cloudflare's
  1-second startup limit. Missing startup telemetry leaves the cold-gateway
  release gate open; warm request CPU and elapsed-time measurements cannot
  substitute for it.
- One confirmed Cloudflare resource-limit response attributable to LinkSim
  immediately stops new registration, automatic claims, dual-login migrations,
  and archive maintenance while the operator records the service, timestamp,
  route class, and latest quota metrics.
- Start the ordered rollback when three protected application or session-check
  requests fail with resource-limit responses within five minutes after intake
  has stopped. A successful static shell response does not cancel this trigger.
- Start the ordered rollback regardless of total traffic when the scheduled
  post-cutover canary has one qualifying availability failure that still fails
  after one retry. This includes a timeout, connection failure, retryable `5xx`,
  or unexpected `401`/`403`. Also roll back when an independently confirmed
  unexpired, unrevoked session attached to an allowed account receives three
  unexpected `401`/`403` responses within five minutes. Before cutover,
  configure and verify the protected canary to run
  once per minute through the first hour, once every five minutes for the rest
  of the first day, and once every fifteen minutes through the first week. A
  missing or unhealthy canary leaves the cutover gate open; natural traffic is
  not a substitute for this schedule.
- Start the ordered rollback when at least 20 protected application or
  session-check requests are observed in five minutes and 5% or more have a
  qualifying availability failure after one retry. A qualifying failure is a
  timeout, connection failure, retryable `5xx` response, or an unexpected
  authentication `401`/`403`. Treat a repeated `401`/`403` as unexpected when it
  affects the designated post-cutover canary or a previously successful session
  that is independently confirmed unexpired, unrevoked, and attached to an
  allowed current account. Expected `4xx` responses from missing, expired, or
  revoked credentials, authorization denial, not-found, conflict, and application
  rate limiting do not count. A confirmed Cloudflare resource-limit response
  follows the separate immediate-stop rule above. An unrelated upstream provider
  outage also does not count toward this application rollback trigger.
- Any verified authentication-boundary bypass, cross-account identity result,
  or inability to revoke a session starts rollback immediately, independent of
  quota percentages.

## Storage triggers

Cloudflare's reported D1 database size is the operating measure. Use R2 object
size, not request count, for the archive caps.

| Storage condition | Required action |
| --- | --- |
| Production D1 reaches 450 MB | Warn, verify the growth rate and archive health, and review daily until below 450 MB. |
| Production D1 reaches 475 MB | Stop registration, claims, and migrations. Continue only already-approved bounded archive maintenance when it is healthy and D1-write headroom remains. |
| Production D1 reaches 490 MB | Start the Access-first/read-only rollback and stop non-essential D1 mutations. |
| Total account D1 storage reaches 4 GB | Warn, inventory every database, classify growth, and review daily until below 4 GB. |
| Total account D1 storage reaches 4.5 GB | Stop registration, claims, migrations, archive maintenance, and other non-essential D1 writes. |
| Total account D1 storage reaches 4.9 GB | Start the Access-first/read-only rollback before the 5 GB account ceiling. |
| Either history bucket reaches 2.5 GB or both reach 5 GB | Warn, inventory objects, verify retention and growth, and obtain a fresh estimate. |
| Either history bucket reaches 3 GB or both reach 6 GB | Stop archive writes and maintenance. Another maintainer decision is required before accepting more LinkSim R2 storage or cost. |
| Non-history R2 reaches 3.5 GB | Warn, rerun the complete account inventory, classify growth by bucket, and obtain a fresh LinkSim cost estimate. |
| Non-history R2 exceeds 4 GB | Stop archive writes and maintenance. Do not resume under a Free-tier claim until account isolation or data reduction restores the reserve; a billing exception requires another explicit maintainer decision. |
| LinkSim-attributable R2 cost is projected above the accepted approximately $0.06/month sensitivity | Stop archive expansion and obtain another maintainer decision before accepting the higher estimate. |

The production-database D1 thresholds leave 50 MB, 25 MB, and 10 MB
respectively below the conservative 500 MB ceiling. The account-wide values
leave 1 GB, 500 MB, and 100 MB below the 5 GB ceiling. The 476.3 MB
1,000-account fixture is therefore a narrow sensitivity near the intake-stop
line, not evidence that growth can go unobserved. Reaching the target requires
the archive path to keep live D1 below both sets of thresholds. For the R2 Free
envelope, reserved history capacity is
`10 GB − non-history R2`: the 3.5 GB warning preserves 6.5 GB and the 4 GB stop
preserves 6 GB. Combine that calculation with the separate 3 GB per-history-
environment and 6 GB combined-history caps; do not interpret "headroom" as
unused capacity after subtracting both history and non-history storage. The
existing maintainer acceptance covers the dated LinkSim-attributable
approximately $0.06/month sensitivity only; it does not convert unrelated
growth into unlimited LinkSim headroom.

## Ordered response and recovery

For an intake stop, use reviewed production configuration to turn off the three
provisioning gates, preserve all mappings and credentials, and verify that an
existing mapped user can still sign in and sync. Record the exact deployment
and observation.

For rollback, follow the production cutover checklist in order:

1. keep registration, claims, migrations, and archive maintenance disabled;
2. restore broad `/api/*` Cloudflare Access protection and verify its exact
   audience;
3. deploy the reviewed transition/read-only fallback;
4. preserve Better Auth tables, identity mappings, passkeys, sessions, audit
   history, ownership, and local work.

Broad Access cannot serve every newly registered Better Auth user, so rollback
is a containment state rather than normal service. Do not delete their accounts
or remap them. Reopening requires a recorded cause, fresh quota/storage
measurements below the warning lines, successful boundary/session checks, and a
separate maintainer decision.

Review the metrics and errors during the first hour, first full day, and first
week. Record warnings even when no stop action is taken so the 1,000-account
model can be revised from actual production use.

Sources: [staging release readiness](2026-09-25-auth-staging-release-readiness.md),
[registered-account capacity decision](2026-09-18-registered-capacity-decision.md),
[R2 storage decision](2026-09-25-r2-storage-capacity.md), and the
[production cutover checklist](../../../docs/production-auth-cutover-checklist.md).
