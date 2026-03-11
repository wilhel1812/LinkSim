# Radio Mobile Web (WIP)

Web rewrite of Radio Mobile concepts with terrain-aware link/profile/coverage workflows.

## Terrain Data Sources (ve2dbe)

Primary source: [https://www.ve2dbe.com/geodata/](https://www.ve2dbe.com/geodata/)

Implemented source flow:

1. Query area using `geodata/gettile.asp` (`mode` for `srtm1/srtm3/srtmthird`).
2. Parse returned archive links (for example `srtm1/N59E010.hgt.zip`).
3. Download archives.
4. Cache archives in browser Cache Storage.
5. Parse `.hgt` from `.zip` and load into simulation terrain store.

## Bundled Terrain (No User Download Needed)

Bundled from ve2dbe `srtm1` for built-in scenarios:

- `N59E010.hgt.zip`
- `N59E011.hgt.zip`
- `N60E009.hgt.zip`

Location: `public/srtm1/`

These are auto-loaded at app start and also available via the Terrain panel button.

## Dev/Preview Proxy

The browser cannot directly POST/fetch `ve2dbe` endpoints due CORS.
This project proxies ve2dbe through Vite:

- `/ve2dbe/geodata/gettile.asp`
- `/ve2dbe/geodata/<dataset>/<tile>.hgt.zip`

Configured in `vite.config.ts` for both `server.proxy` and `preview.proxy`.

## Running

```bash
npm install
npm run dev
```

## Notes

- The map `SimTerrain` overlay visualizes elevations sampled from the same SRTM tiles used in propagation calculations.
- `.hgt` and `.hgt.zip` uploads are both supported in the Terrain panel.
