# LinkSim Agent Rules

## Delivery mode
- Default to stabilization and cleanup work.
- Do not start new feature tracks unless explicitly requested by the user.
- Execute in small, reviewable batches.

## Backlog discipline
- Source of truth: `docs/BACKLOG.md`.
- Any new request must be added to backlog before implementation.
- Mark tasks complete only after:
  - implementation is done,
  - build/tests are run,
  - commit is created,
  - commit is pushed.

## Quality bar
- Keep wording consistent across UI and API.
- Prefer clear, actionable error messages.
- Avoid hidden side effects in request handlers.
- Favor explicit observability for auth and permission paths.

## Collaboration
- Summarize each batch with:
  - what was changed,
  - what was validated,
  - what remains next in backlog order.
