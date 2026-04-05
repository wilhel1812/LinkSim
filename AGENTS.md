# LinkSim Agent Rules

This file is operational law for agent behavior. Follow it strictly.

## 1) Instruction Precedence
If instructions conflict, apply this order:
1. Explicit user instruction in the current thread
2. `AGENTS.md` (this file)
3. GitHub Issues / GitHub Projects state
4. `docs/release-flow.md`
5. `docs/milestone-release-checklist.md`

## 2) Mandatory Startup (No Exceptions)
- Treat this file as the handoff entrypoint.
- Before any code changes:
  1. Review open GitHub Issues.
  2. Read `docs/release-flow.md`.
  3. Read `docs/milestone-release-checklist.md`.
- Run and report drift checks before coding:
  - `git log --oneline origin/staging -5`
  - `git log --oneline origin/main -5`
  - `git cherry -v origin/staging origin/main`
- If drift exists, open a dedicated `chore/reconcile-...` or sync issue/PR first.

## 3) Issue Workflow (Strict)
- GitHub Issues are the canonical backlog.
- Always update relevant issue(s) before and after each implementation batch.
- Status labels must be explicit and ordered: `pending-discussion` -> `in-progress` -> `in-staging` -> `released`.
- Do not leave issue status ambiguous.
- Close issues only after implementation and verification are complete.
- Do not start newly added issues without explicit user confirmation in-thread.
- Keep user-added issues as `pending-discussion` until discussed.

## 4) Branching and PR Rules
- Use per-issue branches: `issue/<id>-<slug>`.
- Default base branch for issue work: `origin/staging` (unless user explicitly overrides).
- Never commit or push directly to `main`.
- Normal release flow is PR `staging` -> `main` only.
- Use `hotfix/<slug>` only with explicit user approval.
- Do not open PRs to `main` from `issue/*` or `chore/*` branches.
- Keep PR scope to one issue.

## 5) Delivery and Verification Defaults
- Default environment flow per batch:
  1. Implement and verify locally.
  2. Merge to `staging`.
  3. Deploy and verify on `https://staging.linksim.link`.
  4. Promote to production only with explicit user approval.
- Required local verification: `npm test` and `npm run build`.
- For deep-link/API affecting work, also run:
  - `npm run test -- --run src/lib/deepLink.test.ts`
  - `npm run test -- --run functions/api/v1/calculate.test.ts`
  - `npm run test -- --run src/store/appStore.test.ts`
- If runtime/config/env changes can affect behavior, restart local server and re-verify.

## 6) Deploy and Promotion Guardrails
- Use guarded deploy scripts only:
  - `npm run deploy:staging`
  - `npm run deploy:staging:preview` (only when explicitly requested)
  - `npm run deploy:prod:main`
- Never use raw `wrangler pages deploy` for release operations.
- If guarded deploy fails, fix the root cause and rerun the guarded script.
- Promote the exact same verified commit from local -> staging -> production.
- If code changes after staging verification, restart local + staging verification.
- After each live deploy, verify via:
  - `wrangler pages deployment list --project-name linksim-staging --environment production`
  and report deployed commit SHA/build label to the user.

## 7) Release and Versioning Policy
- Follow `docs/release-flow.md` for promotion steps and SemVer policy.
- Version labels must be:
  - Local: `vX.Y.Z-alpha+<commit>`
  - Staging: `vX.Y.Z-beta+<commit>`
  - Production: `vX.Y.Z`
- Same commit must keep the same `X.Y.Z` across environments.
- Require a SemVer bump before each production release.
- Maintain a human-readable `CHANGELOG.md` for every release.
- Before production release, check closed issues since last release for missing milestone metadata.

## 8) Hotfix Sync Rule
- After a hotfix merges to `main`, immediately sync `main` back to `staging` before new feature work:
  1. Create `chore/sync-main-to-staging` from `origin/staging`
  2. `git merge origin/main -X ours --no-edit`
  3. PR into `staging`, merge, redeploy staging

## 9) Engineering Quality Rules
- Use TDD for changes/new features: failing test -> minimal fix -> refactor green.
- Prefer stabilization (hardening, consistency, tests, UX cleanup) over net-new features unless explicitly requested.
- Keep terminology consistent in UI/docs: `Simulation`, `Site`, `Library`, `Path`, `Channel`.
- Icon accessibility is mandatory:
  - Icon-only interactive controls must have `aria-label` (and matching `title` where applicable).
  - Decorative icons must use `aria-hidden="true"`.
- Any modal/popover that can appear above another dialog must use `tier="raised"` in `ModalOverlay`.
- For caught UI errors, use `getUiErrorMessage()` from `src/lib/uiError.ts`.

## 10) Planning, Scope, and Batch Size
- Plan mode is required before implementation; recommend the model for the next pass.
- Lock scope for each pass; define done criteria and no-touch areas.
- Avoid mid-pass scope pivots unless user explicitly requests them.
- Default batch size is 3-4 items; larger batches (~10) are acceptable when risk is low and scope is stable.

## 11) Branch Protection Rollout Safety
- For new required status checks:
  1. Merge workflow that produces the check.
  2. Then add it to branch protection required checks.

## 12) Model Guidance
- Use Codex 5.3 for high-quality, broad implementation passes.
- Use Big Pickle / MiMo V2 Pro Free as default for moderate work.

## 13) Maintenance of This File
- Suggestions are welcome, but rule changes require explicit approval.
- Keep this file concise, strict, and sufficient for zero-context handoff.
- Do not rely on undocumented tribal knowledge.
