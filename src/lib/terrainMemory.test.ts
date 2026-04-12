import { describe, expect, it } from "vitest";
import type { SrtmTile } from "../types/radio";
import {
  COPERNICUS_30_TILE_DECODED_BYTES,
  COPERNICUS_90_TILE_DECODED_BYTES,
  estimateTerrainMemoryDiagnostics,
  estimateTransientDecodeBytes,
} from "./terrainMemory";

const makeTile = (
  key: string,
  sourceId: SrtmTile["sourceId"],
  sourceKind: SrtmTile["sourceKind"],
  size: number,
): SrtmTile => ({
  key,
  latStart: 60,
  lonStart: 10,
  size,
  width: size,
  height: size,
  arcSecondSpacing: sourceId === "copernicus30" ? 1 : 3,
  elevations: new Int16Array(size * size),
  sourceId,
  sourceKind,
  sourceLabel: "test",
});

describe("terrainMemory", () => {
  it("estimates retained decoded bytes by dataset", () => {
    const tiles: SrtmTile[] = [
      makeTile("N60E010", "copernicus30", "auto-fetch", 3601),
      makeTile("N60E011", "copernicus90", "auto-fetch", 1201),
      makeTile("N60E012", "manual", "manual-upload", 1201),
      makeTile("N60E013", "other", "auto-fetch", 1201),
    ];

    const diagnostics = estimateTerrainMemoryDiagnostics(tiles);

    expect(diagnostics.tileCountsByDataset).toEqual({
      copernicus30: 1,
      copernicus90: 1,
      manual: 1,
      other: 1,
    });
    expect(diagnostics.retainedBytesByDataset.copernicus30).toBe(COPERNICUS_30_TILE_DECODED_BYTES);
    expect(diagnostics.retainedBytesByDataset.copernicus90).toBe(COPERNICUS_90_TILE_DECODED_BYTES);
    expect(diagnostics.retainedBytesByDataset.manual).toBe(COPERNICUS_90_TILE_DECODED_BYTES);
    expect(diagnostics.retainedBytesByDataset.other).toBe(COPERNICUS_90_TILE_DECODED_BYTES);
    expect(diagnostics.retainedBytesTotal).toBe(
      COPERNICUS_30_TILE_DECODED_BYTES + COPERNICUS_90_TILE_DECODED_BYTES * 3,
    );
  });

  it("estimates transient decode bytes from in-flight tile counts", () => {
    expect(estimateTransientDecodeBytes({ copernicus30: 2, copernicus90: 3 })).toBe(
      COPERNICUS_30_TILE_DECODED_BYTES * 2 + COPERNICUS_90_TILE_DECODED_BYTES * 3,
    );
  });
});
