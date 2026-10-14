import { describe, expect, it } from "vitest";
import type { SrtmTile } from "../types/radio";
import { isSrtmAreaComplete, sampleSrtmElevation } from "./srtm";

const makeTile = (params: {
  key: string;
  latStart: number;
  lonStart: number;
  values: number[];
  size?: number;
  sourceId?: string;
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
    expect(sampleSrtmElevation([low, high], 59.7, 10.7)).toBe(30);
  });

  it("samples correctly on tile boundary coordinates", () => {
    const southWest = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [5910, 5910, 5910, 5910],
      sourceId: "copernicus90",
      arcSecondSpacing: 3,
    });
    const northWest = makeTile({
      key: "N60E010",
      latStart: 60,
      lonStart: 10,
      size: 2,
      values: [6010, 6010, 6010, 6010],
      sourceId: "copernicus30",
      arcSecondSpacing: 1,
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

  it("normalizes unwrapped longitudes when sampling antimeridian terrain", () => {
    const tile = makeTile({
      key: "N10W180",
      latStart: 10,
      lonStart: -180,
      size: 2,
      values: [5, 5, 5, 5],
    });

    expect(sampleSrtmElevation([tile], 10.5, 180.1)).toBe(5);
  });

  it("samples a saved +180 coordinate from an E179-only tile", () => {
    const east = makeTile({
      key: "N10E179",
      latStart: 10,
      lonStart: 179,
      size: 2,
      values: [1, 7, 1, 7],
      sourceId: "copernicus30",
    });

    expect(sampleSrtmElevation([east], 10.5, 180)).toBe(7);
  });

  it("samples a saved -180 coordinate from a W180-only tile", () => {
    const west = makeTile({
      key: "N10W180",
      latStart: 10,
      lonStart: -180,
      size: 2,
      values: [8, 1, 8, 1],
      sourceId: "copernicus30",
    });

    expect(sampleSrtmElevation([west], 10.5, -180)).toBe(8);
  });

  it("deterministically applies terrain precedence when both dateline tiles are present", () => {
    const east = makeTile({
      key: "N10E179",
      latStart: 10,
      lonStart: 179,
      size: 2,
      values: [1, 7, 1, 7],
      sourceId: "copernicus90",
      arcSecondSpacing: 3,
    });
    const west = makeTile({
      key: "N10W180",
      latStart: 10,
      lonStart: -180,
      size: 2,
      values: [8, 1, 8, 1],
      sourceId: "copernicus30",
      arcSecondSpacing: 1,
    });

    expect(sampleSrtmElevation([east, west], 10.5, 180)).toBe(8);
    expect(sampleSrtmElevation([west, east], 10.5, -180)).toBe(8);
  });
});

describe('terrain completeness certificate', () => {
  it('certifies only available cells in the requested rectangle, including known ocean', () => {
    const tile = makeTile({key:'N59E010',latStart:59,lonStart:10,size:5,values:Array(25).fill(0)});
    tile.elevations[0] = -32768;
    expect(isSrtmAreaComplete([tile], {minLat:59.2,maxLat:59.6,minLon:10.2,maxLon:10.6})).toBe(true);
    expect(isSrtmAreaComplete([tile], {minLat:59,maxLat:59.99,minLon:10,maxLon:10.99})).toBe(false);
    expect(isSrtmAreaComplete([], {minLat:59.2,maxLat:59.6,minLon:10.2,maxLon:10.6})).toBe(false);
  });
  it('uses preferred tiles and refuses missing tiles and dateline-spanning rectangles', () => {
    const low = makeTile({key:'N59E010',latStart:59,lonStart:10,size:3,values:Array(9).fill(0),sourceId:'copernicus90'});
    const high = makeTile({key:'N59E010',latStart:59,lonStart:10,size:3,values:Array(9).fill(-32768),sourceId:'copernicus30'});
    const bounds = {minLat:59.2,maxLat:59.6,minLon:10.2,maxLon:10.6};
    expect(isSrtmAreaComplete([low,high],bounds)).toBe(false);
    expect(isSrtmAreaComplete([low], {...bounds,maxLon:11.1})).toBe(false);
    expect(isSrtmAreaComplete([low], {...bounds,minLon:179.8,maxLon:180.2})).toBe(false);
  });
});


it("certifies cross-tile bounds conservatively and invalidates on terrain replacement", () => {
  const west = makeTile({ key: "N59E010", latStart: 59, lonStart: 10, size: 3, values: Array(9).fill(0) });
  const east = makeTile({ key: "N59E011", latStart: 59, lonStart: 11, size: 3, values: Array(9).fill(0) });
  const bounds = { minLat: 59.2, maxLat: 59.8, minLon: 10.8, maxLon: 11.2 };
  const tiles = [west, east];
  expect(isSrtmAreaComplete(tiles, bounds)).toBe(true);
  expect(isSrtmAreaComplete(tiles, bounds)).toBe(true);
  const replacement = { ...east, elevations: new Int16Array(9).fill(-32768) };
  expect(isSrtmAreaComplete([west, replacement], bounds)).toBe(false);
  // At an exact seam either tile can win by rank; reject a void on either edge.
  const voidWest = { ...west, elevations: new Int16Array([0, 0, -32768, 0, 0, -32768, 0, 0, -32768]) };
  expect(isSrtmAreaComplete([voidWest, east], { ...bounds, minLon: 11 })).toBe(false);
  expect(isSrtmAreaComplete([west], { ...bounds, minLon: Number.NaN })).toBe(false);
  expect(isSrtmAreaComplete([{ ...west, elevations: new Int16Array(1) }], { ...bounds, maxLon: 10.9 })).toBe(false);
});
