# Staging Environment

This project now supports a separate staging stack with production-like data.

## What is configured

- Staging Worker environment in [`wrangler.staging.toml`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/wrangler.staging.toml)
- Staging scripts in [`package.json`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/package.json)
- Refresh scripts:
  - [`scripts/refresh-staging-d1.sh`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/scripts/refresh-staging-d1.sh)
  - [`scripts/refresh-staging-r2.sh`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/scripts/refresh-staging-r2.sh)

## One-time setup

1. Create staging D1:

```bash
npx wrangler d1 create linksim_staging
```

2. Create staging R2 bucket:

```bash
npx wrangler r2 bucket create linksim-avatars-staging
```

3. Confirm [`wrangler.staging.toml`](/Users/wilhelmfrancke/Applications/CodexSandboxGeneric/LinkSim/wrangler.staging.toml) has:
- Staging D1 database ID
- Staging Access AUD

4. Create a Cloudflare Pages project for staging (recommended name: `linksim-staging`).

## Routine workflows

### Deploy staging code only (fast)

```bash
npm run deploy:staging
```

Optional custom staging project name:

```bash
CF_PAGES_STAGING_PROJECT=my-staging-project npm run deploy:staging
```

### Refresh staging DB from production D1

```bash
npm run refresh:staging:d1
```

Optional DB names:

```bash
PROD_DB_NAME=linksim STAGING_DB_NAME=linksim_staging npm run refresh:staging:d1
```

### Refresh staging avatars bucket from production R2

Requires AWS CLI and R2 S3 credentials in your environment.

```bash
export R2_ACCOUNT_ID=<cloudflare-account-id>
export AWS_ACCESS_KEY_ID=<r2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
npm run refresh:staging:r2
```

Optional bucket names:

```bash
PROD_R2_BUCKET=linksim-avatars STAGING_R2_BUCKET=linksim-avatars-staging npm run refresh:staging:r2
```

### Full refresh + deploy

```bash
npm run refresh-and-deploy:staging
```

## Recommended cadence

- Every commit/PR: `npm run deploy:staging`
- Before acceptance/regression testing: `npm run refresh-and-deploy:staging`

## Safety notes

- Refresh is one-way: production -> staging
- Do not point staging bindings at production resources
- Keep staging Access policy restricted (admin/mod only)
