import type { StyleSpecification } from "maplibre-gl";
import { THEMES } from "../themes";
import type { UiColorTheme } from "../themes/types";

export type BasemapProvider = "carto" | "maptiler" | "stadia" | "kartverket" | "npolar";
export type BasemapTheme = "light" | "dark";
export type BasemapCategory = "street" | "terrain" | "topographic" | "photo" | "artistic" | "regional";

export type BasemapStyleEntry = {
  id: string;
  label: string;
  category: BasemapCategory;
  hasDarkMode: boolean;
  isThemed: boolean;
  requiresKey: boolean;
  available: boolean;
  regional?: { region: string };
};

export type BasemapSelectionResolved = {
  styleId: string;
  style: string | StyleSpecification;
  attribution: string;
  attributionUrl: string;
  provider: BasemapProvider;
  providerLabel: string;
  presetId: string;
  presetLabel: string;
  isThemed: boolean;
  fallbackReason: string | null;
};

const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const CARTO_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CARTO_VOYAGER = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

const CARTO_ATTRIBUTION =
  '© OpenStreetMap contributors © CARTO';

const MAPTILER_KEY = String(import.meta.env.VITE_MAPTILER_KEY ?? "").trim();
const STADIA_KEY = String(import.meta.env.VITE_STADIA_KEY ?? "").trim();
const KARTVERKET_KEY = String(import.meta.env.VITE_KARTVERKET_API_KEY ?? "").trim();
const KARTVERKET_TILE_TEMPLATE = String(import.meta.env.VITE_KARTVERKET_TILE_TEMPLATE ?? "").trim();
const KARTVERKET_BASE_URL = String(import.meta.env.VITE_KARTVERKET_WMTS_BASE_URL ?? "").trim();

const defaultKartverketTileTemplate =
  "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";

const kartverketTileTemplate = (() => {
  const base = KARTVERKET_TILE_TEMPLATE ||
    (KARTVERKET_BASE_URL ? `${KARTVERKET_BASE_URL.replace(/\/$/, "")}/{z}/{y}/{x}.png` : defaultKartverketTileTemplate);
  if (!KARTVERKET_KEY) return base;
  const glue = base.includes("?") ? "&" : "?";
  return `${base}${glue}api_key=${encodeURIComponent(KARTVERKET_KEY)}`;
})();

const cartoRasterTilesForTheme = (theme: BasemapTheme): string[] =>
  theme === "dark"
    ? [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ]
    : [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ];

const cartoThemedTint = (
  colorTheme: UiColorTheme,
  theme: BasemapTheme,
): { color: string; opacity: number } => {
  return {
    color: THEMES[colorTheme][theme].cssVars["--terrain"],
    opacity: theme === "dark" ? 0.1 : 0.08,
  };
};

const themedCartoStyle = (theme: BasemapTheme, colorTheme: UiColorTheme): StyleSpecification => {
  const tint = cartoThemedTint(colorTheme, theme);
  return {
    version: 8,
    sources: {
      cartoRaster: {
        type: "raster",
        tiles: cartoRasterTilesForTheme(theme),
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
      },
      tintMask: {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
          },
          properties: {},
        },
      },
    },
    layers: [
      {
        id: "carto-raster-base",
        type: "raster",
        source: "cartoRaster",
        minzoom: 0,
        maxzoom: 22,
      },
      {
        id: "theme-tint-overlay",
        type: "fill",
        source: "tintMask",
        paint: {
          "fill-color": tint.color,
          "fill-opacity": tint.opacity,
        },
      },
    ],
  } as StyleSpecification;
};

const maptilerStyle = (preset: string, theme: BasemapTheme): string => {
  const mapId =
    preset === "topographic"
      ? theme === "dark"
        ? "topo-v2-dark"
        : "topo-v2"
      : preset === "satellite"
        ? "satellite"
        : preset === "satellite-hybrid"
          ? "hybrid"
        : theme === "dark"
          ? "streets-v2-dark"
          : "streets-v2";
  return `https://api.maptiler.com/maps/${encodeURIComponent(mapId)}/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`;
};

const stadiaStyle = (preset: string, theme: BasemapTheme): string => {
  const styleId =
    preset === "outdoors"
      ? "outdoors"
      : preset === "alidade-bright"
        ? "alidade_bright"
        : preset === "alidade-satellite"
          ? "alidade_satellite"
          : preset === "osm-bright"
            ? "osm_bright"
            : preset === "stamen-toner"
              ? theme === "dark"
                ? "stamen_toner_dark"
                : "stamen_toner"
              : preset === "stamen-terrain"
                ? "stamen_terrain"
                : preset === "stamen-watercolor"
                  ? "stamen_watercolor"
                  : theme === "dark"
                    ? "alidade_smooth_dark"
                    : "alidade_smooth";
  const base = `https://tiles.stadiamaps.com/styles/${encodeURIComponent(styleId)}.json`;
  if (!STADIA_KEY) return base;
  return `${base}?api_key=${encodeURIComponent(STADIA_KEY)}`;
};

