# Release Flow

## Default rule
- Unless explicitly stated otherwise, work in the local test environment.

## Branch model (integration + release)
- `issue/<id>-<slug>`: single issue implementation branch.
- `staging`: integration branch for accepted issue work.
- `release/vX.Y.Z`: release-candidate branch cut from `staging`.
- `main`: production branch only.
- `hotfix/<slug>`: production incident branch (only when explicitly approved).

## Delivery sequence
1. Local test
- Implement changes locally.
- Run verification (`npm test`, `npm run build`, and manual local checks).
- Open PR from `issue/<id>-<slug>` to `staging`.

2. Live test (staging)
- Merge approved issue PR into `staging` (squash merge).
- Deploy from branch `staging` using `npm run deploy:staging`.
- Verify at https://staging.linksim.link.
- Use explicit guarded commands only:
  - Staging deploy: `npm run deploy:staging`.
  - Preview URL: `npm run deploy:staging:preview` (separate preview URL for side-by-side comparison).

3. Production
- Promote only after explicit user approval.
- Cut `release/vX.Y.Z` from the verified `staging` commit.
- Open PR `release/vX.Y.Z` -> `main`.
- Deploy the exact verified staging commit to production (no extra code changes in between).
- Use explicit guarded command only: `npm run deploy:prod:main`.
- After production deploy, back-merge `main` -> `staging` to keep parity.

## Guardrails
- No direct production hotfixes unless explicitly requested by the user.
- No direct commits to `main` or `staging`; PR-only.
- Always report deployed commit SHA for staging and production.
- Keep clear non-production indicators enabled for local/staging environments.
- Do not run raw `wrangler pages deploy` for release operations.
- All deploys must pass scripted preflight checks:
  - clean git tree
  - valid target config (project/bindings)
  - branch policy (`staging` required for `deploy:staging`, `main` required for `prod-main`)
  - required deploy environment variables (currently `VITE_MAPTILER_KEY`)
  - remote D1 schema gate for required columns (deploy aborts if migrations are missing)
- All deploys must pass scripted post-deploy verification against Cloudflare deployment list.

## Pull request policy
- PRs into `staging` must come from:
  - `issue/<id>-<slug>`
  - `hotfix/<slug>`
  - `chore/<slug>`
- PRs into `main` must come from:
  - `release/vX.Y.Z`
  - `hotfix/<slug>` (approved production incidents only)
- Merge strategy: squash merge only.
- Auto-delete merged branches enabled.

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
  4. Open PR to `staging` and merge once approved.
  5. Deploy `staging` using `npm run deploy:staging` and verify at https://staging.linksim.link.
  6. Promote via `release/vX.Y.Z` PR to `main` only with explicit approval.
- No hidden scope changes during promotion; if code changes after staging verification, restart the loop.

## Issue state machine
- Use these labels to keep issue status explicit:
  - `pending-discussion`
  - `in-progress`
  - `in-staging`
  - `released`
- Close issue only when release is deployed and verified in production.

## CI/CD Controls
- GitHub Actions deploy workflow is manual (`workflow_dispatch`) with explicit target selection:
  - `staging`
  - `prod-main`
- `prod-main` job runs in the `production` GitHub environment (configure required reviewers in repo settings).
- `staging` runs in the `staging` environment.

## Deploy Targets Reference
| Target | URL | Description |
|--------|-----|-------------|
| `deploy:staging` | https://staging.linksim.link | Test environment (`staging` branch) |
| `deploy:staging:preview` | Preview URL | Side-by-side comparison |
| `deploy:prod:main` | https://linksim.link | Production release |
