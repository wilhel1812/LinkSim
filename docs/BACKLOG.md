# Backlog

Last updated: 2026-03-12
State: stabilization pass (no net-new product features unless explicitly approved)

## Intake Rules
- Add every new task here before implementation.
- Work in small batches and close them fully (code + test + commit + push).
- Prefer cleanup, consistency, and hardening over new feature scope.

## User-provided backlog (seed)
- [ ] Clean up sidebar
- [ ] Report to admins/mods
- [ ] Report types: feedback
- [ ] Report types: spam/misuse
- [ ] Banning users
- [ ] E-mail notifications (starting with account approval)
- [ ] Rehaul of dockumentation (readme.md)
- [ ] Set up a compehensive testing plan
- [ ] Branding
- [x] Elevation plot visibility toggle
- [x] Instead of showing actions on the users in the admin panel, show a simple list of users and make open the profile popover when clicking the names. This should be the same popover that appears anywhere else. Admin gets extra moderation buttons.
- [x] Access request note should be a one time thing for the users. Admins should still be able to see it even after approval, but it shouldn't be an editable field.
- [x] What does the reject button currently do?
- [x] Show profile pictures to other users when you click open the user popover. Also show a small one next to any user name in the UI
- [x] User should be able to select if e-mail should be visible to everyone or only admins
- [ ] access rights on sites and simulations. public, public-read only, private
- [ ] explore if the route option actually makes sense anymore
- [ ] explore if we can take buildings into account

## Active stabilization backlog

### Auth, roles, and approvals
- [x] Prevent self-role change (admin/user cannot toggle own role)
- [x] Add Sign Out in User Settings (top area, always reachable)
- [x] Add notification center access through User Settings
- [x] Allow dismissing notification badges while keeping entries in center
- [x] Clarify pending-account UX text and flow end-to-end
- [x] Restrict sign-ups and approval transitions with explicit lifecycle states
- [x] Add dedicated auth/permission tests for critical flows
- Progress: baseline tests added for auth source resolution and error mapping; endpoint permission matrix still pending.
- Progress: added access-policy helper matrix tests (`functions/_lib/access.test.ts`) and endpoint gating helpers in users endpoints.
- [x] Add dedicated identity reconciliation tests + audit logging coverage
- Progress: deterministic reconciliation candidate matrix tests added (`functions/_lib/db.identity.test.ts`), and reconcile events continue to be persisted in `user_identity_audit` with match-kind metadata.
- [x] Add observability for Cloudflare Access auth header/JWT variants

### Data and storage safety
- [x] Replace avatar data URLs in D1 with object storage flow (R2) + thumbnails
- [x] Remove runtime schema migration from request path
- [x] Add migration/version status visibility in admin tools
- Progress: admin schema diagnostics endpoint + warnings added in User Settings.
- [x] Add import/export/backup health indicators and stronger restore UX
- Progress: added local storage health timeline (last export/import/restore) to reduce silent data-loss risk.

### Admin tooling
- [x] Build in-app admin utilities to reduce manual D1 SQL operations
- Progress: added in-app deleted-user lock manager (list + restore) to remove direct SQL need for this flow.
- Progress: added in-app metadata repair utility for created/last-edited backfill from ownership/change history.
- Progress: added admin ownership operations endpoint/UI (single + bulk reassign) with in-app audit view.
- [x] Add user moderation actions and review queue ergonomics
- [x] Add simulation/site ownership repair tools in UI
- Progress: ownership-related display gaps now repaired via metadata repair + fallback mapping; explicit owner reassignment UI now available for admins.
- [x] Add admin-safe bulk operations with confirmations and logs

### UI and wording consistency
- [x] Full terminology pass (Project/Simulation/Setup/Snapshot/etc.)
- [x] Move crowded metadata out of list rows and into details panels
- [x] Clean sidebar information density and progressive disclosure
- Progress: simplified library/action labels and streamlined user moderation list flow.
- [x] Unify labels/buttons across libraries and managers
- Progress: aligned labels for library open/save/add actions and moderation wording.
- [x] Standardize error messages across endpoints and UI surfaces
- Progress: backend endpoints now use centralized error normalization and status mapping; UI surface pass still pending.
- Progress: shared UI error parser now wired in shell/sidebar/user settings flows for more consistent messages.
- [x] Modal UX: support ESC and click-outside to close dialogs (in addition to close button)

### Simulation quality clarity
- [x] Improve explanatory info for FSPL / TwoRay / ITM and defaults
- [x] Document map sampling strategies clearly in UI help
- [x] Recheck pass/fail interpretation and communication around terrain blocking
- [x] Add terrain overlay visibility toggle (visual only; simulation still uses loaded terrain)

### Security and access hardening
- [x] Productize Access policy templates in-app docs and setup checklist
- [x] Add admin warning surfaces for unsafe auth/access configuration

## Hardening execution paths (agreed, no further discussion required now)
- [x] Runtime migrations
- Path: move all `ALTER TABLE`/schema drift logic out of request handlers into explicit SQL migration files + CI/deploy migration step; expose schema version in admin diagnostics.
- [x] Avatar storage strategy
- Path: move avatar binaries to R2 with server-side resize/thumbnail generation; keep only URL, hash, size, and content-type in D1.
- [x] Auth/permission regression coverage
- Path: add API integration tests for self-role block, pending-user lock, approval/revocation, admin-only mutations, cross-user denial, and delete safeguards.
- [x] Identity reconciliation hardening
- Path: define deterministic merge/link matrix (idp subject, verified email, legacy local email), add immutable audit events for link/merge decisions, and test every branch.
- [x] Cloudflare Access auth observability
- Path: add structured auth logs with reason codes for 401/403, include parsed identity source and header/JWT shape, and expose admin diagnostics endpoint/view.

## Next batch plan
1. Auth/permission endpoint matrix tests (admin/user/pending/revoked/deleted sessions).
2. Runtime migration extraction from request path into explicit migration step.
3. Admin utilities scope draft replacing manual SQL operations.
