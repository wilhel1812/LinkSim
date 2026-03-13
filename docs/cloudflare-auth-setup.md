# Cloudflare Access + D1 Setup (Recommended)

This project uses:

- Cloudflare Pages + Functions API
- Cloudflare D1 for persistence
- Cloudflare Access for authentication at the edge
- GitHub identity provider in Access as primary login
- Access One-time PIN as fallback login

## 1) Create D1 Database

```bash
npx wrangler d1 create linksim
```

Copy the returned `database_id` into `wrangler.toml`.

## 2) Apply Schema

```bash
npx wrangler d1 execute linksim --file ./db/schema.sql
```

For upgrades from older deployments, apply migrations explicitly (runtime auto-migrations are disabled):

```bash
npx wrangler d1 execute linksim --file ./db/migrations/2026-03-12_schema_alignment.sql
```

## 3) Configure Cloudflare Access (GitHub + OTP)

In Cloudflare Zero Trust:

1. Go to **Access** → **Applications**
2. Add/update application protecting your Pages app domain
3. Add login methods:
   - `GitHub` (primary)
   - `One-time PIN` (fallback)
4. In application settings, find the **AUD** tag
5. Note your team domain (example: `your-team.cloudflareaccess.com`)

Notes:
- Native email+password user database is not provided by Cloudflare Access.
- Passkeys are handled by your identity provider (GitHub), not by Access itself.

## 4) Registration Mode (Invitation/Approval)

Set in `wrangler.toml`:

- `REGISTRATION_MODE = "approval_required"`
- `ADMIN_USER_IDS = "<comma-separated user ids>"`

In this mode:
- First login creates a user profile
- User remains blocked from library/sync APIs until approved by an admin
- Admins approve/revoke from User Settings UI

## 5) Configure Pages Environment Variables

In Pages project env vars (Production + Preview):

- `ACCESS_TEAM_DOMAIN` = your team domain (without `https://`)
- `ACCESS_AUD` = Access app AUD tag
- `ADMIN_USER_IDS` = bootstrap admin user IDs
- `REGISTRATION_MODE` = `approval_required`
- `ACCESS_GRANTED_EMAIL_WEBHOOK_URL` = optional webhook URL used to send approval/access-granted emails
- `ACCESS_GRANTED_EMAIL_WEBHOOK_BEARER` = optional bearer token for that webhook
- `APP_BASE_URL` = canonical app URL included in access-granted email text

Do not enable local dev fallback vars in production.

## 6) D1 Binding in Pages

Pages project → Settings → Functions → D1 bindings:

- Binding: `DB`
- Database: `linksim`

## 7) Deploy

Deploy from this repo. Pages Functions under `functions/api/*` deploy automatically.

## 8) Verify

- Access protects app URL (unauth users blocked/challenged)
- Sign in via GitHub (or OTP fallback)
- Open User Settings and confirm user status
- For admins: check `/api/schema-diagnostics` and `/api/auth-diagnostics`
- Trigger `Sync From Cloud`
- Create/edit site/simulation and confirm cloud sync status updates

## Local Development

For local dev without Access edge, you can use insecure fallback in `.dev.vars`:

```bash
ALLOW_INSECURE_DEV_AUTH=true
DEV_AUTH_USER_ID=local-dev-user@example.com
```

For local edge simulation with functions + D1:

```bash
npm run dev:edge
```

This is for local testing only.

## Related docs

- Access policy templates: `docs/access-policy-templates.md`
- Testing plan: `docs/testing-plan.md`
