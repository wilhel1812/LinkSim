---
name: linksim-execute-epic
description: Execute exactly one explicitly approved phase of a reviewed LinkSim epic using an isolated worktree, reuse-first architecture, bounded implementation delegation, independent pre-PR review, tests, and a manual-merge pull request. Use only after a maintainer authorizes a named epic phase for implementation; do not use to draft epics, approve later phases, merge, release, or run production.
---

# LinkSim Execute Epic

Execute one independently mergeable epic phase as Forge. Follow `AGENTS.md`,
the approved epic and child issue, `docs/release-flow.md`, and
`docs/milestone-release-checklist.md`. Never reinterpret approval for one phase
as approval for another.

## Establish the phase boundary

1. Quote the approved phase, success criteria, dependencies, non-goals, and
   human authorization. Stop if the phase is unnamed, ambiguous, blocked by
   unmerged work, or materially different from the epic.
2. Fetch and prune, report the branch comparisons required by `AGENTS.md`, and
   update only the phase's child issue to `in-progress`.
3. Create a dedicated worktree and `issue/<id>-<slug>` branch from current
   `origin/staging`. Never share a worktree with another active phase.
4. Inventory existing code, UI, tests, scripts, workflows, and skills before
   proposing additions. Record components to reuse, adapt, consolidate, or
   remove.

## Run the bounded crew

Use one reuse-first architect to turn repository evidence into a compact file
and test map. The architect is read-only and may not expand scope.

Use at most two bounded implementers, and only where the map contains
independent file areas. Give each implementer one explicit objective, allowed paths, required
tests, and prohibited actions. Keep one implementer for a small or tightly
coupled phase; never create delegation merely to appear parallel. Implementers
cannot publish, merge, change policy, or authorize later work.

As orchestrator, reconcile all changes in the dedicated worktree and perform
the orchestrator diff and test review. Check the complete diff against the
approved phase, reuse inventory, security boundaries, migrations, tests, and
documentation. Permit at most three correction rounds across the phase. Stop
with remaining findings instead of spinning or silently weakening acceptance.

## Verify and review

1. Use TDD for runtime behavior: demonstrate the relevant failing test, make
   the smallest implementation, and refactor with tests green.
2. Run targeted tests, then every validation required by `AGENTS.md`, including
   `npm test`, `npm run build`, `npm run dev:check`, and `git diff --check`.
3. Hand the completed worktree to `$linksim-create-pr` in validated epic
   handoff mode. That skill creates the local candidate commit and invokes
   `$linksim-pre-pr-review` in a separate Codex context against its exact SHA.
   Supply the approved phase, base/head SHAs, complete diff, and test results,
   not the implementers' conclusions.
4. Address blocking findings within the same three-round phase limit. Every
   correction creates a new candidate and requires a new independent review.
   Record accepted non-blocking findings in the PR; never resolve them by
   changing the approved scope.

## Publish the phase

Complete the validated handoff through `$linksim-create-pr`. The PR must target
`staging`, link only the implemented child issue, and remain independently mergeable.
Never merge the PR, automatically advance the epic, approve another phase, or
run production. After human merge, perform only the staging handoff required by
the create-PR skill and wait for explicit approval before any next phase.
