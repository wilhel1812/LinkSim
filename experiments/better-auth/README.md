# Better Auth compatibility gate (issue #1107)

This is an isolated experiment, **not LinkSim's authentication implementation**.
The application still uses Access. Nothing in this directory is imported by its
Functions or client build. The experiment package is private, version 0.1.0;
LinkSim uses the approved 0.29.0 development line; application authentication remains on Access.

## Reproduce locally

Use Node 22.13+ with `node:sqlite` (measured with Node 25.9.0):

```sh
cd experiments/better-auth
npm ci --ignore-scripts
npm test
npm run bundle
```

The auth tests use the real pinned Better Auth library and in-memory SQLite;
setup regression tests also protect production/staging D1 bindings.
`npm run schema` regenerates `schema.sql` from that library. Never apply this
fixture schema to an application database. The Pages bundle checks the existing
LinkSim compatibility date, 2026-03-12, with `nodejs_compat` added only here.

Root `npm test` does not install or run this separate package. Run both suites
when changing the experiment. The nested lockfile is intentional: no auth
dependency is added to LinkSim before the compatibility gate passes.

## Remote experiment

Run only with explicit authority for disposable non-production infrastructure.
Create a new D1 database and a Worker with a `linksim-auth-probe-` name. The
Worker must have no routes, application data, R2 bindings, production OAuth
credentials, or production/staging database bindings.

Create ignored `wrangler.probe.jsonc` as strict JSON with this shape, replacing the placeholders:

```json
{
  "name": "linksim-auth-probe-<issue>",
  "main": "worker.mjs",
  "compatibility_date": "2026-03-12",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "vars": {
    "PROBE_ENABLED": "isolated-auth-probe",
    "PROBE_ORIGIN": "https://linksim-auth-probe-<issue>.<account>.workers.dev"
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "linksim-auth-probe-<issue>",
    "database_id": "<new-disposable-database-id>"
  }]
}
```

Generate independent random `PROBE_KEY` and `BETTER_AUTH_SECRET` values with a
trusted secret generator. Save them in ignored `.probe-secrets.json` (mode 0600),
then install them using the guarded setup command below. Every remote
request must supply the probe key, including fixture creation and auth routes;
missing configuration fails closed before touching D1. The fixture uses Better
Auth's own test utilities to create a synthetic user/session. It is not an OAuth
login, production session-creation API, or account recovery implementation.

Use these guarded commands for all remote setup; do not invoke schema application
or deployment directly through Wrangler:

```sh
node remote-setup.mjs schema
node remote-setup.mjs deploy
node remote-setup.mjs secrets
node run-remote.mjs
```

Each setup command validates the actual `database_id` against both repository
Wrangler configurations **before invoking Wrangler**, then uses the validated
configuration snapshot. Missing/invalid IDs, protected IDs (regardless of display
name), additional bindings, routes and environment overrides fail closed. The
runtime must be exactly `2026-03-12` with only `nodejs_compat`, matching the Pages
bundle; missing or different dates/flags are rejected before setup. The
runner reuses this check before any HTTP request. This rejects known protected
resources; confirm the remaining ID belongs to the newly created disposable D1
database in the intended account. No command grants authority for a remote run.

The runner does not follow OAuth
redirects, emits only aggregate cost/status fields, and respects the library's
stricter social-login rate limit. Its test Turnstile secret is Cloudflare's
published always-pass test key. Successful validation with it does **not** prove
human detection or production hostname/action validation. OAuth clients are
deliberately invalid placeholders; only initiation is exercised.

For per-request CPU measurements, start this in another terminal before running:

```sh
npx wrangler tail --config wrangler.probe.jsonc --format json | node summarize-tail.mjs
```

Only selected fields are written to `probe-tail.jsonl`; do not capture or publish
raw tail events because they include request headers. `run-remote.mjs` writes
`probe-results.json` with statuses, client-observed wall time, and D1 metadata.
Wall time is not CPU time. This probe instruments the `.all()`/`.run()` calls used
by the pinned D1 runtime adapter; schema introspection/batch operations are not
included. Recheck instrumentation if the adapter changes.

