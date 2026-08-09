# Repository Guide

This page preserves the technical repository notes that previously lived in
`../README.md`. Keep the root README focused as the project landing page.

## LinkSim

Link planning web application for terrain-aware radio path analysis.

Inspired by Radio Mobile by Roger Coude (VE2DBE).

## Repository Status

- License: GNU GPL v3.0 ([LICENSE](../LICENSE))
- Security policy: [SECURITY.md](../SECURITY.md)
- Privacy notice: [docs/legal/PRIVACY.md](./legal/PRIVACY.md)
- Terms and acceptable use: [docs/legal/TERMS.md](./legal/TERMS.md)
- Sensitive data warning: do not store secrets in app content; visibility levels are collaboration controls, not a secret vault.
- Legal credits/notices:
  - [docs/legal/CREDITS.md](./legal/CREDITS.md)
  - [docs/legal/THIRD_PARTY_NOTICES.md](./legal/THIRD_PARTY_NOTICES.md)
  - [docs/legal/SOURCE_COMPLIANCE.md](./legal/SOURCE_COMPLIANCE.md)

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

CI uses Node.js 22. Install dependencies from the lockfile:

```bash
npm ci
```

Start the Vite development server for normal frontend work:

```bash
npm run dev
```

Vite reports the local URL, normally `http://localhost:5173`.

Use the local edge stack when Pages Functions, D1, or R2 behavior is part of the change:

```bash
npm run dev:edge
```

It serves the built app and local Cloudflare bindings at `http://localhost:8788`. Docker Compose provides equivalent `dev`, `edge`, and production-style `web` services when a container workflow is preferred.

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

## Calculation API

`/api/v1/calculate` runs directly in LinkSim Pages Functions and uses the same propagation stack as the app (`ITM` with Copernicus terrain sampling).

Behavior notes:

- Public endpoint: `https://linksim.link/api/v1/calculate`
- Terrain source: Copernicus DEM via `/copernicus/30m/*`
- If node ground elevation is omitted, the API samples terrain and uses that elevation with `2m` default antenna height
- Result includes app-style pass/fail text, for example `LOS clear + fail at 83.39 km (-133.6 dBm after env loss)`
- Edge rate limit: `CALC_API_PROXY_RATE_LIMIT_PER_MINUTE` (default `120`)

Example request:

```bash
curl -X POST http://localhost:8788/api/v1/calculate \
  -H 'content-type: application/json' \
  -d '{
    "calculation": "link_budget",
    "input": {
      "from_site": "Site A",
      "to_site": "Site B",
      "frequency_mhz": 868,
      "rx_target_dbm": -110,
      "nodes": [
        {"name": "Site A", "lat": 59.9139, "lon": 10.7522},
        {"name": "Site B", "lat": 59.9170, "lon": 10.7600}
      ]
    }
  }'
```

API nodes may optionally set `antenna_mode` to `directional` and provide
`antenna_azimuth_deg`, `antenna_tilt_deg`,
`antenna_horizontal_beamwidth_deg`, `antenna_vertical_beamwidth_deg`, and
`antenna_max_attenuation_db`. Omitted antenna fields preserve omnidirectional
behavior. Site-target tracking is an editor convenience; API requests use fixed
angles.

## Deploy and Release

Use [docs/release-flow.md](./release-flow.md) as the source of truth for
deployment and release operations. Normal staging and production deploys run
from CI after PRs merge to `staging` or `main`; do not run deploy scripts
locally for the standard release flow.

Do not duplicate release commands or version requirements here. The release-flow document owns the branch, tag, SemVer, build-label, deployment, and promotion rules.

## Cloudflare Setup Overview

This repo uses:
- Cloudflare Pages + Functions
- D1 for application data
- R2 for avatar images
- Cloudflare Access for authentication boundary

Primary configs:
- Production: [wrangler.toml](../wrangler.toml)
- Staging: [wrangler.staging.toml](../wrangler.staging.toml)

Optional basemap provider environment variables (admin-configured only):
- `VITE_MAPTILER_KEY`
- `VITE_STADIA_KEY`
- `VITE_KARTVERKET_API_KEY`
- `VITE_KARTVERKET_WMTS_BASE_URL` (optional override)
- `VITE_KARTVERKET_TILE_TEMPLATE` (optional explicit template; overrides base URL)

Detailed setup docs:
- [docs/cloudflare-auth-setup.md](./cloudflare-auth-setup.md)
- [docs/access-policy-templates.md](./access-policy-templates.md)

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

- Keep the working tree clean before release operations. Build metadata under `.tmp/` is generated and untracked.
- Follow [docs/release-flow.md](./release-flow.md) for production promotion.
- When changing auth/permissions, add or update tests in the same pass.
