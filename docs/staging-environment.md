# Staging Environment

This project supports a separate staging stack with production-like data.

## What is configured

- Staging Worker environment in [`wrangler.staging.toml`](../wrangler.staging.toml)
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
remains the acceptance environment.

Keep the repository variable `ENABLE_AUTHENTICATED_PREVIEWS` unset until the
Pages root and wildcard preview hostnames are protected by Access, their AUD
values are present in the preview Pages configuration, and a reviewed Terraform
plan contains no destruction. Set it to `true` only after that gate passes.

For an explicitly requested operator deployment, `npm run
deploy:staging:preview -- --branch <safe-branch>` remains available. Do not use
it for routine verification.

### Refresh staging DB from production D1

```bash
npm run refresh:staging:d1
```

The refresh inventories both databases and rejects unclassified tables. It exports
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
with auth tables is deliberately blocked until an explicit credential reset
workflow is added; never overwrite enrolled staging identities implicitly.

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
- Keep staging authenticated APIs and branch previews behind Access. The custom
  app shell is intentionally public so guest behavior and sign-up can be tested.
- Unsanitized D1 refreshes are disabled; no production authentication data may enter staging.

## URLs

| Environment | URL | Access |
|------------|-----|--------|
| Staging (test) | https://staging.linksim.link | Public shell; Access on `/api/*` |
| Pull request preview | Signed PR comment URL | Access-protected after rollout gate |
| Production | https://linksim.link | ✅ Works with Access |

Credentialed browser API requests are same-origin only. Each pull-request
preview uses its own `https://<preview>.linksim-staging.pages.dev` API; it does
not call the shared-staging API cross-origin. Originless API clients remain
supported, while production, staging, and preview browser origins cannot call
one another.
