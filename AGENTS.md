# LinkSim Agent Rules

## Start Here

- Treat this file as the single handoff entrypoint.
- Before changing code, review the relevant open GitHub Issue(s), then read:
  1. `docs/release-flow.md`
  2. `docs/milestone-release-checklist.md`
- For documentation intended to reach `main` without an application release,
  also read `docs/documentation-delivery.md` and use its narrow protected lane.
- If instructions conflict, use this precedence:
  1. explicit user instruction in the current thread
  2. this `AGENTS.md`
  3. GitHub Issues / GitHub Projects state
  4. `docs/release-flow.md`
  5. `docs/milestone-release-checklist.md`
- Present and agree on a plan before implementation. Do not start newly created or newly requested issues without explicit user confirmation in the current thread.
- Update the relevant GitHub Issue(s) before and after each implementation batch; never leave issue status ambiguous.

## Delivery Guardrails

- Follow `docs/release-flow.md` as the source of truth for branching, deployment, promotion, drift handling, versioning, and releases.
- Before coding, fetch/prune and report:
  - `git log --oneline origin/staging -5`
  - `git log --oneline origin/main -5`
  - `git cherry -v origin/staging origin/main`
- Create `issue/<id>-<slug>` from `origin/staging`; never commit or push directly to `main` or `staging`.
- Default to local implementation and verification, then PR to `staging`. CI deploys merges to shared staging; do not run deploy scripts locally for normal verification. Production promotion requires explicit user approval.
- Ship verified batches. Use TDD: write or update failing tests first, implement the minimal fix, then refactor with tests green. Run `npm test` and `npm run build` before committing and pushing.
- For deep-link/API-affecting work, additionally run:
  - `npm run test -- --run src/lib/deepLink.test.ts`
  - `npm run test -- --run functions/api/v1/calculate.test.ts`
  - `npm run test -- --run src/store/appStore.test.ts`
  - Manually verify `/<simulation>`, `/<simulation>/<site>`, `/<simulation>/<site1>+<site2>`, and `/<simulation>/<site1>~<site2>` on staging.
- After a staging deploy, move related issues from `in-progress` to `in-staging`. Close only after shared-staging verification and user sign-off; assign a milestone first, or use `no-milestone-close-ok` for an approved exception. Apply `released` during the production milestone sweep.
- After a completed pass, prune refs and remove merged issue/chore/hotfix branches and temporary worktrees; keep only active work and long-lived `main`/`staging` branches.
- Restart the local server when runtime, configuration, or environment changes can affect behavior, then re-verify the affected flows.
- Do not leave local dev/watch servers running. Before handoff, run `npm run dev:check`, then `npm run dev:stop` if LinkSim is still running unless the user asked to keep it running.
- Roll out a new required status check in two phases: merge the workflow that produces it, then add it to branch protection.

## Implementation Rules

- Before named-agent work, load only that role's approved, size-capped lessons
  with `node scripts/ai-knowledge.mjs for-agent --agent <name>`. Do not load the
  whole registry into agent context, and do not store raw chat transcripts or
  personal/private memory there. Registry edits require an explicitly approved
  Forge task and reviewed pull request; Steward may only suggest changes.
- Prefer stabilization (consistency, hardening, tests, and UX cleanup) over net-new features unless explicitly requested.
- Reuse or adapt existing code and UI. Never add a new UI element without approval; flag opportunities to remove or consolidate overlapping code or UI.
- Keep terminology consistent: `Simulation`, `Site`, `Library`, `Path`, and `Channel`.
- Use existing theme variables/tokens; do not hardcode UI colors or fonts. Discuss and define a shared semantic token first when a new category is genuinely required.
- Every UI icon needs accessible text. Icon-only controls require an explicit `aria-label` and matching `title` where applicable; decorative inline icons use `aria-hidden="true"`.
- Any modal or popover that can open above another dialog must use `tier="raised"` in `ModalOverlay`.
- Use `getUiErrorMessage()` from `src/lib/uiError.ts` when catching UI errors.

## Native Codex Pull Request Review

- Pull-request review uses the official Codex Cloud GitHub integration. Do not
  build or operate a repository poller, local checkout adapter, review-output
  parser, or relay account for this purpose.
- Automatic reviews stay disabled. A maintainer explicitly requests a review
  on the current pull request by commenting `@codex review`. As the only
  exception, an explicit `$linksim-ci-shepherd` invocation that names the PR,
  review mode, and optional budget authorizes that bounded run to post repeated
  exact-head review requests under the skill's stopping rules.
- The official Codex bot is the transparent review author. `Sentry` is the
  LinkSim crew role, not a separate publication identity.
- A Codex review is advisory. It never constitutes human approval, cannot merge
  a pull request, and cannot authorize production.
- After a pushed fix changes the head SHA, the maintainer decides whether to
  request another review unless the fix is inside that explicitly authorized
  bounded run. Agents must not spend review usage outside those two paths.

## Code Review Rules

### Data and authentication boundaries

- Flag changes that can expose production data or secrets to local, preview, or
  staging environments; weaken Access audience enforcement; or deploy code that
  depends on a D1 schema change without the required probe and migration gate.

### Calculation and compatibility contracts

- Flag regressions in terrain completeness, radio calculations, API contracts,
  saved simulations, or supported deep links. Catalog-absent ocean terrain is
  not an error, but a bare fetch failure is not proof of ocean.

### Reuse and protected delivery

- Flag duplicated code or UI when an existing shared implementation should be
  reused, missing regression coverage for consequential behavior changes, and
  any bypass of the staging-first protected release flow.

## Handoff Guarantee

- A new agent must be able to continue using this file and its required linked documents only.
- Keep durable repo policy here or in the linked source of truth; do not rely on chat-only knowledge.

## AI Artifact Provenance

- Treat `config/ai-agents.json` as the single source of truth for named-agent
  identity, authority, and visible signatures.
- Generate and validate bot-authored GitHub artifact footers through
  `node scripts/ai-provenance.mjs`; do not hand-build provenance markers in
  skills or workflows.
- Validate the complete rendered artifact before publication and fail closed
  when its identity, signature, run ID, source event, or commit SHA is invalid.
