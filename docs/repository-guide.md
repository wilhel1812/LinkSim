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

Vite serves the local app at the fixed URL `http://localhost:5174`.

Use the local edge stack when Pages Functions, D1, or R2 behavior is part of the change:

```bash
npm run dev:edge
```

It serves the built app and local Cloudflare bindings at `http://localhost:8788`. Docker Compose provides equivalent `dev`, `edge`, and production-style `web` services when a container workflow is preferred.

Docker Compose publishes the `dev` and `edge` services on loopback by default. To make those development services reachable from another trusted machine, opt in explicitly for that invocation:

```bash
LINKSIM_DOCKER_BIND_ADDRESS=0.0.0.0 docker compose up dev edge
```

Do not use a public bind address on an untrusted network. The standalone calculation API ignores caller-supplied forwarding headers and uses its direct peer address for rate limiting. When it is intentionally placed behind a reverse proxy, set Uvicorn's `FORWARDED_ALLOW_IPS` only to the known proxy IP address or CIDR; do not use a wildcard trust value.

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
- Request limits: `64 KiB` JSON body, at most `10` JSON nesting levels, `20` nodes, and `80` characters per site name
- Distance limits: `500 km` for synchronous calculations and `2,000 km` for asynchronous terrain jobs
- Terrain sampling limits: `72` synchronous samples and `500` asynchronous samples
- Asynchronous terrain jobs have an absolute `5 minute` deadline; terminal job records are retained for up to `24 hours` with at most `1,000` retained

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

## Terrain and Node-Feed Workload Limits

LinkSim bounds terrain and live-node processing before expensive parsing,
decompression, fetching, or rendering begins:

- MeshMap JSON responses are limited to `5 MiB` and `20,000` top-level node
  records. Direct/custom node feeds use the same bounds.
- The 868.no snapshot reader retains its `5 MiB`, `8 second` maximum, and
  `1 second` post-burst idle limits, with at most `5,000` SSE records.
- Normalized node caches retain at most `20,000` nodes per source and `25,000`
  nodes after sources are combined. Map markers retain the existing `1,000`
  in-view ceiling.
- Panorama considers at most `1,000` deterministic candidates within its
  existing `200 km` range before building signatures or running RF projection.
- Terrain enumeration and loading stop above `256` unique GLO-30 tile keys.
  Antimeridian-crossing bounds use their wrapped short interval.

Node-feed rate-limit values and keys, Copernicus fetch concurrency and retries,
catalog-confirmed ocean handling, and calculation-job cancellation/deadlines
remain governed by their existing endpoint contracts.

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
- `VITE_CARTO_KEY` (optional shared browser-visible key; domain-restrict it to the deployment domains)
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
- Browser forward location search uses the same-origin API, with bounded provider responses, a five-minute cache, configured per-caller limiting, and a per-isolate cache-miss gate.
- In local runtimes without edge functions, some cloud behaviors are emulated/fallback.
- Basemap provider failures transiently fall back to the OpenFreeMap LinkSim style, then to a provider-independent local background without changing the saved device selection.
- Custom MapLibre style and raster XYZ definitions sync in private account preferences; the active style remains device-local and requests go directly from the browser.

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
