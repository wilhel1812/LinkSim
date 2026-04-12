import { describe, expect, it } from "vitest";
import type { SrtmTile } from "../types/radio";
import { sampleSrtmElevation } from "./srtm";

const makeTile = (params: {
  key: string;
  latStart: number;
  lonStart: number;
  values: number[];
  size?: number;
  sourceId?: string;
  sourceKind?: SrtmTile["sourceKind"];
  arcSecondSpacing?: 1 | 3;
}): SrtmTile => {
  const size = params.size ?? Math.round(Math.sqrt(params.values.length));
  return {
    key: params.key,
    latStart: params.latStart,
    lonStart: params.lonStart,
    size,
    width: size,
    height: size,
    arcSecondSpacing: params.arcSecondSpacing ?? 3,
    elevations: new Int16Array(params.values),
    sourceId: params.sourceId,
    sourceKind: params.sourceKind,
  };
};

describe("sampleSrtmElevation", () => {
  it("samples expected nearest grid cell values", () => {
    const tile = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 3,
      values: [
        11, 12, 13,
        21, 22, 23,
        31, 32, 33,
      ],
      sourceId: "copernicus30",
    });

    expect(sampleSrtmElevation([tile], 59.95, 10.05)).toBe(11);
    expect(sampleSrtmElevation([tile], 59.5, 10.5)).toBe(22);
    expect(sampleSrtmElevation([tile], 59.05, 10.95)).toBe(33);
  });

  it("uses quality precedence when duplicate tile keys exist", () => {
    const low = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [90, 90, 90, 90],
      sourceId: "copernicus90",
      arcSecondSpacing: 3,
    });
    const high = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [30, 30, 30, 30],
      sourceId: "copernicus30",
      arcSecondSpacing: 1,
    });
    const manual = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [7, 7, 7, 7],
      sourceKind: "manual-upload",
      sourceId: "uploaded",
      arcSecondSpacing: 1,
    });

    expect(sampleSrtmElevation([low, high], 59.7, 10.7)).toBe(30);
    expect(sampleSrtmElevation([high, manual], 59.7, 10.7)).toBe(7);
  });

  it("samples correctly on tile boundary coordinates", () => {
    const southWest = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [5910, 5910, 5910, 5910],
      sourceId: "copernicus30",
    });
    const northWest = makeTile({
      key: "N60E010",
      latStart: 60,
      lonStart: 10,
      size: 2,
      values: [6010, 6010, 6010, 6010],
      sourceId: "uploaded",
      sourceKind: "manual-upload",
    });

    expect(sampleSrtmElevation([southWest, northWest], 60, 10.4)).toBe(6010);
  });

  it("returns null for nodata samples", () => {
    const tile = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [-32768, -32768, -32768, -32768],
      sourceId: "copernicus30",
    });
    expect(sampleSrtmElevation([tile], 59.4, 10.4)).toBeNull();
  });
});
