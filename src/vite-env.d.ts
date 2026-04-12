/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPTILER_KEY?: string;
  readonly VITE_STADIA_KEY?: string;
  readonly VITE_KARTVERKET_API_KEY?: string;
  readonly VITE_KARTVERKET_WMTS_BASE_URL?: string;
  readonly VITE_KARTVERKET_TILE_TEMPLATE?: string;
  readonly VITE_PEAK_TILES_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
