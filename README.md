# LinkSim (WIP)

Independent web reimplementation inspired by Radio Mobile workflows.

- Not affiliated with VE2DBE.
- No original Radio Mobile binaries/assets are redistributed in this repository.
- Terrain archives are fetched from official sources at runtime and cached locally.

## Data Flow

1. Area selection (from current scenario/site extent).
2. Query `https://www.ve2dbe.com/geodata/gettile.asp` for available tiles.
3. Download selected `.hgt.zip` archives from ve2dbe geodata endpoints.
4. Cache archives in browser Cache Storage.
5. Parse and use loaded SRTM tiles in propagation/profile/terrain overlay.

## External Service Safeguards

- Geocoding requests prefer `/api/geocode` (with per-IP rate limits + short-lived edge caching when running with Functions).
- Geocode calls gracefully fall back to direct Nominatim in local runtimes without Functions.
- Upstream proxy routes (`/meshmap/*`, `/ve2dbe/*`) are limited to `GET/HEAD` and include per-IP request caps in Functions.
- Fallback map raster tiles use CARTO CDN attribution endpoints rather than direct OSM tile hosts.

## Runtime Proxy

Vite proxy is used for browser CORS compatibility in dev/preview:

- `/ve2dbe/geodata/gettile.asp`
- `/ve2dbe/geodata/<dataset>/<tile>.hgt.zip`

See `config/vite.config.ts`.

## Legal/Attribution

- Credits: [docs/legal/CREDITS.md](./docs/legal/CREDITS.md)
- Third-party/data notices: [docs/legal/THIRD_PARTY_NOTICES.md](./docs/legal/THIRD_PARTY_NOTICES.md)
- Project license: GNU GPL v3.0 ([LICENSE](./LICENSE))
- Security policy: [SECURITY.md](./SECURITY.md)

## Project Structure

- `src/`: app source code
- `public/`: static assets
- `config/`: TypeScript, Vite, and Vitest configuration
- `scripts/`: smoke and browser automation scripts
- `docs/legal/`: credits and third-party notices
- `nginx/`: production nginx config used by Docker

## Running

Install dependencies:

```bash
npm install
```

Primary local runtime (recommended): Docker edge parity stack

```bash
docker compose up --build edge
```

App is available at `http://localhost:8788`.

Legacy local runtimes (kept for compatibility):

```bash
npm run dev
npm run dev:edge
```

## Cloud Auth + D1 (Cloudflare-Only)

This repository now includes:

- Cloudflare Pages Functions API under `functions/api/*`
- D1 schema at `db/schema.sql`
- Cloudflare Access integration for edge authentication

Detailed setup steps:

- [docs/cloudflare-auth-setup.md](./docs/cloudflare-auth-setup.md)
- [docs/access-policy-templates.md](./docs/access-policy-templates.md)

## Testing

- Test plan: [docs/testing-plan.md](./docs/testing-plan.md)
- TDD workflow: [docs/tdd-workflow.md](./docs/tdd-workflow.md)
- Run baseline checks:

```bash
npm test
npm run test:ci
npm run build
```

## Running with Docker Compose

Preferred:

```bash
docker compose up --build edge
```

Legacy/optional:

```bash
docker compose up --build web
docker compose up --build dev
```

Ports:
- `edge`: `http://localhost:8788`
- `web`: `http://localhost:8080`
- `dev`: `http://localhost:5173`
