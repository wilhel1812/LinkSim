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
  - `npm run deploy:staging` → https://staging.linksim.wilhelmfrancke.com
  - `npm run deploy:staging:preview` → Preview URL
  - `npm run deploy:prod:main` → https://linksim.wilhelmfrancke.com
- Staging deploy default:
  - Use `npm run deploy:staging` (any branch) to deploy to https://staging.linksim.wilhelmfrancke.com
  - Use `npm run deploy:staging:preview` only for side-by-side comparisons with preview URL
- Never run raw `wrangler pages deploy` for release operations.
- If a guarded deploy fails, fix the script/preflight issue and re-run the guarded script. Do not bypass with manual Wrangler deploys.
- Promotion gate:
  - Promote the exact same verified commit from local -> staging -> production.
  - If code changes after staging verification, rerun local verification and redeploy staging before production.
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
  - If a historical `docs/BACKLOG.md` file still exists, treat it as legacy reference only unless the user explicitly asks to maintain it.

## Branch Discipline
- Default model: one branch per GitHub issue.
- Do not start work for a new issue on a branch created for a different issue.
- Branch names should include the issue number and short slug (example: `issue/99-share-permissions` or `fix/99-share-permissions`).
- Before implementation, verify the current branch matches the issue being worked on.
- If branch and issue do not match, create/switch to a new branch before editing code unless the user explicitly requests an exception.
- Allowed exceptions:
  - user explicitly requests grouped multi-issue work on one branch
  - follow-up fixes for the same issue before merge/release
  - release-only chores required to ship the current branch
- If work has already started on the wrong branch, stop and ask the user whether to:
  - continue temporarily on current branch
  - move commits to a new branch
  - finish current batch and document exception
- When creating staging/production inventory, map each branch to issue number(s) covered.
- Document any branch-scope exception in the related GitHub issue comment.

## Documentation Discipline
- Documentation updates are required in the same batch as implementation for any behavior, workflow, policy, or UX change.
- Do not treat docs as post-work cleanup; docs are part of done criteria.
- Update the nearest source-of-truth doc when changes are made:
  - release/deploy behavior -> `docs/release-flow.md`
  - access/permissions behavior -> `docs/access-model.md`
  - testing strategy/process -> `docs/testing-plan.md` or `docs/tdd-workflow.md`
- If no suitable doc exists, create one in `docs/` and reference it from this file when it becomes a recurring source of truth.
- Keep docs implementation-oriented and LLM-friendly:
  - include exact file touchpoints and invariants
  - include failure modes and expected UX behavior
  - avoid ambiguous wording
- Before ending a pass, verify docs reflect shipped behavior and mention doc updates in the related GitHub issue comment.

## Mutation Permission Enforcement (Required)
- Any issue that adds/changes mutation UI for `Simulation`, `Site`, `Library`, `Path`, or `Channel` must include all of the following in the same batch:
  1. UI gating: mutation controls are hidden/disabled when user cannot edit the target resource.
  2. Permission-aware feedback: blocked mutation paths show explicit edit-access messages (not generic validation failures).
  3. Shared helper usage: reuse `src/lib/editAccess.ts` for permission checks/message copy where applicable.
  4. Tests: add/update tests that cover at least one denied path and one allowed path.
  5. Docs: update `docs/access-model.md` with any new touchpoints or invariants.
- Treat missing any of the five items above as a failed done-criteria check for the batch.
- Fork/create invariant:
  - Approved users can always create independent resources (`New Simulation`, `Save Copy`, `Add Site` to `Site Library`) even while viewing read-only simulations.
  - Simulation-scoped mutations (add/remove/update links/sites/channels in the active simulation) must remain permission-gated.

## Production Release Batch

When the user requests a production release:

1. Inventory branches available for release:
   - Run `wrangler pages deployment list --project-name linksim-staging` to see which commits have been deployed to staging.
   - Cross-reference with local/remote branches (`git branch -a` + recent `git log --oneline`).
   - For each candidate branch, present: branch name, commit SHA, staging deploy status, and a brief summary from commit messages.
   - Check GitHub Issues linked to each branch: show issue number, title, and open/closed status.
2. Present the inventory as a numbered list and ask the user which branches to include. Do not assume all staged branches should ship.
3. Merge selected branches into `main` in order.
4. Run production preflight: `npm test`, `npm run build:bundle`, confirm build label matches SemVer channel rules, confirm no open issues drift for included items.
5. Run `npm run deploy:prod:main`.
6. Report deployed commit SHA and notify when Cloudflare Pages deployment completes (`wrangler pages deployment list --project-name linksim`).

## Theme + Basemap Integration Checklist

When adding a new UI color theme, cross-file wiring is required beyond the theme definition file itself. Missing any step will cause the theme to silently fall back to defaults.

Required touchpoints:
1. `src/themes/types.ts` — add the new value to the `UiColorTheme` union.
2. `src/themes/<name>Theme.ts` — create the `ThemeDefinition` export with light/dark variants (`cssVars` + `map` colors).
3. `src/themes/index.ts` — register in the `THEMES` record.
4. `src/store/appStore.ts:normalizeUiColorTheme` — add the new value to the normalization whitelist so persisted selection round-trips correctly.
5. `src/components/UserAdminPanel.tsx` — add an `<option>` to the color theme `<select>`.
6. `src/lib/basemaps.ts:CARTO_THEME_TINTS` — add an entry to the exhaustive tint map. The `satisfies Record<UiColorTheme, ...>` guard will fail at compile time if this is missed.

Basemap tinting (CARTO `normal-themed` preset only) uses a full-world overlay layer (`theme-tint-overlay`) with per-theme color/opacity. Other providers and CARTO presets (`normal`, `topographic`) use external style URLs unaffected by UI color theme.

## Handoff Guarantee
- A new agent should be able to continue by being pointed only to this file.
- Do not rely on undocumented tribal knowledge; if a rule is repeated in chat, add it here (or in the linked source-of-truth docs) before ending the pass.
