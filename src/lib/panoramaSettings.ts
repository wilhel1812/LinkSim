export const PANORAMA_SETTINGS_STORAGE_KEY = "linksim-panorama-settings-v1";

export type PanoramaSettings = {
  exaggeration: number;
  showLabels: boolean;
  terrainDistanceHeatmap: boolean;
};

export const DEFAULT_PANORAMA_SETTINGS: PanoramaSettings = {
  exaggeration: 4,
  showLabels: true,
  terrainDistanceHeatmap: false,
};

const clampExaggeration = (value: number): number => Math.max(1, Math.min(20, value));

const normalizePanoramaSettings = (value: unknown): PanoramaSettings => {
  const parsed = typeof value === "object" && value !== null ? value as Partial<PanoramaSettings> : {};
  return {
    exaggeration: typeof parsed.exaggeration === "number" && Number.isFinite(parsed.exaggeration)
      ? clampExaggeration(parsed.exaggeration)
      : DEFAULT_PANORAMA_SETTINGS.exaggeration,
    showLabels: typeof parsed.showLabels === "boolean"
      ? parsed.showLabels
      : DEFAULT_PANORAMA_SETTINGS.showLabels,
    terrainDistanceHeatmap: typeof parsed.terrainDistanceHeatmap === "boolean"
      ? parsed.terrainDistanceHeatmap
      : DEFAULT_PANORAMA_SETTINGS.terrainDistanceHeatmap,
  };
};

export const readPanoramaSettings = (): PanoramaSettings => {
  try {
    const raw = localStorage.getItem(PANORAMA_SETTINGS_STORAGE_KEY);
    return raw === null ? DEFAULT_PANORAMA_SETTINGS : normalizePanoramaSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_PANORAMA_SETTINGS;
  }
};

export const persistPanoramaSettings = (settings: PanoramaSettings): void => {
  try {
    localStorage.setItem(PANORAMA_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePanoramaSettings(settings)));
  } catch {
    // Best effort only.
  }
};
