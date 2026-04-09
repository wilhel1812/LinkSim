import { terrainTileRank } from "./terrainTileRank";
import type { SrtmTile } from "../types/radio";

export const mergeSrtmTiles = (existing: SrtmTile[], incoming: SrtmTile[]): SrtmTile[] => {
  const dedup = new Map<string, SrtmTile>();
  for (const tile of existing) dedup.set(tile.key, tile);
  for (const tile of incoming) {
    const previous = dedup.get(tile.key);
    if (!previous) {
      dedup.set(tile.key, tile);
      continue;
    }
    const incomingRank = terrainTileRank(tile);
    const previousRank = terrainTileRank(previous);
    if (incomingRank >= previousRank) {
      dedup.set(tile.key, tile);
    }
  }
  return Array.from(dedup.values());
};
