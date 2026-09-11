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
3. Only after capacity passes: namespaced Better Auth tables and a unique
   auth-user/application-user mapping, central API guard and route inventory,
   preserving existing LinkSim IDs and API/resource response shapes.
4. Existing sign-in/settings UI integration, optional multiple passkeys,
   fresh-auth credential changes, safe same-origin return URLs, local unsynced
   work preservation, and tested migration flows.
5. Staging rehearsal and separately approved protected production cutover.

## Capacity gate

Target 1,000 registered accounts at the historical activity mix, plus an explicit
scenario of 1,000 daily active accounts, 30 protected requests and one login each
per day. Test 50 concurrent API requests and 20 simultaneous login initiations.
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
