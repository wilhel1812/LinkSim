# Authentication transition: 0.29.0

Approved in issue #1107. This document records the implementation handoff, not
proof that the replacement has passed acceptance. Production remains on Access.
GitHub is the initial provider; GitLab is deferred. Passkey support is required
before production cutover, while enrollment remains optional. No passwords,
transactional email, auth SaaS, custom
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

Stable staging now uses `AUTH_SESSION_SOURCE=better-auth`. Cloudflare Access
bypasses the ordinary `/api/*` application boundary so LinkSim can validate the
Better Auth session and return its own `401` for anonymous protected requests.
The existing Access application and audience remain reserved for the more
specific `/api/auth/legacy-access/*` path, where the future dual-login migration
flow can obtain a fresh legacy proof. Cloudflare applies the more-specific path
application before the broader API bypass. Production and arbitrary preview
hosts have no auth-runtime binding and remain on Access.

Issue #1144 added a single-account GitHub pilot on stable staging. Pages exposes
only Better Auth's social-login initiation, GitHub callback, and logout routes;
the session-check RPC remains private. The pilot requires an exact configured
GitHub account ID and an exact existing LinkSim user ID. Session creation fails
closed unless that pair has a current, eligible mapping. It does not perform an
email claim or create a LinkSim account. Turnstile protects social-login
initiation, Better Auth keeps its D1-backed rate limiter and CSRF/OAuth-state
checks, and OAuth tokens are encrypted at rest.

The existing sign-in chip establishes a Better Auth session without losing the
current workspace, and the existing profile chip returns once that session maps
to a current LinkSim account. Logout revokes Better Auth. The pilot flag, provider credentials,
Turnstile widget, identity pair, Durable Object and cookies are stable-staging
only; arbitrary previews and production remain unchanged.

The Durable Object still has no public fetch route and returns 404 by default.
Privileged/unmatched dual-login migration, passkeys, GitLab and account linking
remain later batches. Better Auth may create an inert internal
user/account row before a mapping failure is known; such a failure creates no
session or LinkSim mapping and a later valid retry remains idempotent.

Issue #1149 replaces the server-side pilot identity pair with general staging
GitHub registration and safe ordinary-account claims. Better Auth requires a
fresh provider-verified email and refreshes provider user information at every
OAuth sign-in. Session creation atomically provisions the LinkSim identity:
exactly one eligible active ordinary legacy claim preserves its existing
LinkSim ID and data; an email with authoritative proof that no legacy claim or
subject exists receives a new independent LinkSim ID and immediate ordinary
access. Blocked, deleted, superseded, privileged, pending, revoked,
inconsistent, conflicting, missing-email and unverified-email identities fail
closed. The fixed staging claim deadline is
`2026-12-19T23:59:59.999Z`; after it, legacy claims fail while truly new
registration remains available. The existing browser pilot flag remains during
the Access transition, but the runtime no longer has per-user pilot secrets.

Issue #1151 adds the compatibility-proven Better Auth passkey plugin to the
same private staging runtime. Passkeys are bound to `staging.linksim.link` and
stored in the existing `auth_passkey` table. Users may enroll, name, rename and
remove multiple passkeys from the existing Profile settings surface and sign in
from the existing account toolbar. Enrollment, rename and removal require a
session created within the configured five-minute freshness window. GitHub
remains linked and available for bootstrap and recovery; this phase exposes no
provider-unlink route. Passkey authentication does not replace Turnstile on
GitHub registration and does not establish that a user is human. Preview and
production authentication remain unchanged.

The passkey experience follows Passkey Central's Principles and Required
Patterns within LinkSim's existing sign-in popover and Profile settings. The
settings surface explains device unlock, credential-manager storage, syncing,
cross-device QR flows, compatibility and GitHub recovery, and announces each
credential operation before and after it completes. LinkSim deliberately uses
a dedicated Passkey action beside GitHub because it has no username field for
conditional WebAuthn autofill. GitHub replaces password or email-OTP fallback
examples because LinkSim intentionally operates without passwords or
transactional email.

