# Radio Mobile Web (WIP)

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

See `vite.config.ts`.

## Legal/Attribution

- Credits: [CREDITS.md](./CREDITS.md)
- Third-party/data notices: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
- Project license: [LICENSE](./LICENSE)

## Running

```bash
npm install
npm run dev
```
