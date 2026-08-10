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
3. Select one entry mode:
   - Standard: fetch and prune, report the branch comparisons required by
     `AGENTS.md`, update the issue to `in-progress`, post a signed batch
     comment, and create `issue/<id>-<slug>` from current `origin/staging`.
   - Validated epic handoff: confirm `$linksim-execute-epic` already performed
     those steps in the current dedicated worktree. Verify the issue, branch,
     worktree, approval, base ancestry, and complete phase diff. Preserve that
     branch and worktree; do not recreate them or restart from staging.
4. Do not commit to `staging` or `main` in either mode.

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

1. Stage only intended files and commit a local candidate with these trailers,
   using the real values:

   ```text
   AI-Agent: Forge
   AI-Agent-Type: bot
   AI-Run-ID: <uuid>
   Human-Authorized-By: <github-login>
   ```

2. Invoke `$linksim-pre-pr-review` for code, authentication, database, workflow,
   and release changes. Give the reviewer the exact candidate commit SHA and
   its base. A mechanical documentation-only change may use the author's
   recorded self-review.
3. If review causes any correction, apply it and rerun every validation required
   by `AGENTS.md`, including the full `npm test` and `npm run build`, before
   creating the replacement candidate commit. Then rerun every required
   validation at that exact SHA and repeat the independent review. A prior
   verdict never covers later edits, commits, or validation results.
4. Before publication, require a passing verdict whose reviewed head equals
   `HEAD`, a clean worktree, no unresolved blocking finding, and no missing
   required review.
5. Push the issue branch and open a PR to `staging`.
6. Add the `ai-assisted` label. Sign the PR body visibly as Forge and include a
   valid hidden provenance marker generated through
   `node scripts/ai-provenance.mjs`. Validate the complete PR body with that
   same script before publication; never hand-build the marker.
7. Describe scope, authority boundary, tests, pre-PR review result and reviewed
   commit SHA,
   documentation impact, versioning
   decision, and linked issue. Do not claim unperformed verification.
8. Hand the PR to `$linksim-ci-shepherd`. Do not merge it.

After a human-authorized merge, monitor the automatic staging deployment,
report its commit SHA, update the issue to `in-staging`, and request explicit
staging sign-off. Production remains a separate Beacon workflow and approval.