Issue #1164 adds the temporary paired-login path for privileged and unmatched
legacy users. A newly issued, signature-verified Access JWT creates a ten-minute,
single-use D1 attempt for the current LinkSim ID. Better Auth carries only that
attempt ID through its library-managed GitHub OAuth state. A fresh Better Auth
session may then atomically create the unique auth-user/LinkSim-user mapping,
consume the attempt and write a `better_auth_dual_login` audit event. The flow
never selects an account by profile email and never overwrites a mapping.
A later attempt for the exact same auth-user/LinkSim-user pair is consumed as a
successful reconfirmation so an already-migrated user signs in normally; either
identity mapped to a different account remains a fail-closed conflict.
The existing sign-in popover exposes this as **Move existing Cloudflare
account**, separate from ordinary GitHub registration and passkey sign-in.
Selecting it hands the full paired proof to a raised, non-dismissible migration
modal. The modal remains through the Access and GitHub round trips, hosts the
Turnstile challenge, shows the three proof/binding steps and keeps failures and
retry actions visible until the existing LinkSim account is connected.
Closing or abandoning GitHub leaves the attempt pending and retryable until its
ten-minute expiry; no cancellation state or partial mapping is written. Deleting
either still-unmapped identity removes its attempt, so temporary proof rows
cannot block the existing account lifecycle.

The three staging rollout gates are explicit and fail closed:
`AUTH_DUAL_LOGIN_MIGRATION_ENABLED`, `AUTH_LEGACY_CLAIM_ENABLED` and
`AUTH_REGISTRATION_ENABLED`. Stable staging enables all three. Preview and
production configuration omit them. Turning off the migration gate stops new
attempts and assisted recovery without invalidating existing mappings; turning
off claims or registration stops those provisioning paths while mapped sessions
continue to resolve normally.

Administrators can perform exceptional recovery through the existing protected
ownership-tools API only while the migration gate is enabled. The operation
requires a verified GitHub identity, an eligible current LinkSim account and an
independent evidence type and summary; an email address alone is rejected. It
creates the unique mapping and a `better_auth_assisted_recovery` audit event in
one D1 batch. The successful event records the bounded `mapped` outcome; rejected
requests create no ownership change and return a typed error. No recovery action
is available from a public or anonymous route. Evidence containing credential
terms, JWT-shaped values, provider-token prefixes, private-key markers or long
high-entropy strings is rejected before persistence.

The staging GitHub OAuth application uses
`https://staging.linksim.link/api/auth/callback/github`. The `staging` GitHub
environment must provide `BETTER_AUTH_SECRET`,
`BETTER_AUTH_GITHUB_CLIENT_ID`, `BETTER_AUTH_GITHUB_CLIENT_SECRET`,
`VITE_TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY`. The deployment
workflow validates these inputs, installs the corresponding runtime secrets
before deploying the Durable Object, and enables the browser pilot only for
stable staging.

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

The [final staging release-readiness audit](../experiments/better-auth/evidence/2026-09-25-auth-staging-release-readiness.md)
records exact-tree deployment, Access-boundary, signed-in session, passkey,
sync and supported deep-link evidence without repeating completed migration or
credential ceremonies. It makes a qualified capacity go at the current scale
and a conditional acceptance of the 1,000-registered-account target within the
modeled activity envelope. The accepted storage sensitivities span roughly 958
to 1,000 accounts, but do not establish a supported-user range; reaching 1,000
on Free depends on bounded R2 archive operation before D1 approaches its ceiling.
The subsequent [R2 storage decision](../experiments/better-auth/evidence/2026-09-25-r2-storage-capacity.md)
models about 3.31 GB for production plus a full staging copy and sets a 6 GB
combined operating cap. This fits an otherwise clean 10 GB account, but the
current account's unrelated use exceeds the allowance, which leaves no
sustained Free headroom if retained. Archive activation therefore requires
account isolation, sufficient data reduction or explicit acceptance of R2
billing. The maintainer accepted the bounded LinkSim increment in #1192, and
the subsequent
[post-provision inventory](../experiments/better-auth/evidence/2026-09-26-r2-post-provision-inventory.md)
classified all six account buckets: production history remained empty, combined
history remained below the 6 GB cap, and a separate September-to-date query
confirmed that the unrelated workload's average daily peak alone remained above
10 GB. This satisfies the inventory gate under the bounded billing exception;
it does not authorize archive activation or any production change.
Representative cold/full-app CPU, billable object duration, actual active
fraction and history growth remain first-hour/day/week monitoring requirements,
not staging-proven guarantees.

