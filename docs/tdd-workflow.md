# LinkSim TDD Workflow

This repository uses Test-Driven Development (TDD) for changes and new features.

## Core Loop

1. Red: write or update a test that fails for the target behavior.
2. Green: implement the smallest code change that makes the test pass.
3. Refactor: improve structure/readability while keeping tests green.

## Scope Guidance

- Unit logic: add tests under `src/**/*.test.ts`.
- Edge/API behavior: add tests under `functions/**/*.test.ts`.
- Cross-cutting behavior: keep business rules isolated so tests stay focused.

## Required Local Gates

Before pushing a branch:

1. `npm test`
2. `npm run build`

For pull requests, CI also runs coverage mode (`npm run test:ci`) and build.

## Practical Rules

- Start with the smallest failing case, not a full scenario.
- Prefer deterministic tests (no real network calls, stable inputs).
- Keep one behavior/assertion theme per test case.
- Name tests by observable behavior, not implementation details.
- When fixing a bug, first add a regression test that fails on the old behavior.

## Suggested Test Case Template

Use `docs/templates/tdd-test-case-template.md` when planning a change.
