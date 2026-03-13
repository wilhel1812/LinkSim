export type TerrainDataset = "copernicus30" | "copernicus90" | "legacySrtmThird";

export const TERRAIN_DATASET_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30 (30m)",
  copernicus90: "Copernicus GLO-90 (90m)",
  legacySrtmThird: "Legacy SRTM 3 arc-second (ve2dbe)",
};

export const TERRAIN_DATASET_FETCH_LABEL: Record<TerrainDataset, string> = {
  copernicus30: "Copernicus GLO-30",
  copernicus90: "Copernicus GLO-90",
  legacySrtmThird: "Legacy SRTM 3 arc-second (ve2dbe)",
};

export const normalizeTerrainDataset = (value: unknown): TerrainDataset => {
  if (value === "copernicus30" || value === "copernicus90" || value === "legacySrtmThird") return value;
  // Backward compatibility for older snapshots/storage values.
  if (value === "srtm1") return "copernicus30";
  if (value === "srtm3") return "copernicus90";
  if (value === "srtmthird") return "legacySrtmThird";
  return "copernicus30";
};
