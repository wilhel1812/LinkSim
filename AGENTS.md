# LinkSim Agent Rules

- Always update `docs/BACKLOG.md` before and after implementation batches.
- Prefer stabilization work (consistency, hardening, tests, UX cleanup) over net-new features unless explicitly requested.
- Ship in batches: implement, run `npm test` and `npm run build`, then commit and push.
- Keep terminology consistent: use `Simulation`, `Site`, `Library`, `Path`, and `Channel` terms across UI and docs.
- Any modal/popover that can open on top of another dialog must use `tier="raised"` in `ModalOverlay`.
- When catching UI errors, use `getUiErrorMessage()` from `src/lib/uiError.ts` for consistent messaging.
- Do not leave backlog tasks in ambiguous state. Use `[x]` only when code and verification are done.
- Do not start user-added backlog items without explicit user confirmation in the current thread.
- After every live deploy, monitor Cloudflare Pages deployment status (`wrangler pages deployment list --project-name linksim`) and explicitly notify the user when deployment is complete.
