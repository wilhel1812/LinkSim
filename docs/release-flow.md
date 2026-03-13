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
