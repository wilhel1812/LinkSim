import type { SrtmTile } from "../types/radio";

export const COPERNICUS_30_TILE_DECODED_BYTES = 3601 * 3601 * 2;

export type TerrainMemoryDiagnostics = {
  retainedBytesTotal: number;
  retainedBytesByDataset: {
    copernicus30: number;
    other: number;
  };
  tileCountsByDataset: {
    copernicus30: number;
    other: number;
  };
};

const datasetBucketForTile = (tile: SrtmTile): keyof TerrainMemoryDiagnostics["retainedBytesByDataset"] => {
  if (tile.sourceId === "copernicus30") return "copernicus30";
  return "other";
};

const tileDecodedBytes = (tile: SrtmTile): number => {
  const width = Math.max(1, tile.width ?? tile.size);
  const height = Math.max(1, tile.height ?? tile.size);
  return width * height * 2;
};

export const estimateTerrainMemoryDiagnostics = (tiles: ReadonlyArray<SrtmTile>): TerrainMemoryDiagnostics => {
  const diagnostics: TerrainMemoryDiagnostics = {
    retainedBytesTotal: 0,
    retainedBytesByDataset: {
      copernicus30: 0,
      other: 0,
    },
    tileCountsByDataset: {
      copernicus30: 0,
      other: 0,
    },
  };

  for (const tile of tiles) {
    const bucket = datasetBucketForTile(tile);
    const bytes = tileDecodedBytes(tile);
    diagnostics.retainedBytesTotal += bytes;
    diagnostics.retainedBytesByDataset[bucket] += bytes;
    diagnostics.tileCountsByDataset[bucket] += 1;
  }

  return diagnostics;
};

export const estimateTransientDecodeBytes = (tileCount: number): number =>
  tileCount * COPERNICUS_30_TILE_DECODED_BYTES;
