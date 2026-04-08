# LinkSim Agent Rules

## Mandatory Startup (No Exceptions)
- Treat this file as the single handoff entrypoint.
- Before any code changes, review open GitHub Issues for the repo and then read:
  1. `docs/release-flow.md`
  2. `docs/milestone-release-checklist.md`
- If instructions conflict, precedence is:
  1. explicit user instruction in current thread
  2. this `AGENTS.md`
  3. GitHub Issues / GitHub Projects state for the repo
  4. `docs/release-flow.md`
  5. `docs/milestone-release-checklist.md`

- Always update the relevant GitHub Issue(s) before and after implementation batches.
- Default environment workflow:
  - Unless the user explicitly says otherwise, work in local test environment.
  - After local verification, deploy to live test/staging for verification.
  - For every implementation batch by default: do both local verification and staging deployment verification in the same pass.
  - Only promote to production after explicit user approval, using the same verified commit.
- Branch workflow:
  - Use per-issue branches: `issue/<id>-<slug>`.
  - Merge issue branches into `staging` first.
  - For normal releases, promote to production only via a direct PR from `staging` into `main` (no release branch).
  - Use `hotfix/<slug>` only for explicitly approved incidents.
  - This staging-integration model is the default unless the user explicitly overrides it.
- Branch/worktree cleanup routine (default after each completed pass):
  - Keep only long-lived branches locally/remotely: `main`, `staging` (unless an active pass needs additional branches).
  - After merge/deploy, prune refs: `git fetch --prune origin`.
  - Delete merged local branches (except `main`/`staging`): `git branch --merged origin/staging | egrep -v '(^\\*|main|staging)' | xargs -n 1 git branch -d` (skip if no matches).
  - Delete remote merged issue/chore/hotfix branches once no longer needed.
  - Remove temporary worktrees for completed branches; keep only active worktrees.
- Prefer stabilization work (consistency, hardening, tests, UX cleanup) over net-new features unless explicitly requested.
- Ship in batches: implement, run `npm test` and `npm run build`, then commit and push.
- Never commit or push directly to `main`; always create/use a separate branch for changes and push that branch.
- Use TDD methodology for changes and new features: write/update failing tests first, implement the minimal fix to pass, then refactor with tests green.
- Keep terminology consistent: use `Simulation`, `Site`, `Library`, `Path`, and `Channel` terms across UI and docs.
- Do not introduce hardcoded UI colors in code; use existing theme variables/tokens. If a new semantic color is truly required, define it in the shared theme system first.
- Icon accessibility rule: every UI icon must include accessible text. For icon-only controls, require an explicit `aria-label` on the interactive element (and matching `title` where applicable). Decorative inline icons should be `aria-hidden="true"`.
- Any modal/popover that can open on top of another dialog must use `tier="raised"` in `ModalOverlay`.
- When catching UI errors, use `getUiErrorMessage()` from `src/lib/uiError.ts` for consistent messaging.
- Do not leave issue status in an ambiguous state.
- Default closure policy: once work is verified on shared staging and the user confirms staging sign-off, close the issue (do not wait for production deploy).
- Do not start newly created or newly requested issues without explicit user confirmation in the current thread.
- Maintain GitHub Issues in close dialogue with the user: confirm wording/scope before starting newly added user items, and confirm completion criteria before closing them.
- Batch size policy:
  - Default to 3-4 backlog items per pass.
  - If scope is stable and low risk, target larger passes (~10 items) to reduce deploy churn.
- For user-added issues:
  - Keep them labeled `pending-discussion` until discussed.
  - Do not move them to in-progress automatically.
- After every live deploy, monitor Cloudflare Pages deployment status (`wrangler pages deployment list --project-name linksim`) and explicitly notify the user when deployment is complete.
- Follow and maintain `docs/release-flow.md` as the source of truth for release promotion steps.
- Follow `docs/release-flow.md` versioning policy (SemVer + explicit bump rules) for all releases.
- Maintain a human-readable `CHANGELOG.md` for every release; do not use raw commit dumps as release notes.
- Before each production release, verify whether any issues closed since the previous release are missing a milestone and report/fix that metadata drift.
- Version/channel labeling rule:
  - Local must display `vX.Y.Z-alpha+<commit>`.
  - Staging must display `vX.Y.Z-beta+<commit>`.
  - Production must display `vX.Y.Z`.
  - Same commit must use the same base version `X.Y.Z` in all environments.
- Require a SemVer bump before every production release.
- Deploys must use guarded npm scripts only:
  - `npm run deploy:staging` → https://staging.linksim.link
  - `npm run deploy:staging:preview` → Preview URL
  - `npm run deploy:prod:main` → https://linksim.link
- Staging deploy default:
  - Use `npm run deploy:staging` from `staging` branch to deploy to https://staging.linksim.link
  - Do not use preview deploys for normal verification; default is always the shared staging URL.
- Never run raw `wrangler pages deploy` for release operations.
- If a guarded deploy fails, fix the script/preflight issue and re-run the guarded script. Do not bypass with manual Wrangler deploys.
- Promotion gate:
  - Promote the exact same verified commit from local -> staging -> production.
  - If code changes after staging verification, rerun local verification and redeploy staging before production.
  - Normal production promotion PR must be `staging` -> `main`.
  - Hotfix promotion PR may be `hotfix/<slug>` -> `main` only with explicit user approval in-thread.
