import { describe, expect, it } from "vitest";
import {
  boundedUniqueTerrainTileKeys,
  longitudeBoundsForCoordinates,
  tilesForBounds,
} from "./terrainTiles";

describe("terrain tile workload bounds", () => {
  it("enumerates the short side of an antimeridian-crossing area", () => {
    expect(tilesForBounds(10.1, 10.2, 179.8, -179.8)).toEqual(["N10E179", "N10W180"]);
  });

  it("returns explicit wrapped longitude bounds for antimeridian coordinates", () => {
    const bounds = longitudeBoundsForCoordinates([179.9, -179.9], 0.1);

    expect(bounds.minLon).toBeGreaterThan(bounds.maxLon);
    expect(bounds.centerLon).toBe(-180);
    expect(bounds.spanDeg).toBeCloseTo(0.4);
  });

  it("rejects more than 256 unique tiles while enumerating", () => {
    expect(() => tilesForBounds(-80, 80, 0, 2)).toThrow("256 tiles");
  });

  it("accepts exactly 256 tiles and rejects the 257th", () => {
    expect(tilesForBounds(0, 15, 0, 15)).toHaveLength(256);
    expect(() => tilesForBounds(0, 15, 0, 16)).toThrow("256 tiles");
  });

  it("does not reinterpret an ordinary wide rectangle as its complement", () => {
    expect(() => tilesForBounds(10.1, 10.2, -179.8, 179.8)).toThrow("256 tiles");
  });

  it("rejects non-finite bounds", () => {
    expect(() => tilesForBounds(0, Number.POSITIVE_INFINITY, 0, 1)).toThrow("finite");
  });

  it("deduplicates valid tile keys and rejects excess or invalid keys", () => {
    expect(boundedUniqueTerrainTileKeys(["N10E010", "N10E010", "S01W001"])).toEqual([
      "N10E010",
      "S01W001",
    ]);
    for (const invalid of ["bad", "N99E999", "N90E000", "N00E180", "S00E000", "N00W000"]) {
      expect(() => boundedUniqueTerrainTileKeys([invalid])).toThrow("Invalid terrain tile key");
    }
    expect(boundedUniqueTerrainTileKeys(["S90W180", "N89E179"])).toEqual([
      "S90W180",
      "N89E179",
    ]);
    expect(() =>
      boundedUniqueTerrainTileKeys(
        Array.from({ length: 257 }, (_, index) =>
          `${index < 180 ? "N00" : "N01"}E${String(index % 180).padStart(3, "0")}`,
        ),
      ),
    ).toThrow("256 tiles");
  });
});