The maintainer-approved
[production stop and rollback triggers](../experiments/better-auth/evidence/2026-09-25-production-stop-triggers.md)
turn those monitoring requirements into manual operating actions. They warn at
70% of daily compute/operation allowances, stop new account intake at 80%, and
start the ordered rollback at 90% when use continues after intake stops. They
also reserve 50 MB, 25 MB, and 10 MB before the conservative D1 ceiling for
warning, intake shutdown, and read-only rollback. The named operator and
approving maintainer are `wilhel1812`. These safeguards do not authorize the
production cutover or revise the 1,000-registered-account target.

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

A bounded exception handles a privileged legacy account that has no independent
GitHub identity. It is rehearsed in staging and may be temporarily enabled for
the separately approved production administrator bootstrap. An operator creates
a short-lived authorization for the exact environment, LinkSim ID and Access
subject. Fresh Access proof can then bootstrap a Better Auth-managed passkey and
session through an opaque, single-use context bound to a separate Secure,
HttpOnly, same-site browser cookie. A copied return URL is not sufficient to
continue recovery. Production must disable and verify this recovery gate before
broad API Access is narrowed.
No email matching, password, permanent Access session, ordinary registration or
custom WebAuthn/session primitive is introduced. The recovered privileged user
should enroll passkeys on independent authenticators where available. The
current administrator has one available authenticator and explicitly accepted a
single-passkey exception: loss of that passkey requires operator-assisted
recovery and may leave the account unrecoverable.

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
Use the ordered, fail-closed
[production authentication cutover checklist](production-auth-cutover-checklist.md)
for the separately approved production window.

The maintainer completed the human-only stable-staging VoiceOver spot-check on
2026-09-25 against `v0.29.0+8829bafc`, covering sign-in, native passkey handoff
announcements, Profile credential actions, error/fallback guidance and focus
return. The sign-off is recorded in #1188 and #1107, but the browser/device was
not recorded. The production-checklist evidence gate therefore remains open
until that metadata is added. Existing automated accessibility-tree tests
remain required; the human sign-off does not authorize production cutover.

For the stable-staging boundary cutover, reconcile Access before merging the
deployment commit: run `node scripts/access-boundary.mjs plan staging`, confirm
that only the two fixed staging API application IDs are listed, then run
`node scripts/access-boundary.mjs apply staging` with an Access-scoped token.
If the account token cannot mutate Access, make the same two reviewed changes in
the dashboard in the script's safe order and run the anonymous HTTP check. The
deployment workflow checks the desired boundary before making any runtime or
Pages change and checks it again after deployment.

Rollback preserves mappings and credentials: disable registrations/claims,
restore the legacy `/api/*` Access application with
`node scripts/access-boundary.mjs rollback staging`, then deploy the tested
transition-mode commit. Reversing that order can expose a deployment that still
accepts Access identities without the outer Access boundary. Access alone cannot serve new users or
remove its seat limit; provide a read-only fallback preserving local work. After
90 days disable automatic claims and dual-login migration, then retire obsolete
Access verification/reconciliation after verification, retaining audit history.
