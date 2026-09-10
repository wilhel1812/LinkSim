# Better Auth compatibility gate (issue #1107)

This is an isolated experiment, **not LinkSim's authentication implementation**.
The application still uses Access. Nothing in this directory is imported by its
Functions or client build. The experiment package is private, version 0.1.0;
LinkSim remains on 0.28.1 until its migration release line is explicitly selected.

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
The second-provider requirement remains open; GitHub-only validation is not an
approved final migration architecture.

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
server-session paths, followed by three concurrent reused-instance requests.
Output contains only status, elapsed time, initialization flag and D1 counters.
The server responses from measurement routes reveal only signed-in status and
the verified-email flag. They preserve library session-refresh response headers.

Reused instances are scoped to the Workers environment object, with request-local
D1 metrics held in Node `AsyncLocalStorage` to avoid mixing concurrent requests.
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
| `/api/me`, `/api/avatar-upload`, `/api/stats/path-leaderboard`, Libraries, users, collaborators, notifications, changes, admin/diagnostics | Use `verifyAuth()` and existing DB role/resource policies; adapt identity, retain authorization. |
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
