# Release Flow

## Default rule
- Unless explicitly stated otherwise, work in the local test environment.

## Delivery sequence
1. Local test
- Implement changes locally.
- Run verification (`npm test`, `npm run build`, and manual local checks).

2. Live test (staging)
- Deploy code to staging using `npm run deploy:staging` (or `npm run deploy:staging:feature`).
- Verify the same commit in the live test environment at https://linksim-staging.pages.dev
- Use explicit guarded commands only:
  - Default staging deploy (recommended): `npm run deploy:staging` or `npm run deploy:staging:feature`
  - Main branch to staging: `npm run deploy:staging:main` (requires `main` branch)
  - Preview URL only: `npm run deploy:staging:preview` (separate URL, not recommended)

3. Production
- Promote only after explicit user approval.
- Deploy the exact verified staging commit to production (no extra code changes in between).
- Use explicit guarded command only: `npm run deploy:prod:main`

## Guardrails
- No direct production hotfixes unless explicitly requested by the user.
- Always report deployed commit SHA for staging and production.
- Keep clear non-production indicators enabled for local/staging environments.
- Do not run raw `wrangler pages deploy` for release operations.
- All deploys must pass scripted preflight checks:
  - clean git tree
  - valid target config (project/bindings)
  - branch policy (`main` required for `staging-main` and `prod-main`)
  - remote D1 schema gate for required columns (deploy aborts if migrations are missing)
- All deploys must pass scripted post-deploy verification against Cloudflare deployment list.

## Versioning Policy
- SemVer is mandatory (`MAJOR.MINOR.PATCH`).
- Current baseline: `0.9.14`.
- Bump level decision rules:
  - `PATCH` (`0.9.x`): bug fixes, polish, performance tuning, and non-breaking UX behavior fixes.
  - `MINOR` (`0.x.0`): new user-facing features or meaningful workflow additions that are backward-compatible.
  - `MAJOR` (`x.0.0`): breaking changes (data model incompatibility, removed/renamed API behavior, auth/permission model breaks), or first stable `1.0.0` declaration.
- Environment bump rules:
  - Same commit must keep the same base SemVer (`X.Y.Z`) in all environments.
  - Build label channel by environment:
    - Local: `vX.Y.Z-alpha+<commit>`
    - Staging: `vX.Y.Z-beta+<commit>`
    - Production: `vX.Y.Z`
  - Live production: SemVer bump is required before release.
- Version bump required for `staging:main` and `prod:main` deploys (release candidates).
- Version bump optional for `staging:feature` deploys (can use current version for testing).

## Iteration Rules
- Default loop for every task:
  1. Implement in local test.
  2. Verify (`npm test`, `npm run build`, manual QA).
  3. Commit and push.
  4. Deploy to staging using `npm run deploy:staging` and verify.
  5. Promote to production only with explicit approval.
- No hidden scope changes during promotion; if code changes after staging verification, restart the loop.

## CI/CD Controls
- GitHub Actions deploy workflow is manual (`workflow_dispatch`) with explicit target selection:
  - `staging-main`
  - `prod-main`
- `prod-main` job runs in the `production` GitHub environment (configure required reviewers in repo settings).
- `staging-main` runs in `staging` environment.

## Deploy Targets Reference
| Target | Branch Required | URL | Use Case |
|--------|----------------|-----|----------|
| `deploy:staging` / `deploy:staging:feature` | Any | https://linksim-staging.pages.dev | Testing feature branches |
| `deploy:staging:main` | `main` | https://linksim-staging.pages.dev | Release candidates |
| `deploy:staging:preview` | Any | Preview URL | Side-by-side comparison |
| `deploy:prod:main` | `main` | https://linksim.pages.dev | Production release |