Stop the tail, delete the disposable Worker and D1 database, and remove the local
secret/config files after measurement. Preserve only sanitized results. Do not
remove or change any LinkSim Access application during this experiment.

## Guided GitHub/passkey validation

GitLab is deferred for this batch after signup verification required a card.
GitHub-only launch is approved for 0.29.0; GitLab is deferred.

The separate `live-worker.mjs` entrypoint has **no synthetic account/session
creation**. It reuses the schema and library configuration, but enables only
GitHub, rejects every GitHub subject except `PROBE_GITHUB_ID`, and denies account
linking/unlinking routes. Passkey enrollment needs an existing fresh session;
removal also uses Better Auth's fresh-session middleware. Session revocation,
CSRF, OAuth state and WebAuthn remain library responsibilities.

Use a newly created empty disposable database. Do not reuse a database populated
by the synthetic fixture: existing fixture sessions could otherwise authenticate.
For the same reviewed config shape, change `main` to `live-worker.mjs`, set
`PROBE_ENABLED` to `github-passkey-validation`, and add `PROBE_GITHUB_ID` (one
numeric GitHub subject as a string) and `PROBE_EXPIRES_AT` (UTC ISO timestamp,
strictly in the future and at most seven days away). The runtime denies every
request after expiry. The GitHub callback is `/api/auth/callback/github` on that
exact Workers hostname. Production and staging callbacks/passkeys do not apply.

Provide independently generated `BETTER_AUTH_SECRET`, the test OAuth application's
`GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` through the ignored mode-0600
`.probe-secrets.json`. Never put credentials into Wrangler variables, source, PRs,
or chat. `node remote-setup.mjs deploy` builds the bundled browser client and uses
the protected-ID preflight; `node remote-setup.mjs secrets` installs the secrets.
The synthetic entrypoint rejects requests if real-provider secrets are present.
This live surface permits public initiation/challenge requests but only one
tester can obtain an account/session. Library DB-backed rate limiting applies
to auth routes; the temporary server-session measurement routes have no extra
rate-limit writes, matching their intended comparison. Expiry and the narrow
tester restriction are test controls, not production signup abuse protection.

Open the hostname and, one step at a time, sign in with GitHub, add a test passkey,
sign out, sign in with that passkey, and remove it. Keep GitHub as recovery. Run
the session measurements while signed in; they make three sequential requests
to each of the HTTP session, reused-instance server-session and fresh-instance
server-session paths, followed by 50 concurrent reused-instance requests.
Output contains only status, elapsed time, initialization flag and D1 counters.
The server responses from measurement routes reveal only signed-in status and
the verified-email flag. They preserve library session-refresh response headers.

Reused instances are scoped to the Workers environment object, with request-local
D1 metrics held in Node `AsyncLocalStorage` to avoid mixing concurrent requests.
Context initialization and the library's schema check are awaited before an
instance is cached or its first response is returned. This prevents a later
request from inheriting schema-check I/O abandoned by a completed/canceled
request. Browser HTTP calls time out after 20 seconds; OAuth initiation does not
launch another session fetch while navigation is starting.
`initialized` marks a library instance creation, not proof of a cold isolate.
Use sanitized Wrangler tail CPU events alongside the browser measurements. Do
not infer CPU time from elapsed time, or claim cold-isolate coverage from the
fresh-instance endpoint alone. No full real-provider/passkey or new CPU result
is claimed until the maintainer completes the browser run.

The browser is disposable operator tooling, not new LinkSim UI. Its WebAuthn
client comes from the pinned Better Auth passkey plugin; it reuses LinkSim's
`getUiErrorMessage()`. Its published always-pass Turnstile token/key deliberately
does not prove humanity. Delete test passkeys, the Worker, D1 database and test
OAuth application after completing validation; expiry does not delete records.

