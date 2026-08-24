# Documentation-only delivery

## Activation state

This lane is staged but unavailable until all of these gates are complete:

1. The classifier, Pages job conditions, and trusted
   `Docs Branch Policy / enforce-main-docs` workflow are released to `main`.
2. A qualifying `main` pull request proves that exact check context succeeds.
3. Branch protection is explicitly updated to require the trusted check.
4. A later protected policy pull request adds `docs/<issue-id>-<slug>` to the
   allowed `main` head branches in `docs/release-flow.md` and the existing PR
   branch-policy workflow.

Do not open or merge a `docs/*` -> `main` pull request before all four gates are
recorded complete. This staged rollout preserves the currently required
`PR Branch Policy / enforce-main` check while the new trusted context is being
installed.

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

`CHANGELOG.md`, application code, public assets, configuration, migrations,
scripts, workflows, and agent skills are not documentation-only for this lane.
The classifier disables rename detection so a move is evaluated as both the
removed path and the added path.

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
- Direct-to-`main` authorization runs the classifier and workflow from the
  trusted base branch; pull-request content is fetched only as diff data and is
  never executed by that check.
- Manual deployment dispatches always remain deployment-eligible.
- Required workflows run normally; job-level conditions skip only Pages
  deployment jobs after successful classification.
- Do not use commit-message skip directives or workflow-level path filters for
  required checks.
