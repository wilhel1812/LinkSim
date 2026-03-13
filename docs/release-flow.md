# Release Flow

## Default rule
- Unless explicitly stated otherwise, work in the local test environment.

## Delivery sequence
1. Local test
- Implement changes locally.
- Run verification (`npm test`, `npm run build`, and manual local checks).

2. Live test (staging)
- Push code and deploy to staging.
- Verify the same commit in the live test environment.

3. Production
- Promote only after explicit user approval.
- Deploy the exact verified staging commit to production (no extra code changes in between).

## Guardrails
- No direct production hotfixes unless explicitly requested by the user.
- Always report deployed commit SHA for staging and production.
- Keep clear non-production indicators enabled for local/staging environments.

## Versioning Policy
- SemVer is mandatory (`MAJOR.MINOR.PATCH`).
- Current baseline: `0.8.0` (feature-rich beta, stabilization phase).
- Bump rules:
  - `PATCH` (`0.8.x`): bug fixes, polish, non-breaking UX updates, test/docs-only improvements.
  - `MINOR` (`0.x.0`): new user-facing capabilities or meaningful workflow additions.
  - `MAJOR` (`1.0.0+`): stable production contract changes or first declared stable release.
- Version bump timing:
  - Bump before staging promotion for the release candidate.
  - Promote the exact same version/commit from staging to production.
- Every release note in commit/PR should state:
  - version,
  - commit SHA,
  - environment promoted (`staging` or `production`).

## Iteration Rules
- Default loop for every task:
  1. Implement in local test.
  2. Verify (`npm test`, `npm run build`, manual QA).
  3. Commit and push.
  4. Deploy to staging and verify.
  5. Promote to production only with explicit approval.
- No hidden scope changes during promotion; if code changes after staging verification, restart the loop.