Dependency audit on 2026-09-10 found the new high-severity
[sharp/libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) through
Wrangler/Miniflare. Image processing is not used by this probe and those tools are
not deployed in the auth Worker. The auth dependencies had no audit findings.
Keep this toolchain advisory visible and do not use image-transformation tooling
with untrusted images; do not blindly apply the suggested Wrangler downgrade.

## Measured result: 2026-09-08

Versions: Better Auth/passkey 1.7.3, Wrangler 4.121.0. Nested `npm audit`: no known
vulnerabilities at measurement time. Pages compilation passed. Disposable Worker
startup: 113 ms; compressed upload: 534.71 KiB. These are not request CPU figures.
The measured deployment version is `f1685c5d-931b-4fa8-b579-2d9c694a45b1` (the
secret update created a version after initial upload).
Sanitized responses and tail samples are in `evidence/2026-09-08.json`. The
disposable Worker/database and local probe secrets were deleted after the run.

| Warm operation | D1 queries | Rows read | Rows written | Observed CPU |
| --- | ---: | ---: | ---: | ---: |
| Session HTTP endpoint, valid cookie | 5 | 27 | 1 | 6–9 ms |
| Passkey registration options | 7 | 28 | 4 | 8–9 ms |
| OAuth initiation, test Turnstile accepted | 4 | 26 | 4 | 7–9 ms |
| Sign out | 8 | 26 | 4 | 10 ms |

Warm session rows are nine recorded requests; passkey options are three; OAuth
initiation is two (one per provider); sign-out is one. First requests can do
extra rate-limit insertion/cleanup work. This small, sequential sample is not
a load test. It uses a new auth instance per request and includes instrumentation.
It does not measure LinkSim authorization or application work. Server-side
`auth.api.getSession()` is also unmeasured; do not equate the HTTP endpoint's
rate-limit write with every eventual application API request.

An earlier mixed GraphQL sample (14 requests, including synthetic setup) reported
9.734 ms CPU p50 and 41.734 ms p99. It cannot attribute the high value to a route.
The observability REST query rejected the existing OAuth credential with 403;
GraphQL metrics and sanitized Wrangler tail succeeded instead.

Read-only production preflight: 84,832,256 bytes; preceding 24 hours 66,547 rows
read and 3,199 written. Staging: 23,506,944 bytes; 288,891 reads and 8,283 writes.
These are per-database snapshots, not account-wide quota totals or a forecast.
Production contained 50 users with 50 verified claims, three privileged users,
50 active/current lifecycle entries, and zero deletion tombstones. These counts
do not prove every claim can be matched to a chosen provider.

**Gate: not passed yet.** Warm requests approach the 10 ms Workers Free ceiling;
the mixed sample exceeded it. No evidence yet establishes dependable headroom.
Do not weaken revocation, CAPTCHA, or CSRF protections to reduce CPU usage.

Remaining evidence before application integration:

- Complete GitHub/GitLab OAuth callbacks with separate non-production OAuth
  applications, including private/missing/unverified email and account linking.
  GitLab's built-in provider defaults absent `email_verified` to false. Never
  force it true or use `trustedProviders` to bypass proof for migration.
- Complete actual passkey enrollment, assertion, replay rejection and removal;
  measuring challenge generation alone does not measure signature verification.
- Compare reused library initialization and the server-side session API; measure
  cold/warm and concurrent requests and representative D1 rate-limit growth.
- Confirm total account Workers/D1 usage and a margin below Free limits. If the
  gate fails, reassess the architecture with the maintainer before integration.

## Route boundary inventory

The current root middleware checks browser origins and canonical hosts; it does
not enforce authentication for all `/api/*` requests. Access currently supplies
an outer API boundary. A new middleware must preserve intended public routes
and cover handlers that currently rely on that outer boundary.

