# LinkSim Agent Rules

## Mandatory Startup (No Exceptions)
- Treat this file as the single handoff entrypoint.
- Before any code changes, review open GitHub Issues for the repo and then read:
  1. `docs/release-flow.md`
- If instructions conflict, precedence is:
  1. explicit user instruction in current thread
  2. this `AGENTS.md`
  3. GitHub Issues / GitHub Projects state for the repo
  4. `docs/release-flow.md`

- Always update the relevant GitHub Issue(s) before and after implementation batches.
- Default environment workflow:
  - Unless the user explicitly says otherwise, work in local test environment.
  - After local verification, deploy to live test/staging for verification.
  - Only promote to production after explicit user approval, using the same verified commit.
- Branch workflow:
  - Use per-issue branches: `issue/<id>-<slug>`.
  - Merge issue branches into `staging` first.
  - Promote to production through `release/vX.Y.Z` branch/PR into `main`.
  - Use `hotfix/<slug>` only for explicitly approved incidents.
- Prefer stabilization work (consistency, hardening, tests, UX cleanup) over net-new features unless explicitly requested.
- Ship in batches: implement, run `npm test` and `npm run build`, then commit and push.
- Never commit or push directly to `main`; always create/use a separate branch for changes and push that branch.
- Use TDD methodology for changes and new features: write/update failing tests first, implement the minimal fix to pass, then refactor with tests green.
- Keep terminology consistent: use `Simulation`, `Site`, `Library`, `Path`, and `Channel` terms across UI and docs.
- Any modal/popover that can open on top of another dialog must use `tier="raised"` in `ModalOverlay`.
- When catching UI errors, use `getUiErrorMessage()` from `src/lib/uiError.ts` for consistent messaging.
- Do not leave issue status in an ambiguous state. Close issues only when code and verification are done.
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
  - Use `npm run deploy:staging:preview` only for side-by-side comparisons with preview URL
- Never run raw `wrangler pages deploy` for release operations.
- If a guarded deploy fails, fix the script/preflight issue and re-run the guarded script. Do not bypass with manual Wrangler deploys.
- Promotion gate:
  - Promote the exact same verified commit from local -> staging -> production.
  - If code changes after staging verification, rerun local verification and redeploy staging before production.
  - Production promotion branch must be `release/vX.Y.Z` (or approved `hotfix/<slug>`).
- Local run reliability:
  - Restart local server whenever runtime/config/env changes can affect behavior.
  - Re-verify affected flows after restart before marking work as done.
- Production preflight checklist (required before `deploy:prod:main`):
  - `npm run test`
  - `npm run build:bundle`
  - Confirm build label matches intended SemVer channel rules
  - Confirm no unresolved issue/project status drift for items in the current pass
- Token-efficient execution:
  - Lock scope for each pass before implementation.
  - Define done criteria and no-touch areas at pass start.
  - Avoid mid-pass feature pivots unless explicitly requested by the user.
- GitHub Issue workflow:
  - Treat GitHub Issues as the canonical backlog for open and completed work.
  - Use issue titles as the default source of task naming.
  - Prefer one issue per discrete task unless the user explicitly wants a grouped batch.
  - Maintain explicit status labels: `pending-discussion` -> `in-progress` -> `in-staging` -> `released`.
  - If a historical `docs/BACKLOG.md` file still exists, treat it as legacy reference only unless the user explicitly asks to maintain it.

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
