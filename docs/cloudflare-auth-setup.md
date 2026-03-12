# Cloudflare + Passkey Auth Setup

This project now supports cloud-backed Site Library + Simulation Library with:

- Cloudflare Pages Functions API (`/api/*`)
- Cloudflare D1 for persistence
- Clerk passkey authentication (JWT verified server-side)

## 1) Create D1 Database

```bash
npx wrangler d1 create linksim
```

Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]`.

## 2) Apply Schema

```bash
npx wrangler d1 execute linksim --file ./db/schema.sql
```

## 3) Create Clerk App

In Clerk dashboard:

1. Create application
2. Enable passkeys in sign-in methods
3. Disable password/email magic link methods if you want passkey-only
4. Copy:
   - Publishable key (`pk_...`)
   - Issuer / frontend API domain (`https://<your-clerk-domain>`)

## 4) Configure Cloudflare Variables

### Pages Project → Settings → Environment variables

- `VITE_CLERK_PUBLISHABLE_KEY` = Clerk publishable key
- `CLERK_JWT_ISSUER` = `https://<your-clerk-domain>`
- Optional: `CLERK_JWKS_URL` = `https://<your-clerk-domain>/.well-known/jwks.json`
- Optional strict template audience: `CLERK_JWT_AUDIENCE`

### Local development (.env)

Create `.env` from `.env.example` and set:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

## 5) Deploy

Use Cloudflare Pages deployment for this repo. The `/functions/api/*` routes are deployed automatically.

## 6) Verify

- Open app
- Go to `More` → `Cloud Auth & Sync`
- Sign in with passkey
- Create/edit a site or simulation
- Confirm cloud sync status updates

## Security Notes

- Passkeys handle authentication; authorization is still enforced by API + D1 ACL tables.
- Ownership and sharing metadata are persisted per resource.
- API requires Bearer token and verifies Clerk JWT issuer/JWKS.
