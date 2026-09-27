# Production auth release preparation — 2026-09-27

This record began with pre-activation preparation and now tracks the final
cutover candidate. Production `v0.29.1` runs Better Auth behind broad
Cloudflare Access; public routing has not changed. Credential values are not
included.

## Protected credentials

- Created the GitHub OAuth application `LinkSim Production` with homepage
  `https://linksim.link` and the exact callback
  `https://linksim.link/api/auth/callback/github`. Wildcard callbacks and device
  flow are disabled; expiring user access tokens are enabled.
- Created the managed Turnstile widget `LinkSim production auth` for the exact
  hostname `linksim.link`, with pre-clearance disabled.
- Stored five distinct values in the protected GitHub `production` environment:
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_GITHUB_CLIENT_ID`,
  `BETTER_AUTH_GITHUB_CLIENT_SECRET`, `VITE_TURNSTILE_SITE_KEY`, and
  `TURNSTILE_SECRET_KEY`. GitHub reported updates between
  `2026-09-27T06:27:23Z` and `2026-09-27T06:31:45Z`.
- No credential value was written to the repository or this evidence record.

## Canary readiness

- The protected staging canary passed again after the `v0.29.3` staging deploy
  in workflow run `36316447116`, against
  `https://staging.linksim.link/api/me` for the configured ordinary account.
- The `production-canary` environment is restricted to the exact `main` branch
  with no tag rule. On 2026-09-27, the maintainer migrated and signed in an
  ordinary, non-admin account. Its fresh production Better Auth session cookie
  was loaded into the protected environment secret, and the expected user ID
  was updated to match it. The temporary local handoff copy was removed; no
  credential value is recorded here.
- `AUTH_CANARY_CUTOVER_AT` was removed after the missed 13:30 UTC window.
  Set it to `2026-09-27T15:00:00.000Z` only after final release gates pass;
  scheduled production probes are currently dormant. The initial server-side session expiry
  is `2026-10-04T11:07:16.689Z`; Better Auth has a one-day rolling update age.
  Verify that probing extends the expiry after the first day, and rotate the
  credential before expiry if it does not. The canary gate remains open until
  a protected production probe succeeds after cutover.

## Access boundary plans

The live Access inventory exposed two planner assumptions that failed closed:
Cloudflare now returns the current authenticated API destination explicitly,
and the established public API-exceptions application was absent from the
production inventory model. The model now records both facts and keeps the
public exception application immutable.

With a temporary account token limited to D1 Write plus Access Apps and Policies
Read, the final read-only plans reported:

```text
[access-boundary] production plan: 1 application update(s).
[access-boundary] api: linksim.link/api/* -> linksim.link/api/auth/legacy-access/*
[access-boundary] production plan: 0 application update(s).
```

The first result is the cutover plan. The second is the pre-cutover rollback
plan. No Access application or policy has been mutated. The original rehearsal
token was deleted after the plans and D1 rehearsal; a separately scoped
temporary cutover token is held outside this repository and must be revoked
after the production window.

## D1 migration rehearsal

Wrangler warned that exporting the production D1 database could make it
unavailable while the export ran. The export was cancelled before it started;
no production export file was created and the production database remained
queryable. A live-data clone was therefore not used.

Instead, a disposable D1 database was created in EEUR from `db/schema.sql` and
used to validate the migration mechanics without touching production:

- database: `linksim-auth-rehearsal-20260927-064017`
- database ID: `21e0fc9a-3476-43e5-9e9c-7cf4cce48982`
- applied, in order:
  `2026-09-19_better_auth_schema.sql`,
  `2026-09-21_auth_migration_attempt.sql`, and
  `2026-09-23_privileged_passkey_recovery.sql`
- `db/probes/better-auth-schema.sql`: passed all 18 probe queries
- idempotence: all three migrations passed a second application
- resulting inventory: 22 tables total, including 9 `auth_` tables, and 10
  `auth_` indexes

The disposable database was permanently deleted and verified absent. Its local
logs and temporary directory were also removed. This proves ordering, schema,
index and idempotence behavior on the current base schema, but not migration
behavior against a copy of live production rows.

The protected `v0.29.0` production deployment applied the additive Better Auth
schema. A read-only production probe on 2026-09-27 passed all 18 statements
with zero rows written. The workflow continues to probe this schema on active
auth releases and applies migrations idempotently if needed.

## Remaining before public activation

- Verify the final immutable candidate on staging and approve its protected
  main promotion without moving the superseded `v0.29.2` through `v0.29.6`
  tags.
- At the reviewed window, narrow exactly one Access application, immediately
  promote the exact tagged candidate, and run the protected production canary.
- Restore broad Access first if a rollback trigger occurs. Continue the
  recorded first-hour, first-day, and first-week monitoring after success.

## Approved release window

- The maintainer approved completing the production rollout on 2026-09-27.
- The 10:00 and 11:00 UTC targets passed while protected release gates remained
  open; neither was a public cutover. The maintainer then asked to move the
  pending 15:00 UTC window earlier. The 13:30 UTC target then passed without
  public cutover while protected gates remained open. The reviewed activation
  window is now `2026-09-27T15:00:00Z` (`2026-09-27 17:00 CEST`). If final candidate validation
  is not complete by then, advance the timestamp and prepare a new candidate;
  never backdate the cutover.
- The corresponding 90-day legacy-claim deadline is
  `2026-12-26T15:00:00.000Z`.
- The `v0.29.0` candidate activates Better Auth while retaining broad Access
  and temporarily enables privileged passkey recovery for the administrator
  bootstrap.
- The `v0.29.1` candidate keeps Better Auth active and broad Access available,
  but permanently disables new privileged passkey-recovery attempts after the
  administrator bootstrap.
- The immutable `v0.29.2` through `v0.29.6` candidates were not promoted after
  release-review findings or missed cutover windows. The `v0.29.7` candidate
  keeps Better Auth active and privileged passkey recovery disabled, and
  expects the legacy-only Access boundary before production deployment.
