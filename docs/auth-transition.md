# Authentication transition: 0.29.0

Approved in issue #1107. This document records the implementation handoff, not
proof that the replacement has passed acceptance. Production remains on Access.
GitHub is the initial provider; GitLab is deferred. Passkeys are optional if the
runtime gate fails for them. No passwords, transactional email, auth SaaS, custom
session tokens, cryptography, or recovery codes.

## Delivery batches

1. Foundations: page-load-only operational notices (explicit local publish/clear
   events still refresh); reuse the authenticated profile; defer administrator
   datasets to open settings; share in-flight notification requests by identity.
   Preserve sync debounce, delta tracking, and recovery/revocation passes.
   Allowlist staging export tables and sanitize before importing. Reject unknown
   tables and staging auth tables until a credential-reset workflow is reviewed.
2. Disposable compatibility proof: extend PR #1108 to run Better Auth in one
   private-binding Durable Object per environment, using that environment's D1.
   Pages delegates library endpoints and one authoritative library session check
   per protected request. Reuse that result in the request; keep current
   application-account and resource authorization authoritative. No public route
   may expose an internal session check. Keep library session cookie caching off.
3. After the maintainer's qualified capacity acceptance, install namespaced
   Better Auth tables and a unique auth-user/application-user mapping on staging.
   Runtime integration, the central API guard and route inventory remain gated;
   preserve existing LinkSim IDs and API/resource response shapes.
4. Existing sign-in/settings UI integration, optional multiple passkeys,
   fresh-auth credential changes, safe same-origin return URLs, local unsynced
   work preservation, and tested migration flows.
5. Staging rehearsal and separately approved protected production cutover.

## Current integration batch

Issue #1139 adds the first application integration beneath the existing staging
Access boundary. Stable staging binds Pages Functions directly to the private
`linksim-auth-runtime-staging` Durable Object and checks a Better Auth session
once for each protected application request. The request reuses that result in
existing handlers; application account state and permissions remain authoritative
in D1.

`AUTH_SESSION_SOURCE=transition` means a valid Better Auth session must resolve
through the durable auth-user/LinkSim-user mapping and cannot fall back to an
Access identity when that mapping is invalid. Requests with no Better Auth
session, or a temporarily unavailable auth runtime, may use a fully verified
Access identity while Access still protects staging `/api/*`. The future
`better-auth` mode fails closed instead. Production and arbitrary preview hosts
have no auth-runtime binding in this batch.

The runtime has no public route and its default fetch handler returns 404. It
has no OAuth provider, passkey plugin, login UI, registration, or migration flow
yet. Those remain later batches after the staging boundary and operational
measurements pass.

## Capacity gate

Target 1,000 registered accounts with activity comparable to current users.
The maintainer clarified that 1,000 daily active accounts is not a requirement.
Retain the prior 1,000-DAU/30-request calculation only as an agent-selected stress
sensitivity, not a release acceptance target or measured usage. Derive ordinary
daily activity from evidence. Test 50 concurrent API requests and 20 simultaneous login initiations.
Bulk tests use synthetic credentials; do not automate mass GitHub authorizations.

Measure gateway CPU (including cold starts), Durable Object latency/duration,
D1 reads/writes, rate-limit writes, concurrent identity isolation, session refresh,
and account-wide projected quotas including staging and abuse controls. Normal
projected usage targets half of each relevant daily free allowance. The maintainer
accepted the specific 53,700 D1 writes/day sensitivity scenario on September 11
while retaining the 1,000-user target. This is a narrow write-budget exception,
not acceptance of higher unmodeled costs or completion of the other gates.
Require runtime headroom and no resource-limit failures; successful CPU overruns
alone are not proof. If the gate fails, stop before application migration and
reassess, rather than substituting custom session-security logic.

Historical baselines read on September 10: production 4,063 requests/24h,
34,833/7d, 122,524/30d; staging 6,610/7d. These are snapshots, not a current monitor.
CPU chart units were inconsistent, so they are not accepted timing evidence.
Notice query analytics and request metrics are distinct; do not claim exact
request savings from their ratio. Re-measure after foundations deploy.

The [1,000-registered-account capacity decision](../experiments/better-auth/evidence/2026-09-18-registered-capacity-decision.md)
reconciles the current request and storage sensitivities. On September 19 the
maintainer accepted that evidence for the narrow, reversible step of installing
the additive auth schema on staging. The target remains 1,000 registered users.
This does not approve production schema, auth runtime, routes, credentials,
archive writes, Access removal or cutover. Account-wide runtime and quota gates
remain open before any of those steps.

## Migration and recovery invariants

Provider subjects identify subsequent logins. During a fixed 90-day window from
production cutover, a provider-verified email may claim exactly one eligible
legacy verified-email identity. Never use editable profile email. Exclude
blocked, deleted, superseded, ambiguous, already-migrated, administrator and
moderator identities. Conditional atomic D1 writes and uniqueness constraints
must produce one winner; transient claim errors must not create duplicate users.
Preserve ownership, roles, history, tombstones and consumed administrator bootstrap.

Privileged and unmatched users prove both fresh Access and fresh Better Auth
logins in a short-lived, server-bound, single-use migration attempt. Conflicts
require assisted resolution; never overwrite a mapping. Keep GitHub linked.
Recovery uses GitHub or an enrolled passkey; loss of all methods requires audited
manual ownership review and is not guaranteed. Email alone is not sufficient.

## Security, staging and cutover

Preserve exact origins, secure host-only cookies, OAuth state/CSRF, application
mutation CSRF, persistent library rate limiting, real Turnstile verification on
OAuth initiation, current account-state checks and server-side revocation. Audit
all route aliases; default APIs private and explicitly preserve intentional guest
routes. Do not infer public intent from a missing handler auth check.

Separate all production/staging bindings, OAuth apps, secrets, cookies, passkey
origins and Turnstile widgets. Disable real auth on arbitrary previews. Never
export production auth credentials, sessions, mappings or challenges to staging.
Use synthetic legacy identities for migration rehearsals.

Run full tests/build, required deep-link/API/store suites, independent pre-PR
review, CI and maintainer staging verification. Deploy additive schema and
disabled integration first, expose narrowly scoped auth/migration routes, migrate
privileged accounts, obtain production cutover approval, and remove broad Access
only after application boundary checks pass. Record exact SHAs and cutover time.
Review the first full day and first week before closing capacity acceptance.

Rollback preserves mappings and credentials: disable registrations/claims and
use the tested transition deployment. Access alone cannot serve new users or
remove its seat limit; provide a read-only fallback preserving local work. After
90 days disable automatic claims and dual-login migration, then retire obsolete
Access verification/reconciliation after verification, retaining audit history.
