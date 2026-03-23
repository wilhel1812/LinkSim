import { describe, expect, it } from "vitest";
import type { SrtmTile } from "../types/radio";
import { mergeSrtmTiles } from "./terrainMerge";

const makeTile = (key: string, lat: number, lon: number): SrtmTile => ({
  key,
  latStart: lat,
  lonStart: lon,
  size: 3601,
  width: 3601,
  height: 3601,
  arcSecondSpacing: 1,
  elevations: new Int16Array(3601 * 3601),
  sourceKind: "auto-fetch",
  sourceId: "copernicus30",
  sourceLabel: "Copernicus GLO-30",
  sourceDetail: "test",
});

describe("mergeSrtmTiles", () => {
  it("returns empty array when both inputs are empty", () => {
    expect(mergeSrtmTiles([], [])).toEqual([]);
  });

  it("returns existing tiles when new tiles array is empty", () => {
    const existing = [makeTile("N60E009", 60, 9)];
    expect(mergeSrtmTiles(existing, [])).toEqual(existing);
  });

  it("returns new tiles when existing tiles array is empty", () => {
    const incoming = [makeTile("N60E009", 60, 9)];
    expect(mergeSrtmTiles([], incoming)).toEqual(incoming);
  });

  it("merges both arrays without duplicates", () => {
    const existing = [makeTile("N60E009", 60, 9), makeTile("N60E010", 60, 10)];
    const incoming = [makeTile("N61E009", 61, 9), makeTile("N60E010", 60, 10)];
    const result = mergeSrtmTiles(existing, incoming);
    expect(result.map((t) => t.key).sort()).toEqual(["N60E009", "N60E010", "N61E009"]);
  });

  it("incoming tile overwrites existing tile with same key", () => {
    const existing = [makeTile("N60E009", 60, 9)];
    const incoming = [{ ...makeTile("N60E009", 99, 99) }];
    const result = mergeSrtmTiles(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].latStart).toBe(99);
  });

  it("preserves order: existing tiles first, then new-only tiles", () => {
    const existing = [makeTile("N60E009", 60, 9), makeTile("N61E009", 61, 9)];
    const incoming = [makeTile("N60E010", 60, 10)];
    const result = mergeSrtmTiles(existing, incoming);
    expect(result.map((t) => t.key)).toEqual(["N60E009", "N61E009", "N60E010"]);
  });

  it("incoming overwrites existing (not vice versa) for same key", () => {
    const existing = [makeTile("N60E009", 60, 9)];
    const incoming = [makeTile("N60E009", 99, 99)];
    const result = mergeSrtmTiles(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].latStart).toBe(99);
  });
});
