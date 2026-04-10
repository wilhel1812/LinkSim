import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPanoramaPeakManifestCacheForTests, loadPanoramaPeaks } from "./panoramaPeaks";

const mockManifest = {
  version: "v-test",
  generatedAt: "2026-04-10T00:00:00Z",
  tileDeg: 1,
  tileUrlTemplate: "/peak-tiles/v1/tiles/{tileKey}.json",
  ttlSeconds: 3600,
  source: {
    provider: "osm",
    includeNatural: ["peak", "volcano"],
    namedOnly: true,
  },
  benchmark: {
    norwayNamedCount: 1200,
    minimumRequired: 1000,
    pass: true,
  },
} as const;

describe("loadPanoramaPeaks", () => {
  beforeEach(() => {
    clearPanoramaPeakManifestCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPanoramaPeakManifestCacheForTests();
  });

  it("loads candidates from manifest + tiles and keeps peak/volcano kinds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/peak-tiles/v1/manifest.json")) {
        return new Response(JSON.stringify(mockManifest), { status: 200 });
      }
      if (url.includes("tiles/la_p60_lo_p10.json")) {
        return new Response(
          JSON.stringify({
            tileKey: "la_p60_lo_p10",
            version: "v-test",
            entries: [
              { id: "p1", kind: "peak", name: "Peak One", lat: 60.2, lon: 10.2, elevationM: 1400 },
              { id: "v1", kind: "volcano", name: "Volcano One", lat: 60.3, lon: 10.25, elevationM: 1800 },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ tileId: "x", version: "v-test", entries: [] }), { status: 200 });
    });

    const peaks = await loadPanoramaPeaks({
      origin: { lat: 60.15, lon: 10.15 },
      centerDeg: 180,
      startDeg: -180,
      endDeg: 180,
      maxDistanceKm: 50,
      limit: 50,
    });

    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(peaks.some((entry) => entry.kind === "peak")).toBe(true);
    expect(peaks.some((entry) => entry.kind === "volcano")).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("dedupes concurrent requests and supports no-network mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/peak-tiles/v1/manifest.json")) {
        return new Response(JSON.stringify(mockManifest), { status: 200 });
      }
      if (url.includes("tiles/la_p60_lo_p10.json")) {
        return new Response(
          JSON.stringify({
            tileKey: "la_p60_lo_p10",
            version: "v-test",
            entries: [{ id: "p1", kind: "peak", name: "Peak One", lat: 60.2, lon: 10.2, elevationM: 1400 }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ tileId: "x", version: "v-test", entries: [] }), { status: 200 });
    });

    const params = {
      origin: { lat: 60.15, lon: 10.15 },
      centerDeg: 180,
      startDeg: -180,
      endDeg: 180,
      maxDistanceKm: 50,
      limit: 50,
    } as const;

    const [a, b] = await Promise.all([loadPanoramaPeaks(params), loadPanoramaPeaks(params)]);
    expect(a).toEqual(b);

    const beforeNoNetworkCalls = fetchMock.mock.calls.length;
    const noNetwork = await loadPanoramaPeaks({ ...params, allowNetwork: false });
    expect(noNetwork.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBe(beforeNoNetworkCalls);
  });

  it("returns empty when manifest fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("fail", { status: 500 }));
    await expect(
      loadPanoramaPeaks({
        origin: { lat: 60.15, lon: 10.15 },
        centerDeg: 180,
        startDeg: -180,
        endDeg: 180,
        maxDistanceKm: 50,
        limit: 50,
      }),
    ).rejects.toThrow(/manifest/i);
  });

  it("never requests reserved tile-id paths with colon encoding", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/peak-tiles/v1/manifest.json")) {
        return new Response(JSON.stringify(mockManifest), { status: 200 });
      }
      return new Response(JSON.stringify({ tileKey: "none", version: "v-test", entries: [] }), { status: 200 });
    });

    await loadPanoramaPeaks({
      origin: { lat: 60.15, lon: 10.15 },
      centerDeg: 180,
      startDeg: -180,
      endDeg: 180,
      maxDistanceKm: 50,
      limit: 50,
    });

    expect(seen.some((url) => url.includes("%3A"))).toBe(false);
    expect(seen.some((url) => /tiles\/la_[pm]\d+_lo_[pm]\d+\.json/.test(url))).toBe(true);
  });
});
