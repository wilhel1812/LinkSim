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

### LinkSim app-level approval
- Keep `REGISTRATION_MODE=approval_required`.
- Cloudflare Access answers “who can sign in”.
- LinkSim approval answers “who can use simulation features”.

## Hardened profile (optional)
- Restrict to one IdP per environment.
- Reduce session duration for admin users.
- Add country/IP device posture restrictions if required by org policy.

## Required env variables
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`
- `REGISTRATION_MODE=approval_required`
- `ADMIN_USER_IDS=<comma-separated admin ids>`
- `AUTH_OBSERVABILITY=true` (recommended)

## Validation checklist
1. Unauthenticated user gets Access challenge.
2. Authenticated non-approved user lands in pending flow.
3. Admin can open:
   - `/api/auth-diagnostics`
   - `/api/schema-diagnostics`
4. App denies privileged endpoints for non-admin users.

## Common misconfigurations
- Missing `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN`.
- `ALLOW_INSECURE_DEV_AUTH=true` in production.
- Expecting Access policy alone to replace LinkSim role/approval controls.
