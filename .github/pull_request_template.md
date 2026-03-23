## What changed

-

## Why this change

-

## TDD Checklist

- [ ] I started with a failing automated test (or updated a failing existing test) that captures the intended behavior.
- [ ] I implemented only the minimum code needed to make the test pass.
- [ ] I refactored with tests still green.
- [ ] I ran `npm test` and `npm run build` locally.

## Issue + branch hygiene

- [ ] Branch name follows policy for target base branch.
- [ ] This PR references a single primary issue.
- [ ] Issue state has been updated (`in-progress` -> `in-staging` or `released`).

## Verification

- [ ] Tests: `npm test`
- [ ] Build: `npm run build`

## Release checklist (required when base is `main`)

- [ ] Source branch is `release/vX.Y.Z` (or `hotfix/*` for approved incidents).
- [ ] Staging verification was done on the exact same commit.
- [ ] SemVer bump is correct and intentional.
- [ ] `vX.Y.Z` tag points to the commit being promoted.