const NP_WMTS_BASE = "https://geodata.npolar.no/arcgis/rest/services/Basisdata";
const NP_TILE_MATRIX_SET = "GoogleMapsCompatible";

const npolarTileUrl = (service: string, layer: string): string =>
  `${NP_WMTS_BASE}/${service}/MapServer/WMTS/tile/1.0.0/${layer}/default/${NP_TILE_MATRIX_SET}/{z}/{y}/{x}`;

const NP_FULL_SVALBARD_BOUNDS: [number, number, number, number] = [7.47, 73.74, 36.05, 81.16];
const NP_ORTOFOTO_BOUNDS: [number, number, number, number] = [10.13, 74.32, 34.30, 80.91];
const NP_ATTRIBUTION = '© Norsk Polarinstitutt';

const npolarStyle = (preset: string): StyleSpecification => {
  let tileUrl: string;
  let bounds: [number, number, number, number];
  switch (preset) {
    case "satellite":
      tileUrl = npolarTileUrl("NP_Satellitt_Svalbard_WMTS_3857", "Basisdata_NP_Satellitt_Svalbard_WMTS_3857");
      bounds = NP_FULL_SVALBARD_BOUNDS;
      break;
    case "orthophoto":
      tileUrl = npolarTileUrl("NP_Ortofoto_Svalbard_WMTS_3857", "Basisdata_NP_Ortofoto_Svalbard_WMTS_3857");
      bounds = NP_ORTOFOTO_BOUNDS;
      break;
    case "topographic":
    default:
      tileUrl = npolarTileUrl("NP_Basiskart_Svalbard_WMTS_3857", "Basisdata_NP_Basiskart_Svalbard_WMTS_3857");
      bounds = NP_FULL_SVALBARD_BOUNDS;
      break;
  }
  return {
    version: 8,
    sources: {
      npolar: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution: NP_ATTRIBUTION,
        bounds,
        maxzoom: 18,
      },
    },
    layers: [
      {
        id: "npolar-base",
        type: "raster",
        source: "npolar",
        minzoom: 0,
        maxzoom: 18,
      },
    ],
  } as StyleSpecification;
};

