export type TerrainDataset = "copernicus30";

export const TERRAIN_DATASET_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30 (30m)",
};

export const TERRAIN_DATASET_FETCH_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30",
};

const COMPATIBLE_PERSISTED_TERRAIN_DATASETS = new Set([
  "copernicus30",
  "copernicus90",
  "srtm1",
  "srtm3",
  "srtmthird",
  "legacySrtmThird",
]);

export const isCompatiblePersistedTerrainDataset = (value: unknown): value is string =>
  typeof value === "string" && COMPATIBLE_PERSISTED_TERRAIN_DATASETS.has(value);

export const normalizeTerrainDataset = (_value: unknown): TerrainDataset => {
  void _value;
  // All legacy dataset values now normalize to the sole supported GLO-30 source.
  return "copernicus30";
};
