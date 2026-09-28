# Documentation-only delivery

## Activation state

This lane remains unavailable until all of these gates are complete:

1. The classifier, Pages job conditions, trusted
   `Docs Branch Policy / evaluate-main-docs` evaluator, and protected publisher
   foundation are released to `main`.
2. A dedicated GitHub App is installed only on the LinkSim repository with
   repository `Checks: Read and write` permission, and the protected
   `docs-policy-publisher` environment is configured as described below.
3. A qualifying `main` pull request proves that the App publishes
   `Docs Branch Policy / enforce-main-docs` on the exact pull-request head, with
   success only when the protected-base evaluator succeeds.
4. The observed App source is pinned with the required context in `main`
   branch protection.
5. A later protected policy pull request adds `docs/<issue-id>-<slug>` to the
   allowed `main` head branches in `docs/release-flow.md` and the existing PR
   branch-policy workflow.

Do not open or merge a `docs/*` -> `main` pull request before all five gates are
recorded complete. The staged evaluator is deliberately non-authorizing: its
`pull_request_target` job runs from the protected base but its native check is
not attached to the pull-request head and must never be made required. This
preserves the currently required `PR Branch Policy / enforce-main` check while
publisher activation is pending.

## Publisher provisioning and source pinning

The `publish-main-docs` job consumes only the conclusion of
`evaluate-main-docs`; it must not check out or execute pull-request content or
run a second classifier. It has no `GITHUB_TOKEN` permissions. Its two external
actions are pinned to reviewed commit SHAs, and it requests an installation
token scoped to the current LinkSim repository with only `checks: write`.

Provision the dedicated GitHub App with repository `Checks: Read and write`
permission and install it only on LinkSim. Configure the
`docs-policy-publisher` GitHub environment so only the protected `main` branch
may deploy to it, then define environment variable
`DOCS_POLICY_APP_CLIENT_ID` and environment secret
`DOCS_POLICY_APP_PRIVATE_KEY` there. Do not define either value as a repository
or pull-request-head workflow credential. Environment protection and the
workflow's protected-base `pull_request_target` trigger are both required.

Before changing branch protection, open a qualifying observation pull request
to `main` from a head already allowed by the current branch policy (normally
`staging`, not `docs/*`) and record that
`Docs Branch Policy / enforce-main-docs`:

- is completed on the pull request's exact 40-character head SHA;
- reports success only when `evaluate-main-docs` succeeded; and
- is sourced from the dedicated App installation, not GitHub Actions.

Use the observed check run's App identity when adding the required check to
`main` branch protection: pin both the exact context and its App source. Do not
activate the lane if GitHub cannot retain that source restriction. Merge the
later branch-policy change only after this observation/source-pin gate is
recorded complete.

Use this lane only for repository documentation that can change independently
of a LinkSim application version. Documentation that defines or changes the
public API, describes unreleased behavior, or must match a specific deployed
version stays in the normal staging and production release flow.

## Allowed paths

The complete pull-request diff must contain only:

- `docs/**`
- root `AGENTS.md`
- root `README.md`
- root `CONTRIBUTING.md`
- root `SECURITY.md`

`docs/onboarding.md` is excluded because it is imported into the application
bundle. `CHANGELOG.md`, application code, public assets, configuration,
migrations, scripts, workflows, and agent skills are also not
documentation-only for this lane. The classifier disables rename detection so
a move is evaluated as both the removed path and the added path.

## Delivery sequence

After the activation gates are complete:

1. Create `docs/<issue-id>-<slug>` from current `origin/main`.
2. Change only allowed documentation paths.
3. Run the normal local verification required by `AGENTS.md`.
4. Open the same-repository pull request directly to `main`.
5. Required CI, branch policy, provenance, review, and human merge controls
   remain mandatory. No application SemVer, changelog entry, release tag, or
   production approval is required solely for the documentation change.
6. After merge, Pages preview and production deployment jobs are skipped. The
   existing staging-drift monitor records that `main` is ahead.
7. Create a `chore/sync-docs-to-staging` branch from current `origin/staging`,
   apply the exact documentation content, and open a protected PR to `staging`.
   Its Pages preview and shared-staging deployment jobs are also skipped when
   the complete diff is documentation-only.
8. Close the documentation issue only after both protected merges are complete
   and the two branches contain the same documentation. Assign a milestone or
   use an explicitly approved `no-milestone-close-ok` exception; do not apply
   `released` solely for a documentation-only merge.

## Fail-closed behavior

- Mixed, empty, malformed, or unclassifiable diffs cannot use `docs/*` ->
  `main` and do not bypass deployment.
- The staged `pull_request_target` evaluator loads its workflow and classifier
  from the protected base branch and treats pull-request content only as diff
  data. It is diagnostic foundation, not the future authorization check.
- Activation requires the dedicated GitHub App to publish
  `Docs Branch Policy / enforce-main-docs` on the exact pull-request head. Do
  not substitute a check created by the shared GitHub Actions App because a
  head-controlled same-repository workflow could spoof that source identity.
- Manual deployment dispatches always remain deployment-eligible.
- Required workflows run normally; job-level conditions skip only Pages
  deployment jobs after successful classification.
- Do not use commit-message skip directives or workflow-level path filters for
  required checks.
