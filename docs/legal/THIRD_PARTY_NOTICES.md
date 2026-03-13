# Third-Party Notices

## Code Dependencies

This project uses open-source npm packages listed in `package.json` and distributed under their respective licenses.

## External Data and Services

### Terrain Data

- Copernicus DEM GLO-30 and GLO-90 tile catalogs and data:
  - `https://copernicus-dem-30m.s3.amazonaws.com/`
  - `https://copernicus-dem-90m.s3.amazonaws.com/`
- Terrain tiles are fetched at runtime and cached locally in-browser.
- Use of fetched data should comply with applicable source terms and licenses.
- Operational policy: see [SOURCE_COMPLIANCE.md](./SOURCE_COMPLIANCE.md).

### Online Site Elevation Sync

- Open-Meteo elevation API:
  - `https://api.open-meteo.com/v1/elevation`

### Basemap Rendering

- CARTO style endpoints (Positron / Dark Matter) for map styling.
- Map rendering is done with MapLibre GL.

## Non-Affiliation

This project is independent and not affiliated with, endorsed by, or sponsored by VE2DBE / Radio Mobile.
