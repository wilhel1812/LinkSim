export type TerrainDataset = "copernicus30";

export const TERRAIN_DATASET_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30 (30m)",
};

export const TERRAIN_DATASET_FETCH_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30",
};

export const normalizeTerrainDataset = (_value: unknown): TerrainDataset => {
  // All legacy dataset values now normalize to the sole supported GLO-30 source.
  return "copernicus30";
};
