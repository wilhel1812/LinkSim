# LinkSim Agent Rules

## Mandatory Startup (No Exceptions)
- Treat this file as the single handoff entrypoint.
- Before any code changes, read these files in order:
  1. `docs/BACKLOG.md`
  2. `docs/release-flow.md`
- If instructions conflict, precedence is:
  1. explicit user instruction in current thread
  2. this `AGENTS.md`
  3. `docs/BACKLOG.md`
  4. `docs/release-flow.md`

- Always update `docs/BACKLOG.md` before and after implementation batches.
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
- Do not leave backlog tasks in ambiguous state. Use `[x]` only when code and verification are done.
- Do not start user-added backlog items without explicit user confirmation in the current thread.
- Maintain `docs/BACKLOG.md` in close dialogue with the user: confirm wording/scope before starting newly added user items, and confirm completion criteria before checking them off.
- Batch size policy:
  - Default to 3-4 backlog items per pass.
  - If scope is stable and low risk, target larger passes (~10 items) to reduce deploy churn.
- For user-added backlog items:
  - Keep them marked `pending-discussion` until discussed.
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
  - `npm run deploy:staging:preview`
  - `npm run deploy:staging:main`
  - `npm run deploy:prod:main`
- Staging deploy default:
  - Use `npm run deploy:staging:main` and share only the canonical staging URL (`https://linksim-staging.pages.dev`).
  - Use `npm run deploy:staging:preview` only when the user explicitly asks for preview/branch deployments.
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
  - Confirm no unresolved backlog status drift for items in the current pass
- Token-efficient execution:
  - Lock scope for each pass before implementation.
  - Define done criteria and no-touch areas at pass start.
  - Avoid mid-pass feature pivots unless explicitly requested by the user.

## Handoff Guarantee
- A new agent should be able to continue by being pointed only to this file.
- Do not rely on undocumented tribal knowledge; if a rule is repeated in chat, add it here (or in the linked source-of-truth docs) before ending the pass.
