# Staging Environment

This project supports a separate staging stack with production-like data.

## What is configured

- Staging Worker environment in [`wrangler.staging.toml`](../wrangler.staging.toml)
- Private history bucket `linksim-history-staging` bound only to stable staging.
  Preview builds use a separate Wrangler configuration without that binding.
- Private `linksim-auth-runtime-staging` Durable Object bound only to stable
  staging. Pages uses its RPC session check under the existing Access API
  boundary; the Worker has no public route or `workers.dev` hostname.
- Stable-staging-only registration, legacy-claim and paired-login feature gates.
  Preview and production configurations omit these gates.
- Staging avatar fallback to production origin while staging R2 catches up
- Staging scripts in [`package.json`](../package.json)
- Custom domain: https://staging.linksim.link
- Refresh scripts:
  - [`scripts/refresh-staging-d1.sh`](../scripts/refresh-staging-d1.sh)
  - [`scripts/refresh-staging-r2.sh`](../scripts/refresh-staging-r2.sh)

## Routine workflows

### Deploy to staging (test environment)

Merge a PR into `staging`. CI automatically runs the guarded staging deploy to https://staging.linksim.link.

Do not run `npm run deploy:staging` locally for routine verification; Cloudflare deploy credentials are only expected in CI.

### Deploy to preview (side-by-side comparison)

Same-repository pull requests targeting `staging` receive an automatic preview
after the authenticated-preview rollout gate is enabled. Fork pull requests do
not receive Cloudflare secrets and are never deployed by this workflow.

The workflow keeps one signed PR comment current as the head SHA changes. The
preview uses only `linksim_staging` and `linksim-avatars-staging`; shared staging
remains the acceptance environment. Previews cannot read the private history bucket.

Keep the repository variable `ENABLE_AUTHENTICATED_PREVIEWS` unset until the
Pages root and wildcard preview hostnames are protected by Access, their AUD
values are present in the preview Pages configuration, and a reviewed Terraform
plan contains no destruction. Set it to `true` only after that gate passes.

For an explicitly requested operator deployment, `npm run
deploy:staging:preview -- --branch <safe-branch>` remains available. Do not use
it for routine verification.

### Paired legacy migration rehearsal

Use synthetic legacy accounts only. The legacy proof route remains the narrow
Access-protected `/api/auth/legacy-access/*` application while ordinary staging
APIs use Better Auth. A successful rehearsal must show all three effects for the
same ten-minute attempt: one unique `auth_identity_map` row, a consumed
`auth_migration_attempt`, and one `better_auth_dual_login` audit event. Replays,
expired attempts, conflicting mappings and blocked/deleted/superseded/revoked
accounts must not change ownership. A repeated completion request for the exact
already-consumed attempt may return its prior success only while the same fresh
GitHub identity, exact mapping, and current eligible LinkSim account still match;
it never consumes the attempt or writes another audit event.
Start the rehearsal from **Move existing Cloudflare account** in the existing
sign-in popover. The migration modal then owns the Access proof, GitHub proof,
Turnstile challenge and final binding until completion. Ordinary GitHub remains
the registration path and must not silently send new users through Access.

Disabling `AUTH_DUAL_LOGIN_MIGRATION_ENABLED` in both staging Wrangler configs
is the rollback switch for new attempts and assisted recovery. Existing mappings
remain valid. `AUTH_LEGACY_CLAIM_ENABLED` and `AUTH_REGISTRATION_ENABLED` can be
disabled independently to stop automatic claims or new accounts while keeping
already mapped users signed in.

### Refresh staging DB from production D1

```bash
npm run refresh:staging:d1
```

The refresh inventories both databases and rejects unclassified tables or mismatched
application table sets; align schemas before refreshing. It exports
only the explicitly listed application tables; authentication tables, sessions,
provider credentials, passkeys, mappings, and migration proofs are excluded. User
contact/display fields and avatar references are sanitized locally **before**
import, while legacy claim relationships remain consistent. Operational notices
and their audits, and user identity audit entries, are not copied. Private
temporary files are deleted on exit. Unsanitized imports and target overrides
are rejected.

