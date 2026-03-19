# Staging Environment

This project supports a separate staging stack with production-like data.

## What is configured

- Staging Worker environment in [`wrangler.staging.toml`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/wrangler.staging.toml)
- Staging avatar fallback to production origin while staging R2 catches up
- Staging scripts in [`package.json`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/package.json)
- Custom domain: https://staging.linksim.link
- Refresh scripts:
  - [`scripts/refresh-staging-d1.sh`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/scripts/refresh-staging-d1.sh)
  - [`scripts/refresh-staging-r2.sh`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/scripts/refresh-staging-r2.sh)

## Routine workflows

### Deploy to staging (test environment)

```bash
npm run deploy:staging
```

This deploys the current branch to `main` branch in Cloudflare Pages, which is served by https://staging.linksim.link

### Deploy to preview (side-by-side comparison)

```bash
npm run deploy:staging:preview
```

This creates a separate preview URL for side-by-side comparisons.

### Refresh staging DB from production D1

```bash
npm run refresh:staging:d1
```

By default, this now anonymizes user personal fields in staging after import (`ANONYMIZE_STAGING=1`).
To skip anonymization explicitly:

```bash
ANONYMIZE_STAGING=0 npm run refresh:staging:d1
```

### Refresh staging avatars bucket from production R2

Requires AWS CLI and R2 S3 credentials in your environment.

```bash
export R2_ACCOUNT_ID=<cloudflare-account-id>
export AWS_ACCESS_KEY_ID=<r2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
npm run refresh:staging:r2
```

### Full refresh + deploy

```bash
npm run refresh-and-deploy:staging
```

## Recommended cadence

- Every commit/PR: `npm run deploy:staging` → test at https://staging.linksim.link
- Before acceptance/regression testing: `npm run refresh-and-deploy:staging`

## Safety notes

- Refresh is one-way: production -> staging
- Do not point staging bindings at production resources
- Keep staging Access policy restricted (admin/mod only)
- Keep `ANONYMIZE_STAGING=1` unless you have a documented operational need otherwise

## URLs

| Environment | URL | Access |
|------------|-----|--------|
| Staging (test) | https://staging.linksim.link | ✅ Works with Access |
| Preview | Preview URL (shown after deploy) | May require configuration |
| Production | https://linksim.link | ✅ Works with Access |
