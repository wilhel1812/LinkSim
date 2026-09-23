# Cloudflare authentication boundaries and D1 setup

This project uses:

- Cloudflare Pages + Functions API
- Cloudflare D1 for persistence
- Better Auth with GitHub and passkeys on stable staging
- Cloudflare Access for production during migration, staging previews, and the
  narrow stable-staging legacy proof path

## 1) Create D1 Database

```bash
npx wrangler d1 create linksim
```

Copy the returned `database_id` into `wrangler.toml`.

## 2) Apply Schema

```bash
npx wrangler d1 execute linksim --file ./db/schema.sql
```

For upgrades from older deployments, review [`db/migrations`](../db/migrations) and apply each immutable migration that the target database has not received, in filename order. Runtime auto-migrations are disabled, and deployment preflight stops when a required column is missing.

Destructive test fixtures are not migrations. They live under [`db/local-seeds`](../db/local-seeds) and must never be applied to staging or production. To replace the users in Wrangler's local D1 database with the test fixture, run:

```bash
npm run db:seed:local
```

The command accepts no database, environment, or remote-mode arguments, always invokes Wrangler with `--local`, and refuses to run in CI.

## 3) Configure Cloudflare Access (GitHub + OTP)

In Cloudflare Zero Trust:

1. Go to **Access** → **Applications**
2. Add/update applications for each explicit boundary:
   - custom app shell (`staging.linksim.link` / `linksim.link`): Bypass for everyone;
   - stable-staging API (`staging.linksim.link/api/*`): Bypass so LinkSim's
     Better Auth guard is authoritative;
   - stable-staging legacy proof (`staging.linksim.link/api/auth/legacy-access/*`): authenticated Allow;
   - production API (`linksim.link/api/*`): authenticated Allow until the
     separately approved production cutover;
   - staging raw Pages root (`linksim-staging.pages.dev`): Bypass so Pages can redirect it to the custom domain;
   - staging branch previews (`*.linksim-staging.pages.dev`): authenticated Allow.
3. Add login methods:
   - `GitHub` (primary)
   - `One-time PIN` (fallback)
4. In each application settings page, find the **AUD** tag
5. Note your team domain (example: `your-team.cloudflareaccess.com`)

Notes:
- Native email+password user database is not provided by Cloudflare Access.
- On stable staging, the LinkSim sign-in popover starts Better Auth GitHub or
  passkey authentication. GitHub is required to create a new account.
- Access GitHub or one-time PIN remains relevant only to legacy migration and
  the production deployment while the transition is open.
- The legacy migration route accepts only a freshly issued Access JWT, creates
  a ten-minute single-use attempt, and then requires a fresh Better Auth GitHub
  session. `AUTH_DUAL_LOGIN_MIGRATION_ENABLED=true` must be present in both the
  stable-staging Pages and auth-runtime configurations. Preview and production
  must omit it until their separately reviewed rollout phase.
- A separately gated privileged passkey recovery exists only for an
  operator-authorized, unmigrated administrator or moderator. It always logs
  out of the cached Access identity first, requires a fresh exact-subject Access
  proof, and lets Better Auth create the first passkey and session. It never
  matches email or registers an ordinary user. Production omits
  `AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED`.

## 4) Registration Behavior

Registration is part of the application behavior and is not controlled by an
environment variable:

- First login creates a user profile
- Users choose a username before library/sync onboarding continues
- `ADMIN_USER_IDS` bootstraps admin access for the listed identities

## 5) Configure Pages Environment Variables

In Pages project env vars (Production + Preview):

- `ACCESS_TEAM_DOMAIN` = your team domain (without `https://`)
- `ACCESS_AUD` = comma-separated Access app AUD tags for every hostname served
  by that Pages environment
- `ADMIN_USER_IDS` = one-time bootstrap admin user IDs

`ADMIN_USER_IDS` is consulted only when a listed identity is first inserted.
After that, the role and revocation state stored in D1 is authoritative, so an
administrator can durably demote or revoke a bootstrap identity. Diagnostics
endpoints follow that current D1 state and do not provide a configuration-only
break-glass bypass. Bootstrap consumption survives account deletion and
restoration, so reauthentication cannot undo a durable demotion.

