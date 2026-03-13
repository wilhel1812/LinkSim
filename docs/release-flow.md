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
- Current baseline: `0.8.0`.
- Bump level decision rules:
  - `PATCH` (`0.8.x`): bug fixes, polish, performance tuning, and non-breaking UX behavior fixes.
  - `MINOR` (`0.x.0`): new user-facing features or meaningful workflow additions that are backward-compatible.
  - `MAJOR` (`x.0.0`): breaking changes (data model incompatibility, removed/renamed API behavior, auth/permission model breaks), or first stable `1.0.0` declaration.
- Environment bump rules:
  - Local test: no version bump required.
  - Live test (staging): no version bump required; commit SHA is sufficient for traceability.
  - Live production: version bump is required before release.
- Production release checklist:
  1. Decide bump level (`PATCH`/`MINOR`/`MAJOR`) from rules above.
  2. Update `package.json` version.
  3. Commit with `release: vX.Y.Z`.
  4. Deploy and verify.
  5. Tag `vX.Y.Z`.

## Iteration Rules
- Default loop for every task:
  1. Implement in local test.
  2. Verify (`npm test`, `npm run build`, manual QA).
  3. Commit and push.
  4. Deploy to staging and verify.
  5. Promote to production only with explicit approval.
- No hidden scope changes during promotion; if code changes after staging verification, restart the loop.
