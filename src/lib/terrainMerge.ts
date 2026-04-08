import type { SrtmTile } from "../types/radio";

const tileQualityRank = (tile: SrtmTile): number => {
  if (tile.sourceKind === "manual-upload") return 4;
  if (tile.sourceId === "copernicus30") return 3;
  if (tile.sourceId === "copernicus90") return 2;
  return 1;
};

export const mergeSrtmTiles = (existing: SrtmTile[], incoming: SrtmTile[]): SrtmTile[] => {
  const dedup = new Map<string, SrtmTile>();
  for (const tile of existing) dedup.set(tile.key, tile);
  for (const tile of incoming) {
    const previous = dedup.get(tile.key);
    if (!previous) {
      dedup.set(tile.key, tile);
      continue;
    }
    const incomingRank = tileQualityRank(tile);
    const previousRank = tileQualityRank(previous);
    if (incomingRank >= previousRank) {
      dedup.set(tile.key, tile);
    }
  }
  return Array.from(dedup.values());
};
