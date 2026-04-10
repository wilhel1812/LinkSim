import { describe, expect, it } from "vitest";
import { queryPanoramaPeaks } from "./panoramaPeaks";

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
    expect(peaks.some((peak) => peak.name === "Galdhopiggen")).toBe(true);
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

