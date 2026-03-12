# Cloudflare-Only Auth + D1 Setup (No Clerk)

This project uses:

- Cloudflare Pages + Functions API
- Cloudflare D1 for persistence
- Cloudflare Access for authentication at the edge

No external auth provider is required.

## 1) Create D1 Database

```bash
npx wrangler d1 create linksim
```

Copy the returned `database_id` into `wrangler.toml`.

## 2) Apply Schema

```bash
npx wrangler d1 execute linksim --file ./db/schema.sql
```

## 3) Configure Cloudflare Access

In Cloudflare Zero Trust:

1. Go to **Access** → **Applications**
2. Add application protecting your Pages app domain
3. Set login method policy (passkeys/IdP as desired)
4. In application settings, find the **AUD** tag
5. Note your team domain (example: `your-team.cloudflareaccess.com`)

## 4) Configure Pages Environment Variables

In Pages project env vars (Production + Preview):

- `ACCESS_TEAM_DOMAIN` = your team domain (without `https://`)
- `ACCESS_AUD` = Access app AUD tag

Do not enable local dev fallback vars in production.

## 5) D1 Binding in Pages

Pages project → Settings → Functions → D1 bindings:

- Binding: `DB`
- Database: `linksim`

## 6) Deploy

Deploy from this repo. Pages Functions under `functions/api/*` deploy automatically.

## 7) Verify

- Access protects app URL (unauth users blocked/challenged)
- Open app, go to `More` → `Cloud Auth & Sync`
- Trigger `Sync From Cloud`
- Create/edit site/simulation and confirm cloud sync status updates

## Local Development

For local dev without Access edge, you can use insecure fallback in `.dev.vars`:

```bash
ALLOW_INSECURE_DEV_AUTH=true
DEV_AUTH_USER_ID=local-dev-user@example.com
```

This is for local testing only.
