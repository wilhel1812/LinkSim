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

## Resource-limit and availability failures

- One confirmed Cloudflare resource-limit response attributable to LinkSim
  immediately stops new registration, automatic claims, dual-login migrations,
  and archive maintenance while the operator records the service, timestamp,
  route class, and latest quota metrics.
- Start the ordered rollback when three protected application or session-check
  requests fail with resource-limit responses within five minutes after intake
  has stopped. A successful static shell response does not cancel this trigger.
- Start the ordered rollback when at least 20 protected application or
  session-check requests are observed in five minutes and 5% or more fail after
  one retry, unless the failures are demonstrated to be a single user's invalid
  credential or an unrelated upstream provider outage.
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
| Either history bucket reaches 2.5 GB or both reach 5 GB | Warn, inventory objects, verify retention and growth, and obtain a fresh estimate. |
| Either history bucket reaches 3 GB or both reach 6 GB | Stop archive writes and maintenance. Another maintainer decision is required before accepting more LinkSim R2 storage or cost. |
| Non-history R2 reaches 3.5 GB or less than 6.5 GB remains inside the account's 10 GB Free storage allowance | Warn, rerun the complete account inventory, classify growth by bucket, and obtain a fresh LinkSim cost estimate. |
| Non-history R2 exceeds 4 GB or less than 6 GB remains inside the account's 10 GB Free storage allowance | Stop archive writes and maintenance. Do not resume under a Free-tier claim until account isolation or data reduction restores the reserve; a billing exception requires another explicit maintainer decision. |
| LinkSim-attributable R2 cost is projected above the accepted approximately $0.06/month sensitivity | Stop archive expansion and obtain another maintainer decision before accepting the higher estimate. |

The D1 thresholds leave 50 MB, 25 MB, and 10 MB respectively below the
conservative 500 MB ceiling. The 476.3 MB 1,000-account fixture is therefore a
narrow sensitivity near the intake-stop line, not evidence that growth can go
unobserved. Reaching the target requires the archive path to keep live D1 below
these thresholds. R2 account headroom is recalculated from total storage rather
than treating unrelated buckets as outside the allowance. The existing
maintainer acceptance covers the dated LinkSim-attributable approximately
$0.06/month sensitivity only; it does not convert unrelated growth into
unlimited LinkSim headroom.

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