- **After any hotfix merges to main**: immediately create a `chore/sync-main-to-staging` branch from `origin/staging`, run `git merge origin/main -X ours --no-edit`, PR into `staging`, merge, and redeploy staging. Do not start new feature work until staging is back in sync. The `detect-staging-drift` workflow will open a GitHub Issue as a reminder if this is missed.
- **Release-reconcile fallback rule**: if production promotion cannot be completed via direct `staging` -> `main` and uses a `hotfix/*` snapshot/reconcile PR instead, the same pass is not complete until `main` is synced back into `staging`, staging is redeployed, and the drift issue is closed.
- Local run reliability:
  - Restart local server whenever runtime/config/env changes can affect behavior.
  - Re-verify affected flows after restart before marking work as done.
- Production preflight checklist (required before `deploy:prod:main`):
  - `npm run test`
  - `npm run build:bundle`
  - Confirm build label matches intended SemVer channel rules
  - Confirm no unresolved issue/project status drift for items in the current pass
  - Confirm `CHANGELOG.md` is updated with user-readable highlights for the target release
- Token-efficient execution:
  - Lock scope for each pass before implementation.
  - Define done criteria and no-touch areas at pass start.
  - Avoid mid-pass feature pivots unless explicitly requested by the user.
- GitHub Issue workflow:
  - Treat GitHub Issues as the canonical backlog for open and completed work.
  - Use issue titles as the default source of task naming.
  - Prefer one issue per discrete task unless the user explicitly wants a grouped batch.
  - Maintain explicit status labels: `pending-discussion` -> `in-progress` -> `in-staging` (while open) -> issue closed after staging sign-off -> `released` label applied during milestone production release sweep.
  - After every staging merge/deploy, automatically update the related GitHub Issue(s) label from `in-progress` to `in-staging`. Do not wait for the user to ask.
  - Milestone release policy: at production release time, apply `released` to the milestone's shipped issues (including already-closed staging-verified issues).
  - If a historical `docs/BACKLOG.md` file still exists, treat it as legacy reference only unless the user explicitly asks to maintain it.

## Staging-First Milestone Workflow (Single Source)
- Deploy target policy:
  - Always validate live on `https://staging.linksim.link`.
  - Do not use preview URLs unless the user explicitly requests a one-off preview comparison in the current thread.
- Per-issue branch policy:
  - Start each issue branch from `origin/staging`.
  - Branch name format: `issue/<id>-<slug>`.
  - Keep PR scope to one issue; avoid mixed API/UI/deeplink batches in the same PR.
  - Agent safety rails:
    - Do not create normal-release `release/*` branches.
    - Do not open PRs to `main` from `issue/*` or `chore/*` branches.
    - If local branch is behind its PR base branch, rebase/refresh before merging.
- Drift check before coding (required):
  - Run and report: `git log --oneline origin/staging -5`
  - Run and report: `git log --oneline origin/main -5`
  - Run and report: `git cherry -v origin/staging origin/main`
  - If drift exists, create a dedicated `chore/reconcile-...` PR before feature work.
- Verification gates for deep-link/API-affecting work:
  - `npm run test -- --run src/lib/deepLink.test.ts`
  - `npm run test -- --run functions/api/v1/calculate.test.ts`
  - `npm run test -- --run src/store/appStore.test.ts`
  - `npm run build`
  - Manually verify deep-link matrix on staging:
    - `/<simulation>`
    - `/<simulation>/<site>`
    - `/<simulation>/<site1>+<site2>`
    - `/<simulation>/<site1>~<site2>`
- Merge and staging deploy sequence per issue:
  - Open PR into `staging`, merge, then deploy with `npm run deploy:staging`.
  - After deploy, always confirm completion with `wrangler pages deployment list --project-name linksim-staging --environment production` and report the commit SHA/build label.
- Milestone promotion model:
  - Complete and verify all milestone issues on `staging` first.
  - Promote to production in one batch with a direct PR from `staging` to `main`.
  - Use the exact verified staging commit for production; no code changes between staging sign-off and production deploy.
  - Freeze milestone scope at sign-off: no new feature work lands on `staging` until production deploy completes.
  - After production deploy, continue new issue work from the updated `origin/staging` baseline.

## Branch Protection Rollout Safety
- When introducing a new required status check, roll it out in two phases to avoid PR deadlocks:
  1. merge the workflow that produces the check
  2. then add that check to branch protection required checks

## Model Selection
- **Codex 5.3** — use for full implementation passes where quality and breadth of change matter most. Expensive; reserve for when the work warrants it.
- **Big Pickle / MiMo V2 Pro Free** — good for planning and moderate coding work. Use as the default for most passes.
- **Plan mode always** — before any implementation pass, always present a plan first. Always recommend which model to use for the next implementation pass.
- Also available but less experienced with this codebase: GPT-Nano, MiniMax M2.5 Free, Nemotron 3 Super Free.

## AGENTS.md Feedback
- If this file feels counterintuitive or is missing something, suggestions are welcome — but nothing changes without explicit approval.

## Handoff Guarantee
- A new agent should be able to continue by being pointed only to this file.
- Do not rely on undocumented tribal knowledge; if a rule is repeated in chat, add it here (or in the linked source-of-truth docs) before ending the pass.
