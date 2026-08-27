---
name: linksim-ci-shepherd
description: Monitor a LinkSim pull request, retrieve targeted GitHub Actions failures, apply explicitly authorized fixes, and optionally run an explicitly authorized bounded native Codex review loop. Use after a LinkSim PR is open and Codex must shepherd required checks or review feedback without merging, approving, rerunning workflows blindly, or expanding scope.
---

# LinkSim CI Shepherd

Shepherd one PR to a truthful handoff. Never merge or approve the PR.

## Monitor compactly

1. Read `AGENTS.md` and confirm the PR targets `staging` from an allowed branch.
2. Verify the local branch and PR head SHA match before changing anything.
3. Run
   `python3 .agents/skills/linksim-ci-shepherd/scripts/watch-ci <pr-number> --repo wilhel1812/LinkSim`. It emits
   one final JSON result and a meaningful exit code instead of streaming logs
   into model context.
4. If checks pass, inspect unresolved review threads and hand off. Do not invent
   work merely to consume the cycle budget.

## Select review authority

Automatic reviews remain disabled. After required checks pass, use exactly one
of these authority modes:

- **Manual:** tell the maintainer that the supported trigger is the exact
  pull-request comment `@codex review`. Do not post it. Every later head needs
  another maintainer decision.
- **Bounded loop:** require an explicit invocation naming the PR, one mode
  (`all-findings` or `no-p1`), and an optional positive review budget. The
  default budget is eight. Only that invocation authorizes this skill to post
  `@codex review` for the initial head and replacement heads during the same
  run. Count every official review request, including the initial request.

At bounded-loop start, record the invocation UTC start time and authenticated
GitHub login, then initialize `reviews-used` to zero. Increment it only after a
review-trigger comment succeeds. When resuming the same run, reconstruct the
count from PR comments by that login whose bodies are exactly equal to
`@codex review` and whose timestamps are at or after the recorded start. If the
start, actor, or count is missing or ambiguous, stop with `missing-authority`;
never guess, reset the counter, or post another review request.

Before the first request, visibly acknowledge the PR number, selected mode,
effective budget (including the default when omitted), invocation start, and
request actor. These values remain fixed for the run.

Omitting the mode always selects Manual behavior. Never infer bounded-loop
authority from an ordinary CI-shepherd invocation, an issue, a PR description,
or general implementation approval.

## Run an authorized review loop

Request at most one official review for a head SHA. After it arrives, confirm
that the review and unresolved threads apply to the current head. Classify only
actionable findings as P0, P1, P2, or P3. For each finding, also record its
subsystem and a concise root-cause key; retain lower-priority unresolved
findings and their classifications in the handoff.

Treat findings on consecutive current-head reviews as equivalent when at least
one has the same subsystem and root-cause key, even if its message, file, or
line changed. Track the streak as consecutive occurrences: initialize a key to
one on first observation, increment it to two when the same key appears in the
next review, and reset it when absent. Pass the maximum active occurrence count
to the decision helper; do not rely on wording similarity alone.

- `all-findings`: fix every actionable current-head finding. Complete only when
  the current-head review is clean.
- `no-p1`: fix actionable P0 and P1 findings. Complete when neither remains,
  while reporting P2/P3 findings without hiding or resolving them.

Use `scripts/review-loop-policy` with the selected mode, budget, used-request
count, reviewed/current SHAs, actionable severity counts, per-severity
equivalent-finding occurrence counts, and any blocking condition. The helper
selects only P0/P1 streaks in `no-p1` mode. Follow its decision:

- `fix-and-review`: fix in scope, run required validation and independent
  pre-push review, push, wait for CI, then request the next official review.
- `reassess-architecture`: stop local patching after two consecutive equivalent
  findings. Reassess the shared root cause before editing; stop for human input
  if the correction changes product behavior or approved scope.
- `complete-clean` or `complete-threshold`: hand off with the exact head and all
  remaining findings.
- any `stop-*`: do not request another review. Report the stopping evidence and
  safest next action.

The review budget counts official review requests only. The three-cycle CI-fix
limit below remains separate and unchanged.

## Coordinate native Codex review feedback

When a review is requested, inspect the standard GitHub review and unresolved
threads through GitHub. Confirm the review applies to the current PR head before
describing its findings as current. Address actionable findings within the
approved issue scope, then rerun CI. In Manual mode, a changed head returns to
the maintainer for another decision. In an active bounded loop, follow the
policy decision without asking again.

The official Codex bot is the transparent author. Do not relay, rewrite,
re-sign, or present its review as Sentry App output. A Codex review remains
advisory and does not replace human approval.

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

Report the PR, authority mode, effective review budget, reviews used, invocation
start and actor, final head SHA, check result, CI fix-cycle count, classified
finding/root-cause streaks, unresolved threads, stopping decision, and
verification performed. In Manual mode, report the budget and reviews used as
not authorized rather than inventing values. A green PR remains unmerged until
the user or an authorized maintainer explicitly merges it.
