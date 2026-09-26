# Production authentication cutover checklist

This runbook prepares the 0.29.0 migration from broad Cloudflare Access to
Better Auth. Nothing here authorizes production work. Every production write
requires a separately approved cutover window.

The checked-in production auth files are dormant:

- `wrangler.production-auth.toml` is the prepared Pages configuration.
- `workers/auth-runtime/wrangler.production.toml` is the prepared private auth
  runtime configuration.
- `config/production-auth-build.env.example` records the required client build
  flags without activating them in normal production CI.
- `config/production-auth-mode.json` is the reviewed persistent deployment
  switch. Its checked-in `active: false`, `accessBoundary: broad` state keeps
  normal production automation on `wrangler.toml`, without the auth runtime or
  Better Auth schema migrations.

The initial production mode is `transition`: Better Auth is checked first while
verified Access remains available for legacy migration. The existing Access API
application is narrowed from `/api/*` to `/api/auth/legacy-access/*` only after
the application boundary is verified.

## Before the window

- [ ] Obtain explicit production-cutover approval.
- [ ] Freeze and record the release tag, commit SHA, tree SHA, Pages deployment,
  auth-runtime artifact/config SHA, and current Access application/policy IDs.
- [ ] Confirm production D1 backup/restore evidence and the rollback owner.
- [x] Provision the unbound `linksim-history` bucket only from the dedicated
  `npm run tf:plan:prod-history` saved plan accepted by
  `npm run tf:validate:prod-history-plan`. Keep the ordinary production plan as
  the separate drift audit and record every remaining difference without
  applying it in this operation. Do not add the Pages binding or enable archive
  writes. Completed on 2026-09-25 through
  [#1198](https://github.com/wilhel1812/LinkSim/pull/1198): the accepted plan
  created only the bucket (`1 added, 0 changed, 0 destroyed`), the follow-up
  ordinary plan showed the bucket as a no-op, unrelated drift was not applied,
  and the bucket remains unbound with archive writes disabled.
- [x] Rehearse the existing production-to-staging archive copy with a read-only
  production credential and a separate staging-write credential. An empty bucket
  or inline-only export is not evidence; use the first genuine archived object
  or obtain separate approval for one synthetic production-bucket object. Prefer
  separately scoped short-lived R2 credentials and pass each credential's
  session token through the documented staging-refresh environment variable.
  Completed on 2026-09-25 after
  [#1200](https://github.com/wilhel1812/LinkSim/pull/1200): one approved
  disposable object was copied with separate 15-minute production-read and
  staging-write credentials, its sanitized staging reference and digest were
  verified, and the new source object plus its copied staging object were
  removed. This rehearsal did not authorize deletion of the five older staging
  rehearsal objects retained by the linked storage decision.
- [ ] Confirm Cloudflare usage notifications and billing alerts reach an active
  operator. Record current D1, Workers, Durable Objects, Pages and R2 baselines.
  The [2026-09-26 read-only baseline](../experiments/better-auth/evidence/2026-09-26-cloudflare-usage-baseline.md)
  records all five resource families below their approved warning thresholds.
  The active Wrangler OAuth session lacks Notifications read access. A read-only
  dashboard fallback confirmed two enabled email billing-budget alerts,
  including the LinkSim emergency spend warning, and an inspected recipient
  matching the active account operator. Actual receipt remains open. Do not
  infer a missing alert from the audit credential's HTTP 403 response, and do
  not check this item until a test/recent dispatch or maintainer confirmation
  establishes receipt.
- [x] Re-run the complete account R2 inventory from the
  [storage decision](../experiments/better-auth/evidence/2026-09-25-r2-storage-capacity.md).
  Classify every bucket and block archive activation if either history
  environment would exceed 3 GB, combined history would exceed 6 GB, non-history
  account use exceeds 4 GB, or less than 6 GB remains for history inside the
  10 GB allowance. The 2026-09-25
  current inventory fails this sustained Free-tier gate because unrelated
  account use exceeds the allowance; record the approved account-isolation,
  data-reduction or billing decision. Recheck billing-period metrics separately
  rather than inferring the monthly average from one current-size snapshot.
  [#1192](https://github.com/wilhel1812/LinkSim/issues/1192) records the
  maintainer's bounded billing decision: approximately USD 0.06/month of
  incremental LinkSim R2 storage is accepted at the 3.31 GB sensitivity, the
  unrelated account charge remains outside LinkSim, the 3 GB-per-environment
  and 6 GB-combined caps remain, and any higher estimate needs a new decision.
  That decision resolves the billing choice, but the linked inventory predates
  production bucket provisioning and must be rerun before activation.
  Completed on 2026-09-26 in the
  [post-provision inventory](../experiments/better-auth/evidence/2026-09-26-r2-post-provision-inventory.md):
  all six account buckets were classified, the unbound production history
  bucket contained zero objects and zero bytes, staging history remained at
  five objects and 824 kB, and combined history remained below the 6 GB cap.
  The unrelated bucket still exceeded 10 GB in both the current summary and a
  separate September-to-date average-daily-peak query. The sustained Free-tier
  gate therefore still fails, but #1192's bounded billing exception covers
  that exact condition without changing either archive cap. Archive activation
  and every other production action remain separately gated.
- [x] Record and approve the
  [numeric production stop/rollback triggers](../experiments/better-auth/evidence/2026-09-25-production-stop-triggers.md)
  before the window. `wilhel1812` is the authorized operator and approving
  maintainer. The evidence defines warning, intake-stop, archive-stop and
  Access-first/read-only rollback conditions for resource-limit errors, daily
  Worker, Durable Object and D1 usage, and D1/R2 storage. Recheck the dated
  platform allowances before cutover; a changed allowance requires review, not
  silent percentage reinterpretation.
- [ ] Configure and verify a protected post-cutover authentication canary before
  the window. Run it once per minute through the first hour, once every five
  minutes for the rest of the first day, and at least once every fifteen minutes
  through the first week. The protected workflow runs every five minutes during
  that week to tolerate ordinary GitHub Actions queue delays and reduce the risk
  of missing a fifteen-minute window.
  A canary timeout, connection failure, retryable `5xx`, or
  unexpected `401`/`403` that still fails after one retry starts the ordered
  rollback regardless of natural request volume. Record where its
  unexpired, unrevoked credential is held, how it is rotated or revoked, and how
  the operator receives failures without exposing the credential.
- [x] Complete and record the stable-staging VoiceOver spot-check required by
  `docs/auth-transition.md`: sign-in choices, native passkey handoff
  announcements, Profile credential actions, actionable error/fallback guidance,
  and focus return. Record the tested build in the release evidence; do not
  begin cutover while this human-only check remains open.
  The maintainer completed and accepted this check on 2026-09-25 against stable
  staging build `v0.29.0+8829bafc`; the canonical evidence is recorded in
  [#1188](https://github.com/wilhel1812/LinkSim/issues/1188) and
  [#1107](https://github.com/wilhel1812/LinkSim/issues/1107). The browser/device
  was not recorded. On 2026-09-26 the maintainer explicitly waived that metadata
  for the current release, so its absence is non-blocking and this gate is
  complete. The waiver does not remove automated accessibility coverage or the
  completed human sign-off.
- [ ] Create a production-only GitHub OAuth application with callback
  `https://linksim.link/api/auth/callback/github`.
- [ ] Create a production-only Turnstile widget for `linksim.link`.
- [ ] Prepare distinct production values for `BETTER_AUTH_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `TURNSTILE_SITE_KEY`, and
  `TURNSTILE_SECRET_KEY`. Never copy staging values.
- [ ] Prepare the protected client build inputs from
  `config/production-auth-build.env.example`: set `VITE_BETTER_AUTH_PILOT=true`
  and replace `VITE_TURNSTILE_SITE_KEY` with the public key from that exact
  production widget. Verify both values are present in the release build.
- [ ] Run `node scripts/access-boundary.mjs plan-cutover production` with a
  read-only Access token. It must show exactly one change:
  `linksim.link/api/*` to `linksim.link/api/auth/legacy-access/*`.
- [ ] Before cutover, `node scripts/access-boundary.mjs plan-rollback production`
  must show zero changes because the broad boundary is already restored. Repeat
  it after the Access change and require exactly the inverse one-change plan.
- [ ] Review the production Better Auth schema probe and migrations. Confirm
  normal production automation skips them while auth mode remains inactive.
- [ ] Prepare and review the activation candidate that changes
  `config/production-auth-mode.json` to `active: true` while keeping
  `accessBoundary: broad`. Prepare a separate post-Access candidate that keeps
  auth active and changes only `accessBoundary` to `legacy`. Stage and validate
  both before the production freeze.

### Protected canary configuration

The dormant `.github/workflows/auth-canary.yml` workflow and
`scripts/auth-canary.mjs` probe implement the required cadence without adding a
Cloudflare Health Check, which is unavailable on the Free plan. The workflow
does nothing on scheduled runs until all three protected environment values are
present. It rejects redirects, requires the exact LinkSim user ID from
`/api/me`, retries rollback-qualifying failures once, and never includes the
cookie or response body in its logs or incident issue. Other response failures
fail the workflow for diagnosis without opening a rollback incident.

Create separate `staging-canary` and `production-canary` GitHub environments.
Under each environment's deployment branches and tags, choose **Selected
branches and tags**. Add exactly one branch rule and no tag rules: `staging` for
`staging-canary`, and `main` for `production-canary`. Do not choose **Protected
branches only**, because both repository branches are protected and that option
would expose each environment to both branches. This exact-branch protection is
mandatory because a manually dispatched workflow definition runs from its
selected ref before checking out the target branch.
Each holds:

- secret `AUTH_CANARY_COOKIE`: the complete Cookie header containing only the
  Better Auth session cookie;
- variable `AUTH_CANARY_EXPECTED_USER_ID`: the stable LinkSim ID of the ordinary
  canary account;
- variable `AUTH_CANARY_CUTOVER_AT`: the exact UTC cutover timestamp. For the
  staging rehearsal, use the rehearsal start time and remove the values after
  verification.

Use a dedicated ordinary account without administrator rights or owned user
data where practical. Create the session through a normal library-managed
GitHub or passkey sign-in; do not manufacture a session or cookie. Confirm its
server-side expiry covers the monitoring period. Rotation means signing in
normally again, replacing the environment secret, verifying a single probe,
then revoking the old session. Removing the environment secret and revoking the
session retires the canary.

Before the production window, run the probe against staging with a real
staging session and record its workflow or command evidence. At cutover, start
the protected `first-hour` workflow immediately after the application boundary
is verified. The scheduled workflow runs every five minutes for the remaining
monitoring period to tolerate queue delays. A rollback-qualifying final failure
creates or updates one target-specific GitHub Actions issue and links the
protected workflow run and exact checked-out revision.
A production failure is critical and starts the ordered rollback; a staging
failure blocks the rehearsal without declaring a production incident. Scheduled
runs stop probing after seven days, but the workflow should be disabled or its
protected values removed after the first-week review.

## Start the 90-day claim window

At the approved cutover, record one UTC timestamp. Set
`AUTH_LEGACY_CLAIM_DEADLINE` to exactly 90 days after it in both dormant configs.
Record both values in the release evidence. Do not estimate the deadline before
the cutover time is known.

Enable `AUTH_DUAL_LOGIN_MIGRATION_ENABLED`, `AUTH_LEGACY_CLAIM_ENABLED`, and
`AUTH_REGISTRATION_ENABLED` only in the reviewed cutover candidate. Temporarily
enable `AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED` in both Pages and runtime for
the administrator bootstrap below. The dormant files keep all four disabled so
an accidental deployment fails closed.

## Ordered cutover

The checked-in preparation defaults intentionally keep authentication disabled.
The reviewed activation release sets the recorded deadline and approved flags,
changes `active` to `true` while retaining the broad boundary, and reaches
production through the normal tagged release and protected environment. The
same protected job then performs the first three steps and permanently selects
the auth configuration for later normal production releases. The manual
`prod-auth-cutover` target remains available for a separately approved rerun and
requires confirmation `APPROVE_PRODUCTION_AUTH_CUTOVER`.

1. Probe production D1. Apply, in order, the reviewed additive migrations
   `2026-09-19_better_auth_schema.sql`,
   `2026-09-21_auth_migration_attempt.sql`, and
   `2026-09-23_privileged_passkey_recovery.sql`, then rerun
   `db/probes/better-auth-schema.sql`.
2. Put the five production secrets on `linksim-auth-runtime-production` and
   deploy `workers/auth-runtime/wrangler.production.toml`.
3. Build with the two verified production client inputs, then deploy the
   reviewed Pages candidate using `wrangler.production-auth.toml` while broad
   `/api/*` Access protection remains in place.
4. Verify runtime health, exact trusted origin, secure production cookies,
   production passkey RP ID, and that Access still redirects anonymous API
   requests with the recorded audience.
5. Before narrowing Access, bootstrap the legacy administrator:
   - run `node scripts/manage-admin-passkey-recovery.mjs production list` and
     verify the exact unmigrated administrator UUID;
   - authorize it for 15 minutes with
     `node scripts/manage-admin-passkey-recovery.mjs production authorize <user-uuid> 15`;
   - open
     `https://linksim.link/api/auth/legacy-access/start?recovery=passkey&returnTo=%2Fsettings%2Fprofile`,
     complete the passkey ceremony, and verify administrator settings, roles and
     the migration progress view;
   - revoke an abandoned authorization with
     `node scripts/manage-admin-passkey-recovery.mjs production revoke <authorization-uuid>`;
   - set `AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED=false` in Pages and runtime,
     promote the reviewed retirement candidate through the protected release,
     and verify that new recovery attempts are rejected.
6. Copy the reviewed auth values into the active production Terraform variables,
   replace the namespace and deadline placeholders, and keep privileged recovery
   `false`. Run the protected plan/apply and require a zero-drift follow-up plan.
   Future Terraform applies must retain these values so they cannot remove the
   auth binding or re-enable recovery.
7. Freeze production deployments. Apply the single reviewed Access change,
   preserving the existing application, audience and allow policy. Do not create
   a replacement app. Immediately promote the already-reviewed boundary candidate
   that changes `accessBoundary` to `legacy`; its deployment must pass the strict
   application-`401` and legacy-Access redirect check. Until that candidate lands,
   a normal deployment fails its broad-boundary precheck and cannot redeploy the
   old Pages configuration because auth remains active.
8. Immediately verify the anonymous shell and public routes, application JSON
   `401` responses, legacy Access redirect and audience, GitHub login/logout,
   revoked sessions, passkeys, claims, dual-login migration, administrator roles,
   migration progress, supported deep links, cloud sync and local unsynced work.
9. Record deployed SHAs/configuration and the post-cutover usage/error baseline.

## Rollback

Rollback order is security-sensitive:

1. Disable registration, automatic claims and new migration attempts.
2. Restore the broad `/api/*` Access boundary first. Verify its redirect and
   exact audience before changing Pages or the auth runtime.
3. Change `accessBoundary` back to `broad` in the reviewed fallback candidate,
   then deploy the tested transition/read-only fallback. Set `active` to `false`
   only if the fallback deliberately returns normal releases to `wrangler.toml`.
   Preserve additive schemas, identity mappings, credentials, audit history and
   local work.
4. Confirm existing Better Auth users are not remapped or deleted. Access alone
   cannot serve newly registered users, so communicate the fallback state.

The repository exposes production Access changes as read-only plans only. Make
the reviewed dashboard/API mutation during the separately approved window, then
rerun both plans to prove the desired boundary and its inverse rollback.

## Monitoring and retirement

- [ ] Review errors, auth-runtime duration, D1 rows read/written, Worker/Pages
  requests, Durable Object usage and alerts during the first hour and full day.
  Apply the recorded stop/rollback triggers when their numeric conditions are
  met; confirm the protected canary maintained its required first-hour and
  first-day cadence, and record the observation and action in the release evidence.
- [ ] Review the same account-wide figures after one week against the accepted
  capacity baseline and 1,000-registered-user target. Confirm the protected
  canary maintained its required first-week cadence.
- [ ] Track migrated ordinary and privileged accounts in the administrator view.
- [ ] After 90 days, separately approve disabling email claims and the temporary
  dual-login route. Retain mappings and migration audit records.
- [ ] Retire obsolete Access verification only after the remaining accounts and
  rollback evidence have been reviewed.
