export type TerrainDataset = "copernicus30" | "copernicus90";

export const TERRAIN_DATASET_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30 (30m)",
  copernicus90: "Copernicus GLO-90 (90m)",
};

export const TERRAIN_DATASET_FETCH_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30",
  copernicus90: "Copernicus GLO-90",
};

export const normalizeTerrainDataset = (value: unknown): TerrainDataset => {
  if (value === "copernicus30" || value === "copernicus90") return value;
  // Backward compatibility for older snapshots/storage values.
  if (value === "srtm1") return "copernicus30";
  if (value === "srtm3") return "copernicus90";
  if (value === "srtmthird" || value === "legacySrtmThird") return "copernicus90";
  return "copernicus30";
};
