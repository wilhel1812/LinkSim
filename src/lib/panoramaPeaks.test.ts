import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_PEAK_MAP_STATS, loadPanoramaPeaks, queryPanoramaPeaks } from "./panoramaPeaks";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("loadPanoramaPeaks", () => {
  it("dedupes concurrent tile fetches and returns candidates", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { "content-type": "application/json" } }));

    const params = {
      origin: { lat: 61.6601, lon: 8.2998 },
      centerDeg: 180,
      startDeg: 90,
      endDeg: 270,
      maxDistanceKm: 4,
      limit: 100,
    } as const;

    const [a, b] = await Promise.all([loadPanoramaPeaks(params), loadPanoramaPeaks(params)]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalled();
    // Multiple tile keys are expected, but concurrent queries should share the same in-flight tile requests.
    expect(fetchMock.mock.calls.length).toBeLessThan(12);
  });

  it("falls back to local index when tile loading fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const peaks = await loadPanoramaPeaks({
      origin: { lat: 61.64, lon: 8.31 },
      centerDeg: 180,
      startDeg: -180,
      endDeg: 180,
      maxDistanceKm: 80,
      limit: 200,
    });
    expect(peaks.length).toBeGreaterThan(0);
  });
});
