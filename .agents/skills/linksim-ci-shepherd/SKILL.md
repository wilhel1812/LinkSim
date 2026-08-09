---
name: linksim-ci-shepherd
description: Monitor a LinkSim pull request, retrieve targeted GitHub Actions failures, apply explicitly authorized fixes, and resolve review feedback within a bounded cycle count. Use after a LinkSim PR is open and Codex must shepherd required checks without merging, approving, rerunning workflows blindly, or expanding scope.
---

# LinkSim CI Shepherd

Shepherd one PR to a truthful handoff. Never merge or approve the PR.

## Monitor compactly

1. Read `AGENTS.md` and confirm the PR targets `staging` from an allowed branch.
2. Verify the local branch and PR head SHA match before changing anything.
3. Run
   `python3 scripts/watch-ci <pr-number> --repo wilhel1812/LinkSim`. It emits
   one final JSON result and a meaningful exit code instead of streaming logs
   into model context.
4. If checks pass, inspect unresolved review threads and hand off. Do not invent
   work merely to consume the cycle budget.

## Fix failures deliberately

Use at most three fix cycles per PR head lineage.

For each cycle:

1. Identify the failed check from the watcher result.
2. Retrieve only its failed-step log with `gh run view <run-id> --log-failed`.
3. Reproduce locally when practical and determine the root cause.
4. Change only what is within the approved issue scope. Ask before broadening
   behavior, policy, dependencies, or UI.
5. Add or update a regression test where the failure exposes a defect.
6. Run targeted verification, then `npm test`, `npm run build`,
   `npm run dev:check`, and `git diff --check` as applicable.
7. Commit with Forge trailers and push. Never use a blind workflow rerun as a
   substitute for a fix.

Stop after three cycles, two equivalent repeated failures, missing authority,
or a failure outside LinkSim control. Return a signed `needs-human` summary with
the failing check, evidence, attempted fixes, and safest next action.

## Address review feedback

- Read unresolved thread state, not only flat comments.
- Implement actionable feedback within scope; explain concretely when feedback
  conflicts with verified behavior or policy.
- Reply with evidence and mark a thread resolved only after its concern is
  actually addressed.
- Re-run the watcher after every pushed fix.

## Handoff

Report the final head SHA, check result, fix-cycle count, unresolved threads,
and verification performed. A green PR remains unmerged until the user or an
authorized maintainer explicitly merges it.
