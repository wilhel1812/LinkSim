# Milestone Release Checklist

Use this checklist before opening a normal production promotion PR (`staging` -> `main`).

## Scope and freeze
- [ ] Milestone scope is frozen for release.
- [ ] No new feature PRs are merged into `staging` after sign-off.
- [ ] All in-scope issues are either closed after staging sign-off or explicitly labeled `released`.

## Verification
- [ ] `npm test` passes on the release candidate.
- [ ] `npm run build` passes on the release candidate.
- [ ] Staging verification was completed on `https://staging.linksim.link`.
- [ ] Verified production promotion will use the exact same staging commit SHA.

## Version and notes
- [ ] SemVer bump is present and intentional.
- [ ] `CHANGELOG.md` has a human-readable entry for this release.
- [ ] Release tag `vX.Y.Z` points to the production commit.

## PR attestation (required)
Include this checked line in the PR body for `staging` -> `main`:

`- [x] Milestone release checklist completed: docs/milestone-release-checklist.md`
