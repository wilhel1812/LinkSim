import { describe, expect, it } from "vitest";
import { composePanoramaWindow } from "./panoramaCompose";
import type { PanoramaResult, PanoramaRay } from "./panorama";

const mkRay = (azimuthDeg: number): PanoramaRay => ({
  azimuthDeg,
  maxDistanceKm: 10,
  horizonDistanceKm: 8,
  horizonLat: 0,
  horizonLon: 0,
  horizonTerrainM: 100,
  horizonAngleDeg: 2,
  clutterHorizonDistanceKm: 8,
  clutterHorizonAngleDeg: 2,
  samples: [
    {
      distanceKm: 1,
      lat: 0,
      lon: 0,
      terrainM: 100,
      angleDeg: 1,
      clutterAngleDeg: 1,
      maxAngleBeforeDeg: -90,
    },
  ],
});

const mkPanorama = (azimuths: number[]): PanoramaResult => ({
  rays: azimuths.map((az) => mkRay(az)),
  nodes: [],
  minAngleDeg: -2,
  maxAngleDeg: 3,
  radiusPolicyKm: 50,
  coverageCenterDeg: 180,
  coverageSpanDeg: 360,
});

describe("composePanoramaWindow", () => {
  it("stitches base edges with detail center coverage", () => {
    const base = mkPanorama([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
    const detail = mkPanorama([120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240]);
    const result = composePanoramaWindow({
      basePanorama: base,
      detailPanoramas: [detail],
      centerDeg: 180,
      startDeg: 60,
      endDeg: 300,
    });

    expect(result.rays.length).toBeGreaterThan(0);
    expect(result.segments.some((segment) => segment.source === "detail")).toBe(true);
    const first = result.rays[0];
    const last = result.rays[result.rays.length - 1];
    expect(first.source).toBe("base");
    expect(last.source).toBe("base");
    expect(result.rays.some((entry) => entry.source === "detail")).toBe(true);
  });

  it("covers full window with base when no detail is available", () => {
    const base = mkPanorama([0, 90, 180, 270]);
    const result = composePanoramaWindow({
      basePanorama: base,
      detailPanoramas: [],
      centerDeg: 180,
      startDeg: 0,
      endDeg: 360,
    });
    expect(result.segments).toEqual([{ source: "base", startDeg: 0, endDeg: 360 }]);
    expect(result.rays.every((entry) => entry.source === "base")).toBe(true);
  });

  it("produces contiguous segment coverage when base is present", () => {
    const base = mkPanorama([0, 60, 120, 180, 240, 300]);
    const detail = mkPanorama([140, 160, 180, 200, 220]);
    const result = composePanoramaWindow({
      basePanorama: base,
      detailPanoramas: [detail],
      centerDeg: 180,
      startDeg: 60,
      endDeg: 300,
    });
    const first = result.segments[0];
    const last = result.segments[result.segments.length - 1];
    expect(first?.startDeg).toBeCloseTo(60);
    expect(last?.endDeg).toBeCloseTo(300);
    for (let i = 1; i < result.segments.length; i += 1) {
      expect(result.segments[i - 1].endDeg).toBeCloseTo(result.segments[i].startDeg);
    }
  });

  it("keeps detail coverage when multiple detail windows are present", () => {
    const base = mkPanorama([60, 90, 120, 150, 180, 210, 240, 270, 300]);
    const detailA = mkPanorama([120, 130, 140, 150, 160]);
    const detailB = mkPanorama([180, 190, 200, 210, 220, 230, 240]);
    const result = composePanoramaWindow({
      basePanorama: base,
      detailPanoramas: [detailA, detailB],
      centerDeg: 180,
      startDeg: 90,
      endDeg: 270,
    });
    expect(result.rays.some((entry) => entry.source === "detail")).toBe(true);
    expect(result.rays[0]?.xValue).toBeGreaterThanOrEqual(90);
    expect(result.rays[result.rays.length - 1]?.xValue).toBeLessThanOrEqual(270);
  });
});
