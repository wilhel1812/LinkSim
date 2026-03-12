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

## Active stabilization backlog

### Auth, roles, and approvals
- [x] Prevent self-role change (admin/user cannot toggle own role)
- [x] Add Sign Out in User Settings (top area, always reachable)
- [x] Add notification center access through User Settings
- [x] Allow dismissing notification badges while keeping entries in center
- [ ] Clarify pending-account UX text and flow end-to-end
- [ ] Restrict sign-ups and approval transitions with explicit lifecycle states
- [ ] Add dedicated auth/permission tests for critical flows
- [ ] Add dedicated identity reconciliation tests + audit logging coverage
- [ ] Add observability for Cloudflare Access auth header/JWT variants

### Data and storage safety
- [ ] Replace avatar data URLs in D1 with object storage flow (R2) + thumbnails
- [ ] Remove runtime schema migration from request path
- [ ] Add migration/version status visibility in admin tools
- [ ] Add import/export/backup health indicators and stronger restore UX

### Admin tooling
- [ ] Build in-app admin utilities to reduce manual D1 SQL operations
- [ ] Add user moderation actions and review queue ergonomics
- [ ] Add simulation/site ownership repair tools in UI
- [ ] Add admin-safe bulk operations with confirmations and logs

### UI and wording consistency
- [ ] Full terminology pass (Project/Simulation/Setup/Snapshot/etc.)
- [ ] Move crowded metadata out of list rows and into details panels
- [ ] Clean sidebar information density and progressive disclosure
- [ ] Unify labels/buttons across libraries and managers
- [ ] Standardize error messages across endpoints and UI surfaces

### Simulation quality clarity
- [ ] Improve explanatory info for FSPL / TwoRay / ITM and defaults
- [ ] Document map sampling strategies clearly in UI help
- [ ] Recheck pass/fail interpretation and communication around terrain blocking

### Security and access hardening
- [ ] Productize Access policy templates in-app docs and setup checklist
- [ ] Add admin warning surfaces for unsafe auth/access configuration

## Next batch plan
1. Pending-account UX clarity pass + wording consistency pass.
2. Notification center expansion (history, filtering, moderation handoff).
3. Admin utilities scope draft replacing manual SQL operations.
