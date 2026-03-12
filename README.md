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

## Runtime Proxy

Vite proxy is used for browser CORS compatibility in dev/preview:

- `/ve2dbe/geodata/gettile.asp`
- `/ve2dbe/geodata/<dataset>/<tile>.hgt.zip`

See `config/vite.config.ts`.

## Legal/Attribution

- Credits: [docs/legal/CREDITS.md](./docs/legal/CREDITS.md)
- Third-party/data notices: [docs/legal/THIRD_PARTY_NOTICES.md](./docs/legal/THIRD_PARTY_NOTICES.md)
- Project license: [LICENSE](./LICENSE)
- Security policy: [SECURITY.md](./SECURITY.md)

## Project Structure

- `src/`: app source code
- `public/`: static assets
- `config/`: TypeScript, Vite, and Vitest configuration
- `scripts/`: smoke and browser automation scripts
- `docs/legal/`: credits and third-party notices
- `nginx/`: production nginx config used by Docker

## Running

```bash
npm install
npm run dev
```

## Local-First Workflow (Recommended)

Fast UI iteration (no Cloudflare build usage):

```bash
npm run dev
```

Full local edge stack (Pages Functions + local D1):

```bash
npm run dev:edge
```

Use `dev` during daily UI iteration, and `dev:edge` when validating auth/API/permissions before pushing.

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
- Run baseline checks:

```bash
npm test
npm run build
```

## Running with Docker Compose

Production-like runtime (nginx + static assets + reverse proxy):

```bash
docker compose up --build web
```

App is available at `http://localhost:8080`.

Development runtime (Vite dev server with live reload):

```bash
docker compose up --build dev
```

App is available at `http://localhost:5173`.
