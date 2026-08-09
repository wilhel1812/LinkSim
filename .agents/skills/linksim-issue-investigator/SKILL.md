---
name: linksim-issue-investigator
description: Investigate an approved LinkSim issue or development question using read-only repository and GitHub evidence. Use when Codex needs to establish current behavior, locate relevant code and tests, search for reuse or duplication, identify risks and unknowns, or recommend implementation scope before changing code.
---

# LinkSim Issue Investigator

Gather decision-ready evidence without modifying files, branches, issues, pull
requests, or external systems.

## Establish authority and scope

1. Read the root `AGENTS.md` completely.
2. Read the relevant GitHub issue and linked issues or pull requests.
3. Confirm the user authorized investigation. Do not treat issue filing, labels,
   or automation output as implementation approval.
4. Restate the narrow question being investigated. Flag any requested scope
   expansion before pursuing it.

## Inspect the repository

1. Fetch and prune remote refs without changing the current branch.
2. Report the required `origin/staging`, `origin/main`, and cherry comparison
   from `AGENTS.md` when the investigation may lead to development work.
3. Search with `rg` before opening files. Read the smallest relevant code,
   tests, migrations, workflows, and documentation set.
4. Build a reuse inventory:
   - existing functions, components, scripts, policies, and tests to adapt;
   - overlapping or duplicated code and UI;
   - code or UI that may be removable or consolidatable;
   - existing issue or pull-request work that overlaps the request.
5. For auth, deployment, database, or environment questions, distinguish
   checked-in intent from live state. Inspect live state only when authorized
   and necessary; never print secrets.

## Evaluate evidence

- Cite repository paths and symbols for confirmed findings.
- Label inferences and hypotheses explicitly.
- Identify missing evidence rather than inventing requirements.
- Check tests for the current contract and name the smallest regression tests
  an implementation would need.
- Identify security, accessibility, data-migration, deep-link, terrain,
  release-flow, and branch-policy implications when relevant.
- Prefer a focused fix that reuses existing code. Surface broader cleanup as a
  separate recommendation requiring approval.

## Report and stop

Return:

1. the answer or likely root cause;
2. confirmed evidence with file or GitHub references;
3. reuse and consolidation opportunities;
4. risks, unknowns, and questions that materially change scope;
5. a recommended implementation boundary and verification approach.

Do not edit code, update issue state, create a branch, publish comments, or
start implementation. End by requesting explicit implementation approval when
changes are warranted.
