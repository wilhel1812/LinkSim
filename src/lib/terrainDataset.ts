export type TerrainDataset = "copernicus30" | "copernicus90" | "legacySrtmThird";

export const normalizeTerrainDataset = (value: unknown): TerrainDataset => {
  if (value === "copernicus30" || value === "copernicus90" || value === "legacySrtmThird") return value;
  // Backward compatibility for older snapshots/storage values.
  if (value === "srtm1") return "copernicus30";
  if (value === "srtm3") return "copernicus90";
  if (value === "srtmthird") return "legacySrtmThird";
  return "copernicus30";
};

