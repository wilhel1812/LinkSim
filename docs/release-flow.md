# Release Flow

## Default rule
- Unless explicitly stated otherwise, work in the local test environment.

## Delivery sequence
1. Local test
- Implement changes locally.
- Run verification (`npm test`, `npm run build`, and manual local checks).

2. Live test (staging)
- Deploy code to staging using `npm run deploy:staging`.
- Verify at https://staging.linksim.wilhelmfrancke.com
- Use explicit guarded commands only:
  - Staging deploy: `npm run deploy:staging` (deploys current branch to main → served by staging.linksim.wilhelmfrancke.com)
  - Preview URL: `npm run deploy:staging:preview` (separate preview URL for side-by-side comparison)

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
  - branch policy (`main` required for `prod-main`)
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
- Version bump required for `prod:main` deploys (release candidates).

## Iteration Rules
- Default loop for every task:
  1. Implement in local test.
  2. Verify (`npm test`, `npm run build`, manual QA).
  3. Commit and push.
  4. Deploy to staging using `npm run deploy:staging` and verify at https://staging.linksim.wilhelmfrancke.com.
  5. Promote to production only with explicit approval.
- No hidden scope changes during promotion; if code changes after staging verification, restart the loop.

## CI/CD Controls
- GitHub Actions deploy workflow is manual (`workflow_dispatch`) with explicit target selection:
  - `staging`
  - `prod-main`
- `prod-main` job runs in the `production` GitHub environment (configure required reviewers in repo settings).
- `staging` runs in the `staging` environment.

## Deploy Targets Reference
| Target | URL | Description |
|--------|-----|-------------|
| `deploy:staging` | https://staging.linksim.wilhelmfrancke.com | Test environment (main branch) |
| `deploy:staging:preview` | Preview URL | Side-by-side comparison |
| `deploy:prod:main` | https://linksim.wilhelmfrancke.com | Production release |
