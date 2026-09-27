# Production auth release preparation — 2026-09-27

This record covers preparation that does not change production routing, deploy a
production build, or migrate the production database. Credential values are not
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

- A staging canary probe passed on 2026-09-26 against
  `https://staging.linksim.link/api/me` for the configured ordinary staging
  account.
- The `production-canary` environment is restricted to the exact `main` branch
  with no tag rule. Its expected user ID is configured for the administrator
  account selected for this release. This is weaker than the preferred
  ordinary-user canary and is an explicitly accepted limitation.
- The production canary cookie and `AUTH_CANARY_CUTOVER_AT` remain unset. They
  require a fresh production session and the approved production window, so the
  canary gate is not complete and no scheduled production probe can activate.

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
plan. No Access application or policy was mutated. The temporary token was
deleted after the plans and D1 rehearsal, and its absence was verified in the
account token inventory.

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

The production workflow applies and probes the Better Auth schema only when the
explicit target is `prod-auth-cutover` or the immutable release candidate has
`config/production-auth-mode.json.active` set to `true`. Normal production
automation therefore continues to skip these migrations while auth mode is
inactive.

## Remaining before production activation

- Create a fresh production Better Auth session for the selected canary account
  and store only its session cookie in `production-canary`.
- Choose the production cutover timestamp and set
  `AUTH_CANARY_CUTOVER_AT`; derive the exact legacy-claim deadline as 90 days
  after that timestamp.
- Build, review, and stage the immutable `v0.29.0`, `v0.29.1`, and `v0.29.2`
  candidates. These are preparation only; merging to `main`, deploying
  production, changing Access, and applying the production D1 migrations remain
  separately gated production actions.

## Approved release window

- The maintainer approved completing the production rollout on 2026-09-27.
- The planned activation timestamp moved forward to `2026-09-27T11:00:00Z`
  (`2026-09-27 13:00 CEST`) after the original 10:00 UTC target passed during
  the protected `v0.29.1` production deployment. If candidate validation is not complete by that
  time, the timestamp must move forward before the activation candidate is
  frozen; it must never be backdated.
- The corresponding 90-day legacy-claim deadline is
  `2026-12-26T11:00:00.000Z`.
- The `v0.29.0` candidate activates Better Auth while retaining broad Access
  and temporarily enables privileged passkey recovery for the administrator
  bootstrap.
- The `v0.29.1` candidate keeps Better Auth active and broad Access available,
  but permanently disables new privileged passkey-recovery attempts after the
  administrator bootstrap.
- The `v0.29.2` candidate keeps Better Auth active and privileged passkey
  recovery disabled, and changes the expected Access boundary to `legacy` for
  the public cutover.
