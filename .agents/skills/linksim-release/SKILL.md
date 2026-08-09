---
name: linksim-release
description: Prepare, verify, monitor, and report a protected LinkSim release as Beacon. Use when a maintainer asks to assemble release artifacts, evaluate staging readiness, open a production promotion pull request, execute an explicitly approved production promotion, monitor its deployment, or complete the issue and milestone release sweep.
---

# LinkSim Release

Follow `AGENTS.md`, `docs/release-flow.md`, and
`docs/milestone-release-checklist.md` as the sources of truth. Do not copy their
policy into release artifacts.

Beacon may prepare a release before production approval. Beacon must not tag,
merge, promote, dispatch a production workflow, or publish a GitHub release
until the user explicitly approves production in the current task.

## Prepare the release candidate

1. Fetch and prune, then report the branch comparisons required by `AGENTS.md`.
2. Confirm every proposed change is already on `origin/staging`. Inventory the
   milestone, issue states, open release blockers, and staging-only drift.
3. Choose the SemVer bump from current policy and explain the reason. Prepare
   the version and human-readable `CHANGELOG.md` entry on an approved
   `chore/release-X-Y-Z` branch from current `origin/staging`.
4. Run `npm test`, `npm run build`, the relevant targeted checks, and
   `npm run dev:check`. Do not run a local production deploy.
5. Deliver release-preparation changes through a signed PR to `staging` using
   `$linksim-create-pr` and `$linksim-ci-shepherd`.
6. Monitor the automatic staging deployment and report its exact commit and
   build label. Obtain explicit staging sign-off and freeze the release scope.
7. Complete `docs/milestone-release-checklist.md` as an attestation; do not edit
   its reusable template merely to record one release.

If any release-tree content changes after sign-off, stop and restart staging
verification.

## Establish the exact release tree

1. Record the verified staging tree with `git rev-parse origin/staging^{tree}`.
2. Confirm the intended `vX.Y.Z` tag targets that verified release tree and
   that the application version changed from the prior release.
3. Prefer a `staging` to `main` promotion PR. If squash history causes a real
   conflict, use only the `release/vX.Y.Z` fallback documented in
   `docs/release-flow.md`; preserve the verified staging tree exactly.
4. Include the required checked milestone-attestation line in the promotion PR.
5. Before seeking approval, show the version, changelog, source and target,
   verified staging commit and tree, tag target, checks, unresolved issues, and
   exact actions approval would authorize.

Preparation stops here unless explicit production approval is present.

## Execute an approved production release

After explicit approval in the current task:

1. Re-fetch and prove the candidate, tag, PR head, and verified staging tree
   have not changed. A mismatch invalidates approval and requires new sign-off.
2. Use the protected GitHub PR and production-environment flow. Never push
   directly to `main`, bypass required reviewers, run raw Wrangler deployment,
   or use the disabled local release script.
3. Let CI probe, conditionally migrate, and re-probe production D1 using the
   tracked deployment workflow. Do not apply an improvised migration.
4. Monitor the production run with
   `python3 scripts/watch-release <run-id> --expected-sha <main-sha>`.
5. On failure, retrieve only the failed-step log and stop production retries
   until the cause and authorization are clear.

## Report and sweep

- Sign deployment reports and GitHub release bodies as Beacon. Name the human
  production approver and include the Beacon run ID and deployed commit.
- Preserve the user-facing changelog format; provenance belongs in a footer or
  hidden marker.
- After verified production deployment, reconcile issue and milestone state,
  apply `released` to shipped issues, and report exclusions explicitly.
- Do not close an issue merely because a deployment job is green. Follow the
  issue sign-off and milestone rules in `docs/release-flow.md`.

Use the visible signature `— Beacon · AI release agent` and the provenance
contract in `config/ai-agents.json`. Fail closed if provenance validation fails.
