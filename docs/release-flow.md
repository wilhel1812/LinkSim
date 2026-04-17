# Release Flow

## Default rule
- Unless explicitly stated otherwise, work in the local test environment.

## Required reading before implementation/release work
- `docs/release-flow.md`
- `docs/milestone-release-checklist.md`

## Branch model (integration + release)
- `issue/<id>-<slug>`: single issue implementation branch.
- `staging`: integration branch for accepted issue work.
- `main`: production branch only.
- `hotfix/<slug>`: production incident branch (only when explicitly approved).

## Delivery sequence
1. Local test
- Implement changes locally.
- Run verification (`npm test`, `npm run build`, and manual local checks).
- Open PR from `issue/<id>-<slug>` to `staging`.

2. Live test (staging)
- Merge approved issue PR into `staging` (squash merge).
- CI automatically deploys to https://staging.linksim.link on every merge to `staging`. Monitor the `Deploy LinkSim Pages / deploy-staging` GitHub Actions job and report the commit SHA/build label when complete.
- Do not run `npm run deploy:staging` manually after a normal merge — CI handles it. Use `workflow_dispatch` only for override deploys.
- Preview URL for side-by-side comparison (explicit request only): `npm run deploy:staging:preview`.

3. Production
- Promote only after explicit user approval.
- Open PR `staging` -> `main` (direct path — branch policy allows `staging` as head branch).
- CI automatically deploys to production on every merge to `main`. Monitor the `Deploy LinkSim Pages / deploy-prod-main` GitHub Actions job and report the commit SHA when complete.
- Note: the CI deploy job runs `validate-prod-release.mjs` which requires a SemVer version bump and git tag at HEAD — ensure these are in place before merging to `main`.
- After production deploy, continue all new work from updated `origin/staging`.
- If direct `staging` -> `main` promotion is blocked and a `hotfix/*` reconcile/snapshot PR to `main` is used, treat that as an exception path and immediately run main->staging sync before starting any new work.

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
  - `staging` (default and only normal release path — branch policy explicitly allows this)
  - `hotfix/<slug>` (approved production incidents only)
  - `release/vX.Y.Z` (legacy exception path, not used for normal releases)
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
  6. Promote via `staging` -> `main` PR only with explicit approval.
- No hidden scope changes during promotion; if code changes after staging verification, restart the loop.

## Milestone release rules
- Milestone delivery happens in trains:
  1. complete milestone issues on `staging`
  2. verify milestone behavior on https://staging.linksim.link
  3. freeze milestone scope at release sign-off (no new feature merges into `staging`)
  4. promote with a single `staging` -> `main` PR
  5. deploy production from the merged `main` commit
- Promotion must use the same verified staging commit SHA.
- If any code changes after staging sign-off, restart staging verification before production.
- Before opening the promotion PR, require:
  - all in-scope milestone issues are either closed after staging sign-off or explicitly labeled `released`
  - `npm test` passes
  - `npm run build` passes
  - `CHANGELOG.md` includes a human-readable entry for the release
  - `docs/milestone-release-checklist.md` is completed
- PR body requirement for normal promotion (`staging` -> `main`):
  - include the checked line:
    - `- [x] Milestone release checklist completed: docs/milestone-release-checklist.md`

## Issue state machine
- Use these labels to keep issue status explicit:
  - `pending-discussion`
  - `in-progress`
  - `in-staging`
  - `released`
- Default closure policy: close issue after staging verification and explicit user sign-off.
- Milestone production release policy: apply `released` label during the milestone release sweep for shipped issues.

## CI/CD Controls
- GitHub Actions deploy workflow triggers automatically on push to `staging` and `main`:
  - Push to `staging` → `deploy-staging` job → https://staging.linksim.link
  - Push to `main` → `deploy-prod-main` job → https://linksim.link
- Manual override available via `workflow_dispatch` with explicit target selection (`staging` or `prod-main`).
- `prod-main` job runs in the `production` GitHub environment (configure required reviewers in repo settings).
- `staging` runs in the `staging` environment.
- Both branches require CI quality gates (`CI Quality Gates / verify` + `PR Branch Policy / enforce`) to pass before merge.

## Drift prevention rules
- Issue branches must be created from latest `origin/staging`.
- PRs into `staging` or `main` must be up-to-date with the base branch before merge.
- Never promote from `issue/*` or `chore/*` directly into `main`.
- After any `hotfix/*` merge into `main` (including release-reconcile fallback), immediately:
  1. create `chore/sync-main-to-staging` from `origin/staging`
  2. `git merge origin/main -X ours --no-edit`
  3. PR and merge into `staging`
  4. `npm run deploy:staging` and verify deployment
  5. close the drift issue

## Drift prevention rules
- Issue branches must be created from latest `origin/staging`.
- PRs into `staging` or `main` must be up-to-date with the base branch before merge.
- Never promote from `issue/*` or `chore/*` directly into `main`.
- After any `hotfix/*` merge into `main` (including release-reconcile fallback), immediately:
  1. create `chore/sync-main-to-staging` from `origin/staging`
  2. `git merge origin/main -X ours --no-edit`
  3. PR and merge into `staging`
  4. `npm run deploy:staging` and verify deployment
  5. close the drift issue

## Drift prevention rules
- Issue branches must be created from latest `origin/staging`.
- PRs into `staging` or `main` must be up-to-date with the base branch before merge.
- Never promote from `issue/*` or `chore/*` directly into `main`.
- After any `hotfix/*` merge into `main` (including release-reconcile fallback), immediately:
  1. create `chore/sync-main-to-staging` from `origin/staging`
  2. `git merge origin/main -X ours --no-edit`
  3. PR and merge into `staging`
  4. `npm run deploy:staging` and verify deployment
  5. close the drift issue

## Deploy Targets Reference
| Target | URL | Description |
|--------|-----|-------------|
| `deploy:staging` | https://staging.linksim.link | Test environment (`staging` branch) |
| `deploy:staging:preview` | Preview URL | Side-by-side comparison |
| `deploy:prod:main` | https://linksim.link | Production release |
