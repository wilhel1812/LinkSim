import type { SrtmTile } from "../types/radio";

export const terrainTileRank = (tile: SrtmTile): number => {
  if (tile.sourceKind === "manual-upload") return 4;
  if (tile.sourceId === "copernicus30") return 3;
  if (tile.sourceId === "copernicus90") return 2;
  return 1;
};

export const choosePreferredTerrainTile = (a: SrtmTile, b: SrtmTile): SrtmTile => {
  const aRank = terrainTileRank(a);
  const bRank = terrainTileRank(b);
  if (aRank !== bRank) return aRank > bRank ? a : b;

  const aSpacing = a.arcSecondSpacing ?? 3;
  const bSpacing = b.arcSecondSpacing ?? 3;
  if (aSpacing !== bSpacing) return aSpacing < bSpacing ? a : b;

  return b;
};
