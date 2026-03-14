import type { StyleSpecification } from "maplibre-gl";
import type { UiColorTheme } from "../themes/types";

export type BasemapProvider = "carto" | "maptiler" | "stadia" | "kartverket";
export type BasemapTheme = "light" | "dark";
export type BasemapStylePreset = {
  id: string;
  label: string;
};

export type BasemapProviderCapability = {
  provider: BasemapProvider;
  label: string;
  group: "global" | "regional";
  attribution: string;
  requiresKey: boolean;
  keyEnvVar?: string;
  available: boolean;
  unavailableReason?: string;
  presets: BasemapStylePreset[];
};

export type BasemapSelectionResolved = {
  style: string | StyleSpecification;
  attribution: string;
  provider: BasemapProvider;
  providerLabel: string;
  presetId: string;
  presetLabel: string;
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

const cartoPresets: BasemapStylePreset[] = [
  { id: "normal-themed", label: "Normal" },
  { id: "normal", label: "Positron / Dark Matter" },
  { id: "topographic", label: "Voyager" },
];

const maptilerPresets: BasemapStylePreset[] = [
  { id: "normal", label: "Streets" },
  { id: "topographic", label: "Topo" },
  { id: "satellite", label: "Satellite" },
  { id: "satellite-hybrid", label: "Satellite Hybrid" },
];

const stadiaPresets: BasemapStylePreset[] = [
  { id: "normal", label: "Alidade Smooth (Normal)" },
  { id: "outdoors", label: "Outdoors (Topographic)" },
  { id: "alidade-satellite", label: "Alidade Satellite" },
  { id: "osm-bright", label: "OSM Bright" },
  { id: "stamen-toner", label: "Stamen Toner (High Contrast)" },
  { id: "stamen-terrain", label: "Stamen Terrain (Relief)" },
  { id: "stamen-watercolor", label: "Stamen Watercolor (Artistic)" },
];

const kartverketPresets: BasemapStylePreset[] = [
  { id: "topographic", label: "Topographic" },
];

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
  if (theme === "dark") {
    if (colorTheme === "pink") return { color: "#8f5678", opacity: 0.1 };
    if (colorTheme === "red") return { color: "#8d4b4b", opacity: 0.1 };
    if (colorTheme === "green") return { color: "#4d7f62", opacity: 0.1 };
    return { color: "#4f6f9a", opacity: 0.1 };
  }
  if (colorTheme === "pink") return { color: "#d379ab", opacity: 0.08 };
  if (colorTheme === "red") return { color: "#db8a8a", opacity: 0.08 };
  if (colorTheme === "green") return { color: "#76b28d", opacity: 0.08 };
  return { color: "#7fa7d8", opacity: 0.08 };
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
      ? "topo-v2"
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
      : preset === "alidade-satellite"
        ? "alidade_satellite"
        : preset === "osm-bright"
          ? "osm_bright"
          : preset === "stamen-toner"
            ? "stamen_toner"
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

const providerCapabilities: BasemapProviderCapability[] = [
  {
    provider: "carto",
    label: "CARTO",
    group: "global",
    attribution: CARTO_ATTRIBUTION,
    requiresKey: false,
    available: true,
    presets: cartoPresets,
  },
  {
    provider: "maptiler",
    label: "MapTiler",
    group: "global",
    attribution: "© OpenStreetMap contributors © MapTiler",
    requiresKey: true,
    keyEnvVar: "VITE_MAPTILER_KEY",
    available: MAPTILER_KEY.length > 0,
    unavailableReason: MAPTILER_KEY.length ? undefined : "Missing MAPTILER key",
    presets: maptilerPresets,
  },
  {
    provider: "stadia",
    label: "Stadia",
    group: "global",
    attribution: "© Stadia Maps © OpenMapTiles © OpenStreetMap contributors © Stamen Design",
    requiresKey: false,
    keyEnvVar: "VITE_STADIA_KEY",
    available: true,
    presets: stadiaPresets,
  },
  {
    provider: "kartverket",
    label: "Kartverket",
    group: "regional",
    attribution: "© Kartverket",
    requiresKey: false,
    available: true,
    presets: kartverketPresets,
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
    return maptilerStyle(presetId || "normal", theme);
  }
  if (provider === "stadia") {
    return stadiaStyle(presetId || "normal", theme);
  }
  return kartverketStyleObject as unknown as StyleSpecification;
};

const pickDefaultPreset = (
  provider: BasemapProvider,
  presets: BasemapStylePreset[],
  _theme: BasemapTheme,
): BasemapStylePreset => {
  if (provider === "carto") {
    const preferred = "normal";
    return presets.find((preset) => preset.id === preferred) ?? presets[0];
  }
  return presets.find((preset) => preset.id === "normal") ?? presets[0];
};

export const getBasemapProviderCapabilities = (): BasemapProviderCapability[] => providerCapabilities;

export const resolveBasemapSelection = (
  requestedProvider: BasemapProvider,
  requestedPreset: string,
  theme: BasemapTheme,
  colorTheme: UiColorTheme = "blue",
): BasemapSelectionResolved => {
  const capabilities = getBasemapProviderCapabilities();
  const requested = capabilities.find((entry) => entry.provider === requestedProvider) ?? capabilities[0];
  const provider = requested.available ? requested : capabilities[0];
  const fallbackReason = requested.available
    ? null
    : `${requested.label} unavailable (${requested.unavailableReason ?? "configuration missing"}). Switched to CARTO.`;

  const preset =
    provider.presets.find((entry) => entry.id === requestedPreset) ??
    pickDefaultPreset(provider.provider, provider.presets, theme);

  return {
    style: styleForPreset(provider.provider, preset.id, theme, colorTheme),
    attribution: provider.attribution,
    provider: provider.provider,
    providerLabel: provider.label,
    presetId: preset.id,
    presetLabel: preset.label,
    fallbackReason,
  };
};

export const defaultPresetIdForTheme = (provider: BasemapProvider, theme: BasemapTheme): string => {
  const providerConfig = providerCapabilities.find((entry) => entry.provider === provider);
  if (!providerConfig) return "normal";
  return pickDefaultPreset(provider, providerConfig.presets, theme).id;
};