const kartverketStyleObject = {
  version: 8,
  sources: {
    kartverket: {
      type: "raster",
      tiles: [kartverketTileTemplate],
      tileSize: 256,
      attribution: '© Kartverket',
      bounds: [3.5, 57.7, 32.0, 71.5],
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: "kartverket-base",
      type: "raster",
      source: "kartverket",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
} as const;

// Internal attribution data — not exported as part of the public API.
type ProviderAttribution = {
  provider: BasemapProvider;
  label: string;
  attribution: string;
  attributionUrl: string;
};

const PROVIDER_ATTRIBUTIONS: ProviderAttribution[] = [
  {
    provider: "carto",
    label: "CARTO",
    attribution: CARTO_ATTRIBUTION,
    attributionUrl: "https://carto.com/attributions",
  },
  {
    provider: "maptiler",
    label: "MapTiler",
    attribution: "© OpenStreetMap contributors © MapTiler",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
  {
    provider: "stadia",
    label: "Stadia",
    attribution: "© Stadia Maps © OpenMapTiles © OpenStreetMap contributors © Stamen Design",
    attributionUrl: "https://stadiamaps.com/",
  },
  {
    provider: "kartverket",
    label: "Kartverket",
    attribution: "© Kartverket",
    attributionUrl: "https://kartverket.no/",
  },
  {
    provider: "npolar",
    label: "Norsk Polarinstitutt",
    attribution: NP_ATTRIBUTION,
    attributionUrl: "https://npolar.no/",
  },
  {
    provider: "npolar",
    label: "Norsk Polarinstitutt",
    group: "regional",
    attribution: NP_ATTRIBUTION,
    attributionUrl: "https://npolar.no/",
    requiresKey: false,
    available: true,
    presets: npolarPresets,
  },
];

const styleForPreset = (
  provider: BasemapProvider,
  presetId: string,
  theme: BasemapTheme,
  colorTheme: UiColorTheme,
): string | StyleSpecification => {
  if (provider === "carto") {
    if (presetId === "normal-themed") return themedCartoStyle(theme, colorTheme);
    if (presetId === "topographic") return CARTO_VOYAGER;
    return theme === "dark" ? CARTO_DARK : CARTO_LIGHT;
  }
  if (provider === "maptiler") {
    // topographic-themed uses the same official style as topographic (theme color overlay is added by MapView)
    if (presetId === "topographic-themed") return maptilerStyle("topographic", theme);
    return maptilerStyle(presetId || "normal", theme);
  }
  if (provider === "stadia") {
    // outdoors-themed uses the same official style as outdoors (theme color overlay is added by MapView)
    if (presetId === "outdoors-themed") return stadiaStyle("outdoors", theme);
    return stadiaStyle(presetId || "normal", theme);
  }
  if (provider === "npolar") {
    return npolarStyle(presetId);
  }
  return kartverketStyleObject as unknown as StyleSpecification;
};

// Maps each styleId to its backend provider + preset for style resolution.
const STYLE_REGISTRY_BACKEND: Record<string, { provider: BasemapProvider; preset: string }> = {
  "street-linksim":          { provider: "carto",      preset: "normal-themed" },
  "street-positron":         { provider: "carto",      preset: "normal" },
  "street-maptiler":         { provider: "maptiler",   preset: "normal" },
  "street-alidade":          { provider: "stadia",     preset: "normal" },
  "street-alidade-bright":   { provider: "stadia",     preset: "alidade-bright" },
  "street-osm":              { provider: "stadia",     preset: "osm-bright" },
  "terrain-outdoors":        { provider: "stadia",     preset: "outdoors-themed" },
  "terrain-voyager":         { provider: "carto",      preset: "topographic" },
  "terrain-stamen":          { provider: "stadia",     preset: "stamen-terrain" },
  "topo-topo":               { provider: "maptiler",   preset: "topographic-themed" },
  "topo-kartverket":         { provider: "kartverket", preset: "topographic" },
  "topo-npolar":             { provider: "npolar",     preset: "topographic" },
  "photo-satellite":         { provider: "maptiler",   preset: "satellite" },
  "photo-hybrid":            { provider: "maptiler",   preset: "satellite-hybrid" },
  "photo-alidade":           { provider: "stadia",     preset: "alidade-satellite" },
  "photo-npolar-satellite":  { provider: "npolar",     preset: "satellite" },
  "photo-npolar-orthophoto": { provider: "npolar",     preset: "orthophoto" },
  "artistic-toner":          { provider: "stadia",     preset: "stamen-toner" },
  "artistic-watercolor":     { provider: "stadia",     preset: "stamen-watercolor" },
};

export const DEFAULT_BASEMAP_STYLE_ID = "street-linksim";

export const BASEMAP_STYLE_REGISTRY: BasemapStyleEntry[] = [
  // Street
  { id: "street-linksim",          label: "LinkSim",               category: "street",       hasDarkMode: true,  isThemed: true,  requiresKey: false, available: true },
  { id: "street-positron",         label: "Positron / Dark Matter", category: "street",       hasDarkMode: true,  isThemed: false, requiresKey: false, available: true },
  { id: "street-maptiler",         label: "MapTiler Streets",       category: "street",       hasDarkMode: true,  isThemed: false, requiresKey: true,  available: MAPTILER_KEY.length > 0 },
  { id: "street-alidade",          label: "Alidade Smooth",         category: "street",       hasDarkMode: true,  isThemed: false, requiresKey: false, available: true },
  { id: "street-alidade-bright",   label: "Alidade Bright",         category: "street",       hasDarkMode: false, isThemed: false, requiresKey: false, available: true },
  { id: "street-osm",              label: "Open Street Maps",       category: "street",       hasDarkMode: false, isThemed: false, requiresKey: false, available: true },
  // Terrain
  { id: "terrain-outdoors",        label: "Outdoors",               category: "terrain",      hasDarkMode: false, isThemed: true,  requiresKey: false, available: true },
  { id: "terrain-voyager",         label: "Voyager",                category: "terrain",      hasDarkMode: false, isThemed: false, requiresKey: false, available: true },
  { id: "terrain-stamen",          label: "Stamen Terrain",         category: "terrain",      hasDarkMode: false, isThemed: false, requiresKey: false, available: true },
  // Topographic
  { id: "topo-topo",               label: "Topo",                   category: "topographic",  hasDarkMode: true,  isThemed: true,  requiresKey: true,  available: MAPTILER_KEY.length > 0 },
  { id: "topo-kartverket",         label: "Kartverket",             category: "topographic",  hasDarkMode: false, isThemed: false, requiresKey: false, available: true,  regional: { region: "Norway" } },
  { id: "topo-npolar",             label: "NPolar Topographic",     category: "topographic",  hasDarkMode: false, isThemed: false, requiresKey: false, available: true,  regional: { region: "Svalbard" } },
  // Photo
  { id: "photo-satellite",         label: "MapTiler Satellite",     category: "photo",        hasDarkMode: false, isThemed: false, requiresKey: true,  available: MAPTILER_KEY.length > 0 },
  { id: "photo-hybrid",            label: "MapTiler Hybrid",        category: "photo",        hasDarkMode: false, isThemed: false, requiresKey: true,  available: MAPTILER_KEY.length > 0 },
  { id: "photo-alidade",           label: "Alidade Satellite",      category: "photo",        hasDarkMode: false, isThemed: false, requiresKey: false, available: true },
  { id: "photo-npolar-satellite",  label: "NPolar Satellite",       category: "photo",        hasDarkMode: false, isThemed: false, requiresKey: false, available: true,  regional: { region: "Svalbard" } },
  { id: "photo-npolar-orthophoto", label: "NPolar Orthophoto",      category: "photo",        hasDarkMode: false, isThemed: false, requiresKey: false, available: true,  regional: { region: "Svalbard" } },
  // Artistic
  { id: "artistic-toner",          label: "Stamen Toner",           category: "artistic",     hasDarkMode: true,  isThemed: false, requiresKey: false, available: true },
  { id: "artistic-watercolor",     label: "Stamen Watercolor",      category: "artistic",     hasDarkMode: false, isThemed: false, requiresKey: false, available: true },
];

export const BASEMAP_CATEGORIES: { id: BasemapCategory; label: string }[] = [
  { id: "street",      label: "Street" },
  { id: "terrain",     label: "Terrain" },
  { id: "topographic", label: "Topographic" },
  { id: "photo",       label: "Photo" },
  { id: "artistic",    label: "Artistic" },
  { id: "regional",    label: "Regional" },
];

// Returns entries for a given category.
// For "regional": all entries with a `regional` field, sorted Kartverket → NPolar.
// For other categories: global (non-regional) entries first, then regional entries.
export const getStylesForCategory = (category: BasemapCategory): BasemapStyleEntry[] => {
  if (category === "regional") {
    return BASEMAP_STYLE_REGISTRY.filter((e) => e.regional !== undefined).sort((a, b) => {
      const providerOrder: Record<string, number> = { kartverket: 0, npolar: 1 };
      const pa = providerOrder[STYLE_REGISTRY_BACKEND[a.id]?.provider ?? ""] ?? 2;
      const pb = providerOrder[STYLE_REGISTRY_BACKEND[b.id]?.provider ?? ""] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.label.localeCompare(b.label);
    });
  }
  const global = BASEMAP_STYLE_REGISTRY.filter((e) => e.category === category && !e.regional);
  const regional = BASEMAP_STYLE_REGISTRY.filter((e) => e.category === category && e.regional);
  return [...global, ...regional];
};

// Returns the category of a style entry; for entries without a category, defaults to "street".
export const getCategoryForStyleId = (styleId: string): BasemapCategory => {
  const entry = BASEMAP_STYLE_REGISTRY.find((e) => e.id === styleId);
  return entry?.category ?? "street";
};

// Returns the first available style ID for a category, or the first overall if all are unavailable.
export const getDefaultStyleIdForCategory = (category: BasemapCategory): string => {
  const styles = getStylesForCategory(category);
  return (styles.find((s) => s.available) ?? styles[0])?.id ?? DEFAULT_BASEMAP_STYLE_ID;
};

export const resolveBasemapSelection = (
  styleId: string,
  theme: BasemapTheme,
  colorTheme: UiColorTheme = "blue",
): BasemapSelectionResolved => {
  const entry = BASEMAP_STYLE_REGISTRY.find((e) => e.id === styleId);
  const fallbackEntry = BASEMAP_STYLE_REGISTRY.find((e) => e.id === DEFAULT_BASEMAP_STYLE_ID)!;
  const resolved = entry && entry.available ? entry : fallbackEntry;
  const fallbackReason = !entry
    ? `Unknown basemap style "${styleId}". Switched to default.`
    : !entry.available
      ? `"${entry.label}" requires a missing API key. Switched to default.`
      : null;

  const backend = STYLE_REGISTRY_BACKEND[resolved.id];
  const providerAttr = PROVIDER_ATTRIBUTIONS.find((p) => p.provider === backend.provider) ?? PROVIDER_ATTRIBUTIONS[0];

  return {
    styleId: resolved.id,
    style: styleForPreset(backend.provider, backend.preset, theme, colorTheme),
    attribution: providerAttr.attribution,
    attributionUrl: providerAttr.attributionUrl,
    provider: backend.provider,
    providerLabel: providerAttr.label,
    presetId: backend.preset,
    presetLabel: resolved.label,
    isThemed: resolved.isThemed,
    fallbackReason,
  };
};

export const getCartoFallbackStyle = (
  theme: BasemapTheme,
  colorTheme: UiColorTheme = "blue",
): string | StyleSpecification => styleForPreset("carto", "normal-themed", theme, colorTheme);
