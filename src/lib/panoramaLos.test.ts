import { describe, expect, it } from "vitest";
import { isPeakLosVisible, maxTerrainAngleBeforeDistance, nearestSampleForDistance, peakElevationAngleDeg } from "./panoramaLos";
import type { PanoramaRaySample } from "./panorama";

const mkSamples = (angles: number[]): PanoramaRaySample[] =>
  angles.map((angleDeg, index) => ({
    distanceKm: index + 1,
    lat: 60,
    lon: 10,
    terrainM: 100 + index,
    angleDeg,
    clutterAngleDeg: angleDeg,
    maxAngleBeforeDeg: index === 0 ? Number.NEGATIVE_INFINITY : Math.max(...angles.slice(0, index)),
  }));

describe("panoramaLos", () => {
  it("returns max terrain angle before a target distance", () => {
    const samples = mkSamples([-1.4, -0.8, 1.2, 0.4]);
    expect(maxTerrainAngleBeforeDistance(samples, 3)).toBeCloseTo(-0.8, 5);
    expect(maxTerrainAngleBeforeDistance(samples, 4)).toBeCloseTo(1.2, 5);
  });

  it("returns nearest sample for a distance", () => {
    const samples = mkSamples([-1, 0.2, 1.5, 0.8]);
    expect(nearestSampleForDistance(samples, 2.1)?.distanceKm).toBe(2);
    expect(nearestSampleForDistance(samples, 2.7)?.distanceKm).toBe(3);
  });

  it("computes peak elevation angle with curvature", () => {
    const noCurvature = peakElevationAngleDeg({ sourceAbsM: 500, peakElevationM: 1500, distanceKm: 10, kFactor: 10 });
    const withCurvature = peakElevationAngleDeg({ sourceAbsM: 500, peakElevationM: 1500, distanceKm: 10, kFactor: 1 });
    expect(withCurvature).toBeLessThan(noCurvature);
  });

  it("flags peaks as visible only when above terrain obstruction envelope", () => {
    const samples = mkSamples([-0.8, 0.6, 1.8, 1.2, 0.4]);
    const visible = isPeakLosVisible({
      samples,
      distanceKm: 5,
      peakElevationM: 2200,
      sourceAbsM: 400,
      kFactor: 1,
    });
    const blocked = isPeakLosVisible({
      samples,
      distanceKm: 5,
      peakElevationM: 450,
      sourceAbsM: 400,
      kFactor: 1,
    });
    expect(visible).toBe(true);
    expect(blocked).toBe(false);
  });
});
