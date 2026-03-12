# LinkSim Testing Plan

## Goals
- Prevent auth/permission regressions.
- Validate simulation correctness stability.
- Keep UI workflow regressions visible.
- Make cloud deployment checks repeatable.
- Enforce Red/Green/Refactor discipline on new work.

## Layers

### 1) Unit tests (fast, every commit)
- Location: `src/**/*.test.ts`, `functions/**/*.test.ts`
- Focus:
  - RF model math (`propagation`, `coverage`, `terrainLoss`)
  - Auth source resolution and fallback behavior
  - Error normalization/status mapping

### 2) API behavior tests (local edge)
- Run against local `dev:edge` with D1.
- Focus:
  - `me`, `users`, `users/[id]`, `library`, `notifications`, `changes`
  - Admin vs non-admin permissions
  - Pending/revoked/deleted session behavior
  - Metadata repair endpoints

### 3) UI smoke checks
- Existing smoke scripts in `scripts/`.
- Focus:
  - Map render + sidebar interaction
  - Path profile updates
  - Modal stack behavior
  - User settings open/save/logout

### 4) Deployment checks (preview/prod)
- Cloudflare Access gate active.
- D1 migration applied.
- Diagnostics endpoints for admins:
  - `/api/auth-diagnostics`
  - `/api/schema-diagnostics`

## Required checks before push
1. `npm test`
2. `npm run build`
3. Manual quick pass:
  - open app
  - open/close nested modals
  - load simulation library + site library
  - open user settings and verify user state loads

## Priority expansion
- Add permission-matrix API tests for:
  - self-role protection
  - pending user restrictions
  - revoked/deleted session handling
  - admin-only moderation routes
- Add end-to-end scenario for metadata repair and creator/editor attribution.

## CI Quality Gates
- Workflow: `.github/workflows/ci-quality-gates.yml`
- Triggered on pull requests to `main` and pushes to non-main branches.
- Runs:
  1. `npm run test:ci`
  2. `npm run build`