This is a private application-data fixture, not a fully anonymous public dataset:
resource payloads, history, locations, application IDs, and permissions remain.
Use synthetic accounts for authentication/migration tests. A staging database
may retain its own authentication tables and identity mappings while the
allowlisted application tables are replaced. Production authentication data is
never included in the export, and the refresh never overwrites enrolled staging
credentials, sessions, passkeys, or mappings. A retained mapping can temporarily
refer to a LinkSim user absent from the refreshed application fixture; runtime
authentication must continue to reject it unless that current application user
exists and remains eligible.
The staging archive schema is additive; it does not enable application archive
writes. Inline-only refreshes need no history-bucket credentials. If production
history later contains archived rows, the refresh verifies each source object,
copies its full envelope into the separate staging history bucket, verifies the
copy, then rewrites only its D1 key and digest in the sanitized export before
import. Missing/corrupt objects, incomplete references, unknown tables or
failed copies stop the import; already written staging objects are retained as
immutable orphans because a previous D1 backup may reference them. The plain
`staging-export.mjs sanitize` mode remains fail-closed for archived references.

For archived-source refreshes, provision a **read-only** S3 API credential for
the fixed production `linksim-history` bucket and a separate **read/write**
credential for `linksim-history-staging`. Set `R2_ACCOUNT_ID`,
`R2_HISTORY_SOURCE_ACCESS_KEY_ID`, `R2_HISTORY_SOURCE_SECRET_ACCESS_KEY`,
`R2_HISTORY_STAGING_ACCESS_KEY_ID` and
`R2_HISTORY_STAGING_SECRET_ACCESS_KEY` in the operator's shell. Do not save them
in the repository or use the production write credential for refresh. The
production history bucket is not yet configured, so this path has synthetic
test coverage but no live archived-production rehearsal. It is not permission
to enable production archiving or authentication. A full refresh still replaces
application tables in the staging D1; use it only as an intentional operator
action, then verify mixed archived/inline history on staging.

### Refresh staging avatars bucket from production R2

Requires AWS CLI and R2 S3 credentials in your environment.

```bash
export R2_ACCOUNT_ID=<cloudflare-account-id>
export AWS_ACCESS_KEY_ID=<r2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
npm run refresh:staging:r2
```

### Full refresh + deploy

Run the refresh scripts only when explicitly needed, then merge a staging PR and let CI deploy. Do not run deploy scripts locally for routine staging verification.

## Recommended cadence

- Every merged staging PR: CI deploys automatically → test at https://staging.linksim.link
- Before acceptance/regression testing: refresh staging data only when needed, then rely on CI for deploy

## Safety notes

- Refresh is one-way: production -> staging
- Do not point staging bindings at production resources
- Keep staging branch previews and the legacy migration proof path behind
  Access. Stable staging APIs reach LinkSim's Better Auth guard. The custom app
  shell is intentionally public so guest behavior and sign-up can be tested.
- Unsanitized D1 refreshes are disabled; no production authentication data may enter staging.

## URLs

| Environment | URL | Access |
|------------|-----|--------|
| Staging (test) | https://staging.linksim.link | Public shell; Better Auth on `/api/*`; Access on `/api/auth/legacy-access/*` |
| Pull request preview | Signed PR comment URL | Access-protected after rollout gate |
| Production | https://linksim.link | ✅ Works with Access |

Credentialed browser API requests are same-origin only. Each pull-request
preview uses its own `https://<preview>.linksim-staging.pages.dev` API; it does
not call the shared-staging API cross-origin. Originless API clients remain
supported, while production, staging, and preview browser origins cannot call
one another.

Stable staging runs the auth boundary in `better-auth` mode. A mapped Better
Auth session is required for protected application APIs; the narrow legacy path
retains Access for dual-login migration work. Preview and production deployments
do not receive the Durable Object binding or Better Auth session-source variable.