| Existing routes | Current application-level behavior / migration requirement |
| --- | --- |
| `/api/me`, `/api/dev-role` (development-only; also requires `ALLOW_INSECURE_DEV_AUTH`), `/api/avatar-upload`, `/api/stats/path-leaderboard`, Libraries, users, collaborators, notifications, changes, admin/diagnostics | Use `verifyAuth()` and existing DB role/resource policies; adapt identity, retain authorization. |
| `/api/deep-link-status`, `/api/public-simulation` | Inspect optional identity/resource visibility; retain intentional guest behavior. |
| `/api/v1/calculate`, job submission and job status aliases | No direct `verifyAuth()`; preserve the outer API authentication boundary before removing Access. Audit all aliases together. |
| `/api/geocode`, `/api/health`, `/api/stats`, `/api/avatar/*` | No direct `verifyAuth()`; reconcile intended guest use with effective live Access exceptions before cutover. Do not infer public intent from absence of a check. |
| `/api/auth-start` | Existing Access-triggering redirect; replace with the approved provider flow and preserved safe return destination. |
| `/copernicus/*`, `/meshmap/*`, `/node-sources/868-no`, `/site-status.json` | Outside `/api`; preserve their existing public/operational behavior and rate limits. |

The existing in-memory limiter is best-effort per isolate. The probe uses Better
Auth's DB-backed limiter, but its distributed concurrency and growth still need
assessment. Reuse existing account-state/resource helpers and do not duplicate
the separate authorization consolidation already tracked by #1057.

Before namespaced auth tables reach production, replace the whole-database
production-to-staging refresh with a sanitized allowlist export that excludes
sessions, tokens, accounts, passkeys and challenges **before** staging import.
Preserve stable LinkSim IDs, tombstones, bootstrap consumption and role authority.

