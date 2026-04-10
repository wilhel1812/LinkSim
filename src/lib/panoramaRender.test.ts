import { describe, expect, it } from "vitest";
import { buildDepthBands, buildNearBiasedDepthFractions, depthStyleForBand, resolveRenderedEndpoint } from "./panoramaRender";
import type { PanoramaRay } from "./panorama";

const mkRay = (azimuthDeg: number, samples: number[]): PanoramaRay => ({
  azimuthDeg,
  maxDistanceKm: 10,
  horizonDistanceKm: 10,
  horizonLat: 0,
  horizonLon: 0,
  horizonTerrainM: 100,
  horizonAngleDeg: samples[samples.length - 1] ?? -5,
  clutterHorizonDistanceKm: 10,
  clutterHorizonAngleDeg: samples[samples.length - 1] ?? -5,
  samples: samples.map((angleDeg, index) => ({
    distanceKm: index + 1,
    lat: 0,
    lon: 0,
    terrainM: 100 + index,
    angleDeg,
    clutterAngleDeg: angleDeg,
    maxAngleBeforeDeg: -90,
  })),
});

describe("panoramaRender", () => {
  it("clips farther depth line where foreground angle is higher and reappears later", () => {
    const rays: PanoramaRay[] = [
      mkRay(0, [2, 1]), // near > far
      mkRay(30, [3, 2]), // near > far
      mkRay(60, [1, 4]), // far > near -> visible again
      mkRay(90, [1, 5]), // far > near -> visible again
    ];
    const bands = buildDepthBands(
      rays,
      [0, 1],
      (ray, sample) => ({
        x: ray.azimuthDeg,
        y: sample?.angleDeg ?? 0,
        angleDeg: sample?.angleDeg ?? Number.NEGATIVE_INFINITY,
      }),
      { ridgeSnap: { enabled: false } },
    );

    expect(bands).toHaveLength(2);
    expect(bands[1].lineSegments).toHaveLength(1);
    expect(bands[1].lineSegments[0]).toContain("M60.00,4.00 L90.00,5.00");
  });

  it("snaps each depth band to local ridge candidates while preserving distance order", () => {
    const ray = mkRay(0, [0, 1.2, 0.4, 3.1, 2.8, 4.5, 4.2, 5.4, 5.1]);
    const bands = buildDepthBands(
      [ray],
      [0.2, 0.5, 0.8],
      (_ray, sample) => ({
        x: sample?.distanceKm ?? 0,
        y: sample?.angleDeg ?? 0,
        angleDeg: sample?.angleDeg ?? Number.NEGATIVE_INFINITY,
      }),
      { ridgeSnap: { enabled: true, windowRatio: 0.2 } },
    );

    expect(bands).toHaveLength(3);
    const pickedDistances = bands.map((band) => band.points[0]?.sample?.distanceKm ?? 0);
    expect(pickedDistances[1]).toBeGreaterThanOrEqual(pickedDistances[0]);
    expect(pickedDistances[2]).toBeGreaterThanOrEqual(pickedDistances[1]);
    expect(pickedDistances[2]).toBeGreaterThan(0);
  });

  it("returns monotonic near-to-far depth style falloff", () => {
    const near = depthStyleForBand(0, 5);
    const far = depthStyleForBand(4, 5);
    expect(near.strokeWidth).toBeGreaterThan(far.strokeWidth);
    expect(near.strokeOpacity).toBeGreaterThan(far.strokeOpacity);
    expect(near.strokeMixTerrainPct).toBeGreaterThan(far.strokeMixTerrainPct);
    expect(near.strokeMixMutedPct).toBeLessThan(far.strokeMixMutedPct);
  });

  it("builds ten near-biased fractions ending at horizon depth", () => {
    const fractions = buildNearBiasedDepthFractions(10);
    expect(fractions).toHaveLength(10);
    expect(fractions[0]).toBeLessThan(0.1);
    expect(fractions[fractions.length - 1]).toBe(1);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
  });

  it("resolves rendered endpoint from hovered node/sample before fallback ray", () => {
    const ray = mkRay(120, [3, 5, 8]);
    ray.horizonLat = 10;
    ray.horizonLon = 20;
    ray.horizonDistanceKm = 9;
    const fromNode = resolveRenderedEndpoint({
      hoveredNode: { lat: 1, lon: 2, azimuthDeg: 40, distanceKm: 3 },
      hoveredSample: ray.samples[0],
      hoveredAzimuthDeg: 120,
      fallbackRay: ray,
    });
    expect(fromNode?.endpoint).toEqual({ lat: 1, lon: 2 });
    expect(fromNode?.azimuthDeg).toBe(40);

    const fromSample = resolveRenderedEndpoint({
      hoveredSample: { ...ray.samples[1], lat: 3, lon: 4, distanceKm: 7 },
      hoveredAzimuthDeg: 200,
      fallbackRay: ray,
    });
    expect(fromSample?.endpoint).toEqual({ lat: 3, lon: 4 });
    expect(fromSample?.distanceKm).toBe(7);

    const fromFallback = resolveRenderedEndpoint({ fallbackRay: ray });
    expect(fromFallback?.endpoint).toEqual({ lat: 10, lon: 20 });
    expect(fromFallback?.distanceKm).toBe(9);
  });
});
