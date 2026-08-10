---
name: linksim-create-pr
description: Implement an explicitly approved LinkSim issue and deliver it as a tested, signed pull request to staging. Use when Codex is authorized to change LinkSim code, tests, documentation, workflows, or repository-scoped automation and must follow the project's issue, branch, validation, provenance, and handoff policy.
---

# LinkSim Create PR

Deliver one approved, reviewable change. Never merge the pull request or promote
production.

## Prepare the work

1. Read `AGENTS.md`, the relevant GitHub issue, `docs/release-flow.md`, and
   `docs/milestone-release-checklist.md` completely.
2. Confirm explicit implementation approval in the current task. Linky filing,
   an issue label, or prior investigation is insufficient.
3. Fetch and prune. Report the branch comparisons required by `AGENTS.md`.
4. Update the issue to `in-progress` and post a signed implementation-batch
   comment before editing.
5. Create `issue/<id>-<slug>` from current `origin/staging`. Do not commit to
   `staging` or `main`.

## Implement narrowly

1. Reuse the investigator's evidence or run `$linksim-issue-investigator` when
   evidence is incomplete.
2. Inventory reusable and overlapping code or UI before adding anything.
3. Write or update a failing test first when runtime behavior changes. Implement
   the smallest fix, then refactor with tests green.
4. Preserve unrelated user changes. Stop if safe isolation is impossible.
5. Follow the accessibility, error-handling, modal-tier, terminology, theme,
   auth, database, deep-link, and deployment rules in `AGENTS.md`.
6. Update documentation only where behavior or operator guidance changed.
   Automation-only repository assets do not independently bump the application
   version unless current policy or the user requires it.

## Verify

1. Run targeted tests while iterating.
2. Run `npm test` and `npm run build` before committing.
3. Run the additional deep-link/API tests from `AGENTS.md` when applicable.
4. Run `npm run dev:check`; stop any LinkSim dev/watch server unless the user
   explicitly asked to keep it running.
5. Run `git diff --check` and review the complete diff for scope, secrets, debug
   output, duplicated policy, and accidental generated files.

## Publish with provenance

1. Stage only intended files.
2. Commit with these trailers, using the real values:

   ```text
   AI-Agent: Forge
   AI-Agent-Type: bot
   AI-Run-ID: <uuid>
   Human-Authorized-By: <github-login>
   ```

3. Push the issue branch and open a PR to `staging`.
4. Add the `ai-assisted` label. Sign the PR body visibly as Forge and include a
   valid hidden provenance marker generated through
   `node scripts/ai-provenance.mjs`. Validate the complete PR body with that
   same script before publication; never hand-build the marker.
5. Describe scope, authority boundary, tests, documentation impact, versioning
   decision, and linked issue. Do not claim unperformed verification.
6. Hand the PR to `$linksim-ci-shepherd`. Do not merge it.

After a human-authorized merge, monitor the automatic staging deployment,
report its commit SHA, update the issue to `in-staging`, and request explicit
staging sign-off. Production remains a separate Beacon workflow and approval.