Stable staging additionally declares these non-secret, fail-closed rollout
gates in checked-in Wrangler configuration:

- `AUTH_DUAL_LOGIN_MIGRATION_ENABLED=true`
- `AUTH_LEGACY_CLAIM_ENABLED=true`
- `AUTH_REGISTRATION_ENABLED=true`
- `AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED=true`

Omitting or setting a gate to any value other than the exact string `true`
disables that path. Existing auth mappings continue to work when claim or
registration is disabled.

## Account lifecycle policy

- Profile email is editable display/contact data. It never transfers approval,
  roles, ownership, grants, or audit identity.
- Identity reconciliation requires an email claim from a successfully verified
  Cloudflare Access JWT. Header-only and local-development identities do not
  supply reconciliation evidence.
- Verified identities are claimed by normalized IdP email in D1. A subject
  change migrates the complete account atomically, repoints every active email
  alias, records the transfer, and permanently marks the prior subject as
  superseded so an older valid session cannot move the account back.
- The identity schema migration refuses duplicate verified emails and historical
  deletion tombstones that lack recoverable verified-email evidence. Those rows
  require explicit administrator remediation; the migration never selects an
  arbitrary account or invents an identity mapping.
- Deleting an account creates a durable tombstone. Old and newly issued IdP
  sessions remain blocked until an administrator explicitly restores the ID.
  Every claimed alias is blocked in the same transaction. Restore re-enables
  only the canonical blocked subject and its claims; superseded subjects remain
  superseded. The next valid login after restore creates a fresh account.
- LinkSim relies on the configured IdP not reassigning verified email addresses.
  A simultaneous subject-and-email replacement has no trustworthy automatic
  anchor and requires administrator recovery.
- Avatar object keys are opaque and do not include the LinkSim user ID or email.

Do not enable local dev fallback vars in production or shared preview deployments.

### Browser origin policy

LinkSim's Functions API permits credentialed browser requests only from the
request's own origin. This covers `https://linksim.link`,
`https://staging.linksim.link`, and each authenticated
`https://<preview>.linksim-staging.pages.dev` deployment without allowing one
environment to call another. Local development has one explicit cross-origin
exception: the Vite app at `http://localhost:5174` may call the edge API at
`http://127.0.0.1:8788`.

Requests with another browser `Origin` (including `null`) are rejected before
API handlers run, even when they carry a `CF_Authorization` cookie. Requests
without `Origin`, such as curl and server-to-server API clients, remain allowed
but receive no CORS authorization headers. This application boundary complements
the active environment authentication boundary. On stable staging it does not
replace Better Auth session validation; on Access-protected routes it does not
replace issuer, audience, and signature verification.

## 6) D1 Binding in Pages

Pages project → Settings → Functions → D1 bindings:

- Binding: `DB`
- Database: `linksim`

## 7) Deploy

Deploy from this repo. Pages Functions under `functions/api/*` deploy automatically.

## 8) Verify

- Anonymous custom app shell returns `200`.
- Anonymous stable-staging `/api/me` returns LinkSim's JSON `401`; production
  `/api/me` still redirects to Access.
- Anonymous stable-staging `/api/auth/legacy-access/*` redirects to Access with
  the configured legacy API audience.
- The raw Pages root redirects to the custom domain.
- Staging branch previews redirect to Access with the configured preview audience.
- Sign in via GitHub (or OTP fallback)
- Open User Settings and confirm user status
- For admins: check `/api/schema-diagnostics` and `/api/auth-diagnostics`
- Trigger `Sync From Cloud`
- Create/edit site/simulation and confirm cloud sync status updates
- In guest deep-link mode, verify `/api/public-simulation` is reachable without Access challenge

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

- [Access policy templates](./access-policy-templates.md)
- [Testing plan](./testing-plan.md)
- [Staging environment](./staging-environment.md)
- [Release flow](./release-flow.md)
