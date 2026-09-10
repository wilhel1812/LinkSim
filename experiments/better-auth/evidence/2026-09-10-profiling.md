# Profiling decision: free-tier gate remains open

Baseline: `bb981074a108cf07ed3093ae1fd167a948ebe48e`, disposable Worker
`d41e8815-50ce-4350-be09-7297f4ee63bc`. No application auth integration or
production/shared-staging change is covered by this report.

The maintainer verified repeat GitHub login, passkey enrollment, passkey login,
and the session measurement flow on this baseline. Sanitized Cloudflare tail
reported GitHub callback CPU of 124 ms, passkey verification of 25 ms, warm
internal session checks of 3–4 ms, and an initialized concurrent check of 32 ms.
These are individual observations, not percentiles. Workers Free documents a
10 ms CPU/request allowance with limited flexibility for occasional overruns;
HTTP success alone is not acceptance evidence.

## Method and findings

Local profiles used Better Auth 1.7.3, SimpleWebAuthn 13.3.3 and installed
workerd 1.20260804.1, with synthetic accounts and local D1. Each phase had ten
warmups and 100 sequential invocations. V8 Inspector `Profiler` sampled the
application Worker at 100 microseconds; Miniflare's internal database/outbound
workers were excluded. Raw local profiles remain temporary development
artifacts; aggregate results and caveats are in
[2026-09-10-profiling.json](2026-09-10-profiling.json).

- Repeated initialization includes endpoint/schema construction and the database
  schema check. This is not a measurement of a new isolate's module startup.
- The library HTTP handler reconstructs request context and its router/endpoints
  per invocation. The internal `auth.api.getSession()` avoids HTTP routing and
  public-route rate limiting. The two paths are therefore not interchangeable
  public endpoints.
- The public session endpoint's database write is consistent with the library's
  persistent rate-limit update. Retain that protection.
- The instrumentation control was not consistently slower than the bare handler.
  Removing the wrapper is not an established solution to live CPU overruns.
- Mocked OAuth exercised provider initiation and callback together. Network
  responses were synthetic; the result cannot predict real GitHub callback CPU.
- A public upstream assertion fixture verified successfully with the installed
  SimpleWebAuthn verifier. This isolates parsing/signature verification; it does
  not include Better Auth challenge consumption, counter updates or session
  creation. No conclusion that cryptography dominates the live request follows.

## Supported optimization selected

Enable `advanced.database.joins: true` in the disposable configuration. This is
supported by the pinned library and native Kysely adapter. Regression coverage
requires warm internal session checks to use one database query rather than two,
while existing freshness, logout/revocation, OAuth replay and origin checks pass.
The generated schema must remain identical. No cookie/session cache, security
check removal, custom cryptography, dependency change or router fork is included.

Local sampled non-idle totals per 100 operations were:

| Phase | Baseline run A | Baseline run B | Joins run |
| --- | ---: | ---: | ---: |
| Repeated initialization | 300 ms | 328 ms | 277 ms |
| Internal session API | 246 ms | 260 ms | 171 ms |
| Public session HTTP | 404 ms | 475 ms | 313 ms |
| Unchanged instrumentation control | 389 ms | 407 ms | 342 ms |
| Mocked OAuth initiation + callback | 1,035 ms | 990 ms | 817 ms |

The unchanged control also varied, so these are directional observations, not a
proven percentage gain. Local machine speed, sampling overhead, JIT, garbage
collection and local D1 behavior differ from deployed Workers. Query-count
reduction is the concrete regression-tested improvement. The verifier-only
sample in baseline B was 109 ms across 100 operations; it is not a complete
passkey login measurement or a live CPU estimate.

## Next gate

After independent review, deploy only the existing disposable Worker with joins
and repeat the maintainer's authenticated session measurements, GitHub callback
and passkey login. Compare Cloudflare CPU and D1 counters; include initialized
and concurrent requests. Do not require repeated user ceremonies until the
candidate is deployed. A reduced warm-session cost cannot compensate for
consistently over-budget cold starts or login requests. If those remain outside
the free allowance, reassess the framework/hosting choice before migration.

Other options inspected: `better-auth/minimal` excludes the Kysely adapter needed
by our direct D1 setup; it is not a drop-in optimization. Cookie caching changes
revocation behavior. Background tasks can shorten latency without eliminating
CPU work. None is enabled by this batch. No safe supported option was found to
cache the library's HTTP router while retaining its request-specific context.

Sources:
- [Cloudflare CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Better Auth performance guidance](https://better-auth.com/docs/guides/optimizing-for-performance)
- [Better Auth database configuration](https://better-auth.com/docs/concepts/database)
- [SimpleWebAuthn v13.3.3 public assertion fixture](https://github.com/MasterKale/SimpleWebAuthn/blob/v13.3.3/packages/server/src/authentication/verifyAuthenticationResponse.test.ts)
