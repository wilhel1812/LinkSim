# Third-Party Notices

## Code Dependencies

This project uses open-source npm packages listed in `package.json` and distributed under their respective licenses.

## External Data and Services

### Radio Mobile / ve2dbe

- Source portal used by runtime fetch:
  - https://www.ve2dbe.com/geodata/
- Tile availability is queried from:
  - `https://www.ve2dbe.com/geodata/gettile.asp`
- Terrain archives are fetched at runtime from ve2dbe geodata endpoints and cached locally in-browser.

### Upstream Elevation/Landcover Sources Listed by ve2dbe

As listed on the ve2dbe geodata page, sources include:

- NASA Shuttle Radar Topography Mission
- USA National map viewer
- Natural Resources Canada
- European Environment Agency
- Viewfinder Panoramas

Use of fetched data should comply with applicable source terms and licenses.

### Online Site Elevation Sync

- Open-Meteo elevation API:
  - `https://api.open-meteo.com/v1/elevation`

### Basemap Rendering

- CARTO style endpoints (Positron / Dark Matter) for map styling.
- Map rendering is done with MapLibre GL.

## Non-Affiliation

This project is independent and not affiliated with, endorsed by, or sponsored by VE2DBE / Radio Mobile.
