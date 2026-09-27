/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPTILER_KEY?: string;
  readonly VITE_CARTO_KEY?: string;
  readonly VITE_STADIA_KEY?: string;
  readonly VITE_KARTVERKET_API_KEY?: string;
  readonly VITE_KARTVERKET_WMTS_BASE_URL?: string;
  readonly VITE_KARTVERKET_TILE_TEMPLATE?: string;
  readonly VITE_PEAK_TILES_MANIFEST_URL?: string;
  readonly VITE_BETTER_AUTH_PILOT?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
