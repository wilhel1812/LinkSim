# Controlled traffic workloads and failure handling, 2026-09-11

Status: useful component evidence; overall capacity remains pending. Target stays
1,000 registered users. No application authentication or deployment changes.

## Repeatable component measurements

Run from the repository root:

```sh
npm run test -- --run src/components/SiteNoticeBanner.test.tsx src/components/UserAdminPanel.chip.test.tsx src/store/appStore.syncDirty.test.ts src/lib/cloudNotifications.test.ts
```

Tests mount the actual components/store with fake timers and mocked network
boundaries. They measure client request intentions, not live HTTP, D1 cost,
background-tab timer throttling or complete application journeys. Initial auth,
map/terrain requests, deep links, library size and retries need separate coverage.

| Controlled workload | Result |
|---|---|
| Notice: one mount, one hour, ten focus returns | 1 notice fetch |
| Same notice test against production component at d158376c16b18f69c1e2d6b949ea7d9a5024746d | 71 notice fetches |
| Ordinary signed-in sidebar chip, one hour | 0 notification fetches; 0 profile or admin dataset fetches |
| Administrator sidebar chip, one hour | 121 notification fetches; 0 profile or admin dataset fetches |
| Initialize cloud library, add one Site, sync | 1 library GET and 1 delta PUT |
| Then ten no-change push attempts across one hour | 0 additional library requests |

The production comparison temporarily substituted only the original banner source
in the isolated worktree, ran the new one-hour assertion, and restored the source
in a finally block. The assertion failed with 71 calls instead of 1, as expected.
The current-source suite passed. Production's notice interval is 60 seconds;
focus adds another fetch. This verifies 70 avoided calls for this fixture only.
Existing tests separately retain publish/clear refresh, expiry and dismissal,
profile reuse, lazy admin datasets, concurrent notification deduplication, and
manual sync tombstone/recovery behavior.

## Capacity interpretation

Do not multiply privileged background polling by the growth of ordinary users.
For example, three continuously open administrator tabs for one hour make 363
notification calls in this fixture. That does not become 7,260 merely because
ordinary registration rises from 50 to 1,000. Separate privileged tab-hours,
ordinary sessions, guest page loads and editing/sync activity in the model.

For N one-hour sessions with ten focus returns, notice reduction is 70*N. N is
unknown in the historical dashboard snapshot; do not subtract that formula from
5,824 daily requests using a guessed session count. Likewise, 3,030 SQL notice
reads cannot be subtracted as HTTP requests. The earlier 116,480/day and
81,600–93,000 writes/day linear sensitivities remain unvalidated; these tests do
not replace them with a new accepted capacity claim.

The maintainer has since supplied a staged request capture and isolated edit,
Simulation-switch and manual-Sync counts. See
[the revised activity model](2026-09-11-revised-activity-model.md), which preserves
Manual Sync as rare forced recovery and supersedes the request for another
equivalent user capture. Those observations do not measure D1 rows or establish
a daily active-user average.

## Quota and resource failures

The probe unit suite now injects documented D1 daily-read/daily-write errors at
the auth boundary after a successful session check. Fifty concurrent calls and
fresh initialization fail closed with generic 500 responses, no session cookie
or prior identity. A subsequent check recovers after the injected failure clears.
The gateway separately converts thrown binding resource failures into a generic
503 without a cookie or automatic retry, for public session and private check
paths.

These are fault-injection tests of wrapper handling, using a synthetic auth
implementation. They are not actual quota exhaustion, a full Better Auth/D1
failure integration test, or proof of application-wide read-only fallback. No
shared allowance was deliberately consumed to exhaustion. The account-wide
quota gate remains open until the complete application failure path is tested.

Cloudflare documents daily D1 limit errors and distinguishes request CPU,
wall-clock time and Worker startup CPU. Existing live warm gateway CPU evidence
cannot establish a genuinely cold gateway measurement. Cold gateway evidence
still needs a known first invocation of the deployed gateway isolate plus
platform CPU telemetry, including startup information; local timers or creation
of a fresh Better Auth object are insufficient.

Sources:
- https://developers.cloudflare.com/d1/observability/debug-d1/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
