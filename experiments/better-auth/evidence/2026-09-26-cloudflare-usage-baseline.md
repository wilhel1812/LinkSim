# Cloudflare alert audit and pre-cutover usage baseline (2026-09-26)

Status: **complete under the provider-limited alert control approved on
2026-09-26.**
The measured daily usage and monthly operation figures are below their approved
warning thresholds. LinkSim R2 storage is below its caps, while known unrelated
non-history R2 storage remains above the approved stop threshold under the
bounded billing exception in #1192. The current Wrangler OAuth session cannot
read Cloudflare Notifications. A subsequent configuration-read-only dashboard
review confirmed two enabled email billing-budget alerts, including a
LinkSim-specific emergency spend warning, and verified that the inspected
recipient matches the active Cloudflare account operator. A test notification
for the LinkSim-specific alert was dispatched and the maintainer confirmed
receipt at **2026-09-26 20:06 CEST (18:06 UTC)**. This confirms billing-alert
delivery. A later dashboard check found that the account's native
`Usage Based Billing` product selector does not offer D1, Workers/Pages or
Durable Objects metrics, so the maintainer approved the provider-limited
control recorded below instead of treating an unavailable alert as a permanent
release blocker.

The account and configuration audit was read-only. Its sole side effect was the
explicitly approved test-email dispatch, which may also create provider
notification-history state. It did not change notification policies, recipients,
thresholds, billing, databases, buckets, deployments, bindings, application
behavior, authentication configuration or production state. Account and
recipient identities, the unrelated R2 bucket name, and its exact private
inventory are omitted from public evidence.

## Measurement window and tools

Wrangler 4.131.0 and the Cloudflare GraphQL Analytics API were queried between
**2026-09-26T16:45:51Z and 2026-09-26T16:49:21Z**. Daily figures below cover
the current UTC day through the query time and may be incomplete because the
day had not ended and provider analytics can lag. The previous complete UTC
day is included for Workers/Pages comparison. D1 metadata came from `wrangler
d1 info`; account-wide usage, Pages Functions, standalone Workers, Durable
Objects and R2 operations came from current GraphQL datasets.

## Current resource baseline

| Resource | Current provider value | Approved first warning | Result |
| --- | ---: | ---: | --- |
| Workers requests, account-wide today | 3,407 | 70,000/day | 4.9% of warning |
| Durable Object requests, account-wide today | 180 | 70,000/day | 0.3% of warning |
| Durable Object duration, account-wide today | 1.543 GB-s | 9,100 GB-s/day | less than 0.1% of warning |
| D1 rows read, account-wide today | 78,423 | 3,500,000/day | 2.2% of warning |
| D1 rows written, account-wide today | 4,785 | 70,000/day | 6.8% of warning |
| Production D1 storage | 90,857,472 bytes (90.86 MB) | 450 MB | 20.2% of warning |
| Total account D1 storage | 142,852,096 bytes (142.85 MB) | 4 GB | 3.6% of warning |
| R2 Class A operations, September to date | 5,522 | 700,000/month | 0.8% of warning |
| R2 Class B operations, September to date | 18,238 | 7,000,000/month | 0.3% of warning |

The D1 daily total comprises 32,298 rows read and 335 rows written in
production plus 46,125 rows read and 4,450 rows written in staging. The third,
disposable validation database had no row-usage sample and occupied 102,400
bytes. Production and staging D1 sizes were 90,857,472 bytes and 51,892,224
bytes respectively.

Cloudflare reports Pages Functions separately from standalone Workers. Pages
Functions accounted for all 3,407 account requests observed today: 2,670 on
the production project and 737 on the staging project, with zero provider-
reported errors. No standalone Worker request was returned for the current
day. On the previous complete UTC day, Pages recorded 4,260 requests and the
disposable validation Worker recorded one successful request, for an account-
wide total of 4,261. Pages therefore supplies both the Pages-specific baseline
and the dominant contribution to the approved Workers-request trigger.

The only Durable Object activity observed today belonged to the staging auth
runtime: 180 successful requests, zero errors, and 1.543265152 GB-s of reported
duration. No production auth runtime is active.

R2 operation classification follows Cloudflare's current pricing reference.
Of the account-wide September-to-date totals, LinkSim buckets contributed 152
Class A and 624 Class B operations. Delete operations were excluded from the
Class A/B trigger totals. The same-day post-provision storage inventory remains
the storage baseline: LinkSim buckets total approximately 8.82 MB, production
history is empty, staging history is 824 kB, and combined history is below the
6 GB cap. The unrelated quota-sharing bucket remains above 10 GB under the
bounded billing decision in #1192.

## Notification and billing-alert audit

At **2026-09-26T16:45:51Z**, read-only requests to Cloudflare's notification
policy, history and eligible-destination endpoints each returned HTTP 403
authentication errors. `wrangler whoami` confirms that the active OAuth token
has deployment and analytics access but not Notifications read access. This is
an access limitation of the audit credential, not evidence that policies are
missing or disabled.

At approximately **2026-09-26T17:17Z**, a read-only authenticated dashboard
review showed two enabled `Billing Budget Alert` policies using email delivery:
the account's existing budget alert and `LinkSim emergency spend warning`. The
inspected policy's recipient matches the active account owner/operator. The
recipient address and alert thresholds are intentionally omitted from public
evidence. No policy field was saved or changed.

At approximately **2026-09-26 18:06 UTC**, Cloudflare's dashboard test action
was confirmed for `LinkSim emergency spend warning`. The maintainer confirmed
receipt at **20:06 CEST (18:06 UTC)**. This proves that the enabled
billing-budget policy can reach the actively monitored operator destination.
It does not prove that a separate Cloudflare resource-usage notification policy
exists or reaches that destination. No notification policy, recipient or
threshold was created or changed.

At approximately **2026-09-26 19:04 UTC**, the authenticated dashboard exposed
the `Usage Based Billing` alert type, but its product selector contained only
`R2 Storage`, `R2 Storage Class A Operations`, and
`R2 Storage Class B Operations`. It did not offer D1 rows read/written,
Workers/Pages requests, or Durable Objects requests/duration for this account.
The empty form was cancelled; no usage alert, recipient, threshold or policy was
created or changed.

The maintainer therefore redefined this pre-cutover control to require all of
the following evidence together:

1. successful delivery of the account-wide billing-budget warning to the active
   operator;
2. a dated provider baseline for D1, Workers/Pages, Durable Objects and R2; and
3. manual review of those metrics against the approved warning, intake-stop and
   rollback triggers before cutover and during the first-hour, first-day and
   first-week monitoring windows.

This is a documented provider limitation, not a claim that Cloudflare sends
native warning notifications for every resource metric. A future native alert
may supplement the control when the account becomes eligible and the required
metric appears in the dashboard.

## Decision

The daily D1, Workers and Durable Objects usage figures and monthly R2 operation
figures pass with wide headroom. LinkSim history storage remains below its caps;
the unrelated non-history R2 storage exception is unchanged and must not be
described as below the warning or stop thresholds. Billing-alert delivery to an
active operator is confirmed, and the provider-limited monitoring control above
completes this release-preparation gate. This file does not authorize production
promotion, authentication cutover, archive activation or a billing change.

Sources: [Cloudflare Notification History](https://developers.cloudflare.com/notifications/notification-history/),
[D1 metrics and analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/),
[Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/),
[Durable Objects metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[R2 metrics and analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/),
and [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
