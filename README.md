# LinkSim

Link planning web application for terrain-aware radio path analysis.

Inspired by Radio Mobile by Roger Coude (VE2DBE).

## Repository Status

- License: GNU GPL v3.0 ([LICENSE](./LICENSE))
- Security policy: [SECURITY.md](./SECURITY.md)
- Privacy notice: [docs/legal/PRIVACY.md](./docs/legal/PRIVACY.md)
- Terms and acceptable use: [docs/legal/TERMS.md](./docs/legal/TERMS.md)
- Sensitive data warning: do not store secrets in app content; visibility levels are collaboration controls, not a secret vault.
- Legal credits/notices:
  - [docs/legal/CREDITS.md](./docs/legal/CREDITS.md)
  - [docs/legal/THIRD_PARTY_NOTICES.md](./docs/legal/THIRD_PARTY_NOTICES.md)
  - [docs/legal/SOURCE_COMPLIANCE.md](./docs/legal/SOURCE_COMPLIANCE.md)

## Environment Model

The project is operated in three stages:

1. Local dev (primary iteration environment)
2. Staging (cloud validation)
3. Production (live)

Operational rule:
- Changes are built and tested locally first.
- Then deployed to staging.
- Then promoted to production.

## Quick Start (Local)

Install dependencies:

```bash
npm install
```

Run local edge-parity stack:

```bash
docker compose up --build edge
```

Open:
- `http://localhost:8788`

Other local runtime options (legacy/optional):

```bash
npm run dev
npm run dev:edge
docker compose up --build web
docker compose up --build dev
```

Default ports:
- `edge`: `http://localhost:8788`
- `web`: `http://localhost:8080`
- `dev`: `http://localhost:5173`

## Build, Test, Smoke

Core commands:

```bash
npm run build
npm test
npm run test:ci
```

Additional smoke scripts:

```bash
npm run smoke:edge
npm run smoke:scenario
npm run smoke:profile
npm run smoke:fit-profile
npm run smoke:itm
```

## Deploy and Release

### Staging deploy

```bash
npm run deploy:staging:main
```

### Production deploy (guarded)

```bash
npm run deploy:prod:main
```

`deploy:prod:main` is blocked unless release requirements are met:
- `HEAD` is tagged `v<package.json version>`
- Version is bumped in `HEAD` compared to `HEAD^`

### Recommended release flow (use this)

```bash
npm run release:prod
```

Optional bump level:

```bash
npm run release:prod -- --bump minor
npm run release:prod -- --bump major
```

What `release:prod` does:
1. Bumps version in `package.json`
2. Regenerates build metadata
3. Commits + tags release
4. Pushes `main` and tags
5. Deploys staging
6. Deploys production

Build label rules:
- Local: `vX.Y.Z-alpha+<commit>`
- Staging: `vX.Y.Z-beta+<commit>`
- Production: `vX.Y.Z`
- Same commit always keeps the same base version (`X.Y.Z`) across all environments.

## Cloudflare Setup Overview

This repo uses:
- Cloudflare Pages + Functions
- D1 for application data
- R2 for avatar images
- Cloudflare Access for authentication boundary

Primary configs:
- Production: [wrangler.toml](./wrangler.toml)
- Staging: [wrangler.staging.toml](./wrangler.staging.toml)

Optional basemap provider environment variables (admin-configured only):
- `VITE_MAPTILER_KEY`
- `VITE_STADIA_KEY`
- `VITE_KARTVERKET_API_KEY`
- `VITE_KARTVERKET_WMTS_BASE_URL` (optional override)
- `VITE_KARTVERKET_TILE_TEMPLATE` (optional explicit template; overrides base URL)

Detailed setup docs:
- [docs/cloudflare-auth-setup.md](./docs/cloudflare-auth-setup.md)
- [docs/access-policy-templates.md](./docs/access-policy-templates.md)

## Staging Data Refresh

Refresh staging from production snapshots:

```bash
npm run refresh:staging
```

Or run separately:

```bash
npm run refresh:staging:d1
npm run refresh:staging:r2
```

## Data/Service Notes

- Terrain data is fetched on demand and cached client-side.
- API proxies and geocode endpoints include method/rate-limit safeguards.
- In local runtimes without edge functions, some cloud behaviors are emulated/fallback.
- Basemap provider failures auto-fallback to CARTO with a non-blocking warning.

## Project Structure

- `src/`: frontend app
- `functions/`: Cloudflare Pages Functions API
- `db/`: SQL schema and migration assets
- `scripts/`: deploy/release/smoke tooling
- `config/`: TS/Vite/Vitest configs
- `docs/`: setup, legal, testing, and operations documentation
- `public/`: static assets
- `nginx/`: nginx config used by Docker flows

## Contributor Notes

- Keep working tree clean before deploy commands.
- Prefer `npm run release:prod` over manual production deploy.
- When changing auth/permissions, add or update tests in the same pass.
