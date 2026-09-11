# Revised activity model using the existing maintainer sample

Status: conditional request projection; overall capacity gate remains pending.
Follow-up [real-handler D1 measurements](2026-09-11-application-d1-cost.md) fail
the database gate for the synthetic 1,000-account workload. They also measure
82 total requests for a specific 400-record recovery, including actual server
phase transitions. Retain the historical 62-request maintainer sample below;
do not use the earlier mock as real-server cost evidence or a universal bound.
Keep the 1,000 registered-user target and the approved 1,000-DAU sensitivity.
Manual Sync remains a forced full-recovery action with its current behavior.

## Evidence and the maintainer's clarification

The staged browser capture reported 51 completed API entries: 39 library,
6 notifications, 1 profile and 5 unclassified. Capture ran for 113 seconds;
page age was 155 seconds and 81 resource entries were already buffered at start.
HTTP status was unavailable. This is not a clean 113-second request rate.
The maintainer described editing two Sites, adding a Path, switching Simulation
twice, running calculations and changing map layers. Do not assert the exact
GET/PUT composition or subtract the later manual-sync count from this sample.

Separate isolated checks reported:

- One Site edit: one library request. The supplied JSON confirmed success,
  one upserted Site, one upserted Simulation and no conflicts. The response does
  not measure D1 writes; the endpoint code identifies the save as a PUT.
- One Simulation switch: one library request, method not recorded.
- One forced manual Sync: 62 library requests, methods not recorded.

Using the actual client helper code with 400 synthetic small records and mocked
20-record server pages reproduced 62 requests: 42 GETs (including two recovery
GETs) and 20 PUTs. This explains a mechanism, not the maintainer's exact record
count or observed method breakdown. Byte limits and visibility can change counts.

The maintainer clarified that Manual Sync is rarely used and exists to force
full recovery when something fails. Preserve its full upload, deletion checks,
permission-revocation checks and recovery passes. Do not skip uploads based only
on local synced flags. Treat 62 as a sample recovery cost, not a normal edit cost
or a universal upper bound. No sync optimization is authorized by this document.

Controlled component evidence separately showed one notice fetch per page load,
zero ordinary-user notification polls and 121 administrator polls for a one-hour
open chip. Previously delivered traffic reductions are in staging, not production.

## Request model with explicit, separate assumptions

Let A be ordinary protected app requests/day, excluding privileged notification
polling and forced recovery. A includes app bootstrap/library loading, edits,
Simulation switches and ordinary automatic sync. The 30-per-DAU assumption is
retained from the approved scenario; the short sample does not validate it. A
bootstrap-heavy day may exceed it: the supplied sample contains 45 non-notification
entries, including buffered startup and five unclassified entries. Do not claim
30 requests is a measured average or an established conservative bound.

For an illustrative privileged workload assume three administrator tabs, each
open four hours once per day: P = 3 * (1 + 120 * 4) = 1,443 polls/day. This is a
planning input, not observed admin usage. Let M be forced recovery syncs/day
across the entire project, with sampled cost 62 each. Ten/day is an explicit
allowance example (1% of 1,000 accounts), not a measurement of "rarely".

Retain the earlier non-app request allowances: 3,000 login/session, 1,000 notices,
5,000 staging, 1,000 other Workers and 5,000 abuse. Add 1,000 explicit logout
requests to match the previously accepted daily-logout D1-write sensitivity;
those requests were not explicit in the old 45,000-request table.

- Account Worker requests: A + P + 62*M + 16,000.
- Object requests: A + P + 62*M + 14,000 (exclude notices/other Workers).

These formulas intentionally classify P and recovery outside A. When measuring
aggregate app traffic, partition it first rather than adding them again. The
staging/abuse allowances already include their own app/auth activity; do not add
another copy for those environments. Guest traffic beyond the notice allowance,
extra page loads/logins/devices, and other auth ceremonies can use remaining room.
Static asset requests are not counted as protected APIs here.

| App requests per daily-active user (1,000 DAU) | Recovery syncs across project/day | Worker requests/day | Object requests/day |
|---:|---:|---:|---:|
| 30 | 0 | 47,443 | 45,443 |
| 30 | 10 | 48,063 | 46,063 |
| 30 | 100 | 53,643 | 51,643 |
| 50 | 10 | 68,063 | 66,063 |

Cloudflare's stated free daily allowances are 100,000 Worker requests and
100,000 Object requests. Under the 30-request/10-recovery assumptions the request
dimension fits the original 50% planning target, leaving only 1,937 requests
before that target (not before hard exhaustion). The 50-request scenario fits
neither 50% target; this is sensitivity, not permission to waive the gate.
No maximum-user guarantee follows from these numbers.

## D1 and acceptance

Do not convert HTTP requests or upserted resource counts to D1 rows written.
A resource save can execute multiple statements and update indexes. The accepted
53,700-write scenario and the later 81,600–93,000 aggregate sensitivities remain
historical, conditional estimates. They mixed ordinary, administrator and recovery
work; the user clarification does not quantify their split. Neither 53,700 nor
any lower revised write forecast is newly validated by this request model.
Do not add every recovery write onto that historical aggregate without first
removing whatever recovery/admin work it already contains.

Existing runtime evidence remains: first anonymous gateway invocation 3 ms CPU,
startup separately reported 4 ms, and prior authenticated warm/burst traces.
Full authenticated first-invocation/Pages integration, library-backed failure
behavior, D1 workload costs/maintenance/storage and post-cutover monitoring remain
gates. No production change or application account migration is authorized here.

This incorporates the maintainer's already completed capture and isolated checks.
Do not ask for another equivalent capture as if they were missing. The remaining
work is agent-side D1 cost attribution with synthetic normal and recovery workloads,
and completion of the outstanding runtime/integration evidence. A later production
baseline still requires a separately approved release.

Sources checked when revising:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
