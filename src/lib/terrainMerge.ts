import type { SrtmTile } from "../types/radio";

export const mergeSrtmTiles = (existing: SrtmTile[], incoming: SrtmTile[]): SrtmTile[] => {
  const dedup = new Map<string, SrtmTile>();
  for (const tile of existing) dedup.set(tile.key, tile);
  for (const tile of incoming) dedup.set(tile.key, tile);
  return Array.from(dedup.values());
};
