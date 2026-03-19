# Access Model

## Purpose

Define the canonical read/write permission model for `Simulation` and `Site` resources and the required behavior when changing visibility.

## Core principles

- Read access and write access are separate.
- Visibility controls read access, not write access.
- Visibility changes are write operations and require edit access on the target resource.

## Visibility semantics

- `private`
  - Read: owner + explicit collaborators.
  - Write: owner + collaborators with `editor`/`admin` role.
- `shared`
  - Read: everyone.
  - Write: owner + collaborators with `editor`/`admin` role.

`public` is legacy-normalized to `shared` where still present in compatibility paths.

## Edit-access invariant

Any mutation path that changes resource content, collaborators, or visibility must enforce:

- owner can edit
- collaborator with role `editor` or `admin` can edit
- everyone else cannot edit

Reference implementation: `canEditItem()` in `src/store/appStore.ts`.

## Visibility transition rules

### Simulation -> shared with private referenced sites

When changing a `Simulation` from `private` to `shared`:

1. Collect private referenced `Site` entries from simulation snapshot.
2. Partition referenced private sites into:
   - editable by current user
   - not editable by current user
3. If any non-editable private sites exist:
   - block the transition
   - list site names in UX and explain that owner/editor/admin collaborator action is required
4. If all are editable:
   - allow elevating referenced private sites to `shared`
   - apply simulation visibility change

File touchpoints:
- `src/components/Sidebar.tsx` (resource access modal prompt)
- `src/components/AppShell.tsx` (share modal flow)

### Site -> private while used by shared simulations

When changing a `Site` from `shared` to `private`:

1. Find shared simulations that reference the site.
2. Partition affected simulations into:
   - editable by current user
   - not editable by current user
3. Prompt before applying change.
4. On confirm:
   - set site to `private`
   - set only editable affected simulations to `private`
   - leave non-editable simulations unchanged and list them in warning text

File touchpoints:
- `src/components/Sidebar.tsx`

## Sync conflict behavior

A non-private simulation referencing a private library site is invalid for cloud publish/sync.

- Pre-push validation should detect this and report names for both simulation and site.
- User-facing Sync Status should show friendly guidance and keep technical detail collapsible.

File touchpoints:
- `src/store/appStore.ts` (pre-push conflict detection)
- `src/components/UserAdminPanel.tsx` + `src/lib/syncError.ts` (friendly sync error UX)

## Backend access retrieval requirements

Library fetch must include private resources for explicit collaborators.

- Owner: always visible
- Explicit collaborator: visible even when private
- Non-collaborator: private is hidden

File touchpoint:
- `functions/_lib/db.ts` (`fetchLibraryForUser` query predicates)
