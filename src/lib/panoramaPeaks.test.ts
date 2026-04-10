import { describe, expect, it } from "vitest";
import { OPEN_PEAK_MAP_STATS, queryPanoramaPeaks } from "./panoramaPeaks";

describe("open peak index", () => {
  it("loads a full local summit dataset", () => {
    expect(OPEN_PEAK_MAP_STATS.features).toBeGreaterThan(2000);
    expect(OPEN_PEAK_MAP_STATS.buckets).toBeGreaterThan(500);
  });
});

describe("queryPanoramaPeaks", () => {
  it("returns nearby peaks inside window and distance limit", () => {
    const peaks = queryPanoramaPeaks({
      origin: { lat: 61.64, lon: 8.31 },
      centerDeg: 180,
      startDeg: -180,
      endDeg: 180,
      maxDistanceKm: 80,
    });
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks[0]?.distanceKm ?? 0).toBeLessThan(30);
  });

  it("filters peaks outside azimuth window", () => {
    const peaks = queryPanoramaPeaks({
      origin: { lat: 61.64, lon: 8.31 },
      centerDeg: 90,
      startDeg: 45,
      endDeg: 135,
      maxDistanceKm: 120,
    });
    expect(peaks.every((peak) => peak.azimuthDeg >= 45 && peak.azimuthDeg <= 135)).toBe(true);
  });
});
