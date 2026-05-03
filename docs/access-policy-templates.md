# Cloudflare Access Policy Templates

## Objective
Provide a safe baseline for LinkSim without over-complicated guardrails.

## Recommended baseline

### Application
- Protect the LinkSim app hostname with Cloudflare Access.
- Identity providers:
  - GitHub (primary)
  - One-time PIN (fallback)

### Session duration
- Recommended: `24h` to `7d` depending on team preference.
- Keep lower for admin-heavy deployments.

### App policy (minimum)
- Action: `Allow`
- Include:
  - Allowed email domains OR specific emails/groups
- Exclude:
  - Explicitly blocked users/groups (if used)

## Guest Deep-Link Mode (for issue #24 behavior)

Use this profile when anonymous users must be able to open shared Simulation deep links without an Access login prompt.

### Access boundary
- Keep the app shell route publicly reachable so deep links can load without Access challenge.
- Keep authenticated APIs protected with Access (`/api/me`, `/api/library`, `/api/users*`, admin/mod endpoints).
- Keep `/api/public-simulation` reachable without Access challenge.

### App authorization model
- Keep `REGISTRATION_MODE=open`.
- Treat Access as identity proof for signed-in users.
- Treat LinkSim visibility/role checks as the data authorization source.
- Anonymous deep-link users must only load the shared/public Simulation bundle resolved by deep link.
- Guest mode must not expose library browsing/discovery of unrelated objects.

### LinkSim app-level authorization
- Keep `REGISTRATION_MODE=open`.
- Cloudflare Access answers “who can sign in”.
- LinkSim visibility and role checks answer “who can use each simulation feature”.

## Hardened profile (optional)
- Restrict to one IdP per environment.
- Reduce session duration for admin users.
- Add country/IP device posture restrictions if required by org policy.

## Required env variables
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`
- `REGISTRATION_MODE=open`
- `ADMIN_USER_IDS=<comma-separated admin ids>`
- `AUTH_OBSERVABILITY=true` (recommended)

## Validation checklist
1. In baseline mode: unauthenticated user gets Access challenge.
2. In guest deep-link mode: unauthenticated user can open a shared deep link without challenge.
3. In guest deep-link mode: unauthenticated user cannot access authenticated APIs (`/api/me`, `/api/library`, admin routes).
4. Authenticated new user must choose a username before cloud library/sync onboarding continues.
5. Admin can open:
   - `/api/auth-diagnostics`
   - `/api/schema-diagnostics`
6. App denies privileged endpoints for non-admin users.

## Common misconfigurations
- Missing `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN`.
- `ALLOW_INSECURE_DEV_AUTH=true` in production.
- Expecting Access policy alone to replace LinkSim resource role controls.