References: [approved issue](https://github.com/wilhel1812/LinkSim/issues/1107),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[GitLab provider](https://better-auth.com/docs/authentication/gitlab),
[Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

### September 10 profiling follow-up

[Profiling evidence and decision](evidence/2026-09-10-profiling.md) distinguish
local profiles from Cloudflare CPU measurements. The probe enables the pinned
library's native database joins to reduce a warm internal session lookup from
two queries to one. Schema, revocation and freshness checks remain in place.
This does not establish free-tier compatibility; initialized requests and real
OAuth/passkey callbacks still require deployed measurements.

## Private Durable Object runtime experiment (0.29.0 gate)

The optional paired deployment derives strictly from the existing disposable
`wrangler.probe.jsonc`. It keeps the same demo origin and D1; it never resets the
database. The gateway only imports route policy and browser assets. Better Auth,
provider secrets and D1 live in the private `-runtime` Worker's SQLite-backed
`AuthProbe` Durable Object. A single named object is selected per deployment.
Its HTTP worker returns 404 and has no public workers.dev or preview URL.
Internal session checks use a private binding method, never a public internal URL.
The public benchmark returns only authentication and verified-email booleans.

Run from this directory:

```sh
npm test
node remote-setup.mjs bundle-runtime
node remote-setup.mjs bundle-gateway
node durable-local.mjs
```

The last command uses local workerd, a temporary in-memory fixture database and
Miniflare D1; it creates 1,000 synthetic accounts through library test utilities,
checks 50 simultaneous sessions, initiates 20 mocked OAuth flows without GitHub
authorizations, and verifies immediate revocation. It never reads the live config
or secrets. Its mocked Turnstile result is not an abuse-protection acceptance test.

After independent review, the explicitly authorized disposable deployment order is:

```sh
node remote-setup.mjs indexes-runtime
node remote-setup.mjs deploy-runtime
node remote-setup.mjs secrets-runtime
node remote-setup.mjs deploy-gateway
```

The secrets command uses the existing ignored `.probe-secrets.json`. Do not print
its contents. There is deliberately no schema action for this pair. Restoring the
original demo runtime uses `node remote-setup.mjs deploy` followed by
`node remote-setup.mjs secrets`; preserve the existing D1 and ignored secret file.
The gateway deployment inventories and deletes retained secret bindings, then
verifies none remain before publishing the gateway. Failed cleanup prevents deployment. This rollback affects only the disposable experiment.

Local evidence on 2026-09-10: all 50 warm session calls used one query, two rows
read and zero writes. Initial object auth setup used two queries and 23 rows read.
All 20 mocked initiations returned 200 (three queries, two rows read, six writes
each, including persistent rate limiting and OAuth state). Revocation returned
401 on the next call. Compressed bundles: gateway 19.08 KiB, auth runtime 534.48 KiB.
`npm audit --omit=dev` reported no advisories for pinned production dependencies.

**Capacity acceptance remains pending.** Local elapsed time is not Cloudflare CPU
measurement. Collect gateway CPU including cold starts, object duration/latency,
real D1 counters, refresh writes, 50-call bursts and actual individual GitHub and
passkey ceremonies through the private binding. The `x-probe-object-elapsed-ms`
header measures gateway waiting, not object CPU or billable duration. Keep logs
sanitized with the existing tail summarizer. Recalculate account-wide quotas with
staging and abuse overhead before application integration. The published
[DO allowances](https://developers.cloudflare.com/durable-objects/platform/pricing/)
are 100,000 requests/day and 13,000 GB-s/day; the approved normal-use gate is below
50% of both, as well as the relevant Pages/Workers and D1 allowances.

### Refresh, eviction and provider-account capacity follow-up

The local harness now seeds 1,000 provider accounts as well as users, renews an
aged session, verifies the returned cookie and database expiry, evicts the actual
local object before a second 50-request burst, and checks expired sessions.
Supplemental provider-subject and rate-limit expiry indexes prevent full table scans.
The latter adds a write when the library updates a limiter timestamp; it does not
change the library rate-limit policy or introduce a cleanup timer.
Apply `node remote-setup.mjs indexes-runtime` before runtime deployment; this
idempotent action only adds the reviewed index and does not reset auth data.

The internal RPC completes its session body before returning plain response
fields, preserving separate library cookies. See
[evidence/2026-09-11-capacity.md](evidence/2026-09-11-capacity.md) for measured
costs, the conditional quota projection and remaining gates. The current-activity
request reduction and D1 write headroom still require validation.

The local harness also verifies library window-reset cleanup with 1,000 live rate-limit
entries, checks bounded reads, and confirms those live limits survive cleanup.
Apply the supplemental indexes with the guarded `indexes-runtime` command;
the generated schema remains unchanged.

## Real Turnstile validation

The isolated live probe supports `PROBE_TURNSTILE_MODE: "real"` with a public
`TURNSTILE_SITE_KEY` in the strictly validated probe config. Test mode remains
available only by omitting both variables in local/disposable fixture configs;
real mode never falls back when its secret is missing. The application does not
import this experiment. The real widget is restricted to the exact probe host,
uses Managed mode, and has pre-clearance disabled.

Save the widget's site and secret keys in the ignored owner-only
`.wrangler/turnstile-validation-secrets.json`, with exactly `TURNSTILE_SITE_KEY`
and `TURNSTILE_SECRET_KEY`. Do not paste either credential file into logs or PRs.
Only the site key enters the gateway's public HTML/configuration. The guarded
installer validates the matching site key and installs only `TURNSTILE_SECRET_KEY`
on the private runtime; it never sends this secret to the gateway. It removes
its temporary secret file after installation.

After tests and independent review, the approved disposable rollout order is:

```sh
node remote-setup.mjs turnstile-secrets-runtime
node remote-setup.mjs deploy-runtime
node remote-setup.mjs deploy-gateway
```

The brief runtime-first transition rejects the old browser's dummy token; reload
the page after the gateway deployment. Keep the existing OAuth/session secrets.
The new client requests a fresh token on each GitHub attempt in the existing
probe notice area. It handles script load failures, challenge errors, expiry and
timeout without sending a dummy token in real-mode HTML. CSP permits only the
Cloudflare challenge script/frame/connect origin in addition to same-origin
resources. Better Auth's CAPTCHA plugin performs server-side Siteverify and
checks exact hostname and action `github-login`; no custom token verification
or CAPTCHA bypass is introduced. OAuth callbacks still require library state.

Tests mock Siteverify to exercise rejection paths; they do not prove that a real
visitor challenge succeeded. Finish with maintainer GitHub sign-in on the real
widget and sanitized gateway/runtime telemetry. Direct missing/dummy tokens must
be rejected, and callbacks without valid state must not establish a session.
Sources: [Better Auth CAPTCHA](https://better-auth.com/docs/plugins/captcha),
[Cloudflare validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

See [security and initialization evidence](evidence/2026-09-11-security.md) for
real-Turnstile happy-path confirmation, local negative cases, and the cold-burst
initialization fix. Healthy in-flight initialization is shared; failed or aborted
initialization cannot poison subsequent requests. The local eviction test requires
exactly one initialization and keeps request identity/metrics isolated.

### Virtual passkey negative cases

Run `node durable-local.mjs --passkeys` after the local bundle commands to extend
that same synthetic workerd/D1 fixture with a Chromium virtual authenticator.
It uses the root project's existing Playwright dependency. Install its Chromium
with `npx playwright install chromium` from the repository root, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an already installed Chromium executable.
No browser profile, generated key, cookie, or assertion is written to an artifact.
All browser requests are intercepted with an empty local test document. Only
synthetic credentials enter the in-memory fixture; nothing is deployed.

The optional pass checks successful registration/login, registration/assertion
replay, wrong challenge/origin/RP, invalid signatures, and a removed credential.
Chromium performs the cryptographic operations. The virtual-key testing API is
used only to isolate the RP-hash case; no custom authenticator or signing logic
is implemented. See [passkey and usage evidence](evidence/2026-09-11-passkeys-usage.md).

### Controlled application traffic and failure checks

See [the workload evidence](evidence/2026-09-11-traffic-workloads.md) for repeatable
notice, ordinary/admin sidebar and edit-sync counts, the production-component
comparison, and synthetic quota/resource failure coverage. These measurements
separate fixed privileged traffic from ordinary-user growth; they do not pass the
account-wide capacity or cold-gateway gates.

### Maintainer staging request capture

Open stable staging and sign in normally. Paste `staging-request-capture.js` into
that page's developer console, then use the application normally: open a saved
Simulation, edit a Site, allow automatic sync, and use manual sync once. Include
some idle time. Do not reload while capturing; a reload ends the capture.

Run `JSON.stringify(linkSimRequestCapture.stop(), null, 2)` and share that summary,
plus whether this was an ordinary or administrator session and what you did.
It retains only allowlisted route categories, status and counts. No network calls,
headers, cookies, query strings, response bodies or persistent storage are used.
Unknown API routes are grouped together; dynamic resource IDs are discarded.
Resource Timing can omit failed/evicted requests and does not expose methods or
D1 usage. Capture starts with available buffered entries, which may include
login/bootstrap before installation; record that when interpreting the sample.
It is a sample of your workflow, not a daily-active-user forecast or HAR export.

### First gateway invocation

The disposable gateway records `probe-gateway-first-invocation` once per gateway
instance, synchronously before any request I/O. The existing sanitized tail
collector now attaches `firstInvocation` to the matching platform CPU event.
A new Better Auth instance in the Durable Object is not this marker. Fetching the
HTML page can consume the first invocation, so inspect the recorded path.

For a controlled capture, attach the sanitized tail before deploying the reviewed
gateway, then send one `/api/auth/get-session` request directly without first
loading its page. Record the deployment's startup time and matching script version
alongside the first-invocation CPU event. A missing marker is inconclusive; an
anonymous session request proves only that path. Repeat with authenticated user
traffic when a fresh instance is observed. The marker reports first handler use,
not proof that Cloudflare charged module initialization to that request's CPU.

Latest capacity interpretation: [revised activity model](evidence/2026-09-11-revised-activity-model.md).
It incorporates the completed maintainer sample, separates privileged polling and
rare forced recovery, and preserves Manual Sync unchanged.
