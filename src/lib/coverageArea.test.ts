import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoverageAreaAsync, buildSourcePassFailOverlayPixelsAsync, latitudeForRasterRow, OverlayTaskCancelledError } from "./overlayRaster";
import * as passFail from "./passFailState";
import type { Site } from "../types/radio";
import { defaultPropagationEnvironment } from "./propagationEnvironment";

const site: Site = { id: "a", name: "A", position: { lat: 60, lon: 10 }, groundElevationM: 0, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 0 };
const input = () => ({ bounds: { minLat: 59, maxLat: 60, minLon: 10, maxLon: 11 }, dimensions: { width: 5, height: 5 }, sites: [site], frequencyMHz: 868, propagationEnvironment: defaultPropagationEnvironment(), rxTargetDbm: -100, environmentLossDb: 0, terrainSampler: () => 0, terrainSamples: 20, adaptive: false });
const metrics = (rxDbm: number, terrainObstructed = false) => ({ rxDbm, terrainObstructed, terrainPenaltyDb: 0 });
beforeEach(() => vi.restoreAllMocks());

describe("coverage area union", () => {
  it("counts threshold equality, yellow in total, and green in both totals", async () => {
    const spy = vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockReturnValue(metrics(-100));
    const green = await buildCoverageAreaAsync(input());
    expect(green!.totalCoverageKm2).toBeGreaterThan(0);
    expect(green!.clearPathCoverageKm2).toBe(green!.totalCoverageKm2);
    spy.mockReturnValue(metrics(-100, true));
    const yellow = await buildCoverageAreaAsync(input());
    expect(yellow!.totalCoverageKm2).toBe(green!.totalCoverageKm2);
    expect(yellow!.clearPathCoverageKm2).toBe(0);
    spy.mockReturnValue(metrics(-100.01));
    expect(await buildCoverageAreaAsync(input())).toMatchObject({ totalCoverageKm2: 0, clearPathCoverageKm2: 0 });
  });
  it("unions overlapping Sites and keeps a weaker clear passing path", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockImplementation((_lat, _lon, from) => metrics(from.id === "a" ? -80 : -90, from.id === "a"));
    const single = await buildCoverageAreaAsync(input());
    const b = { ...site, id: "b" };
    const union = await buildCoverageAreaAsync({ ...input(), sites: [site, b, site] });
    const reverse = await buildCoverageAreaAsync({ ...input(), sites: [b, site] });
    expect(union!.totalCoverageKm2).toBe(single!.totalCoverageKm2);
    expect(union!.clearPathCoverageKm2).toBe(union!.totalCoverageKm2);
    expect(reverse!.totalCoverageKm2).toBe(union!.totalCoverageKm2);
    expect(reverse!.clearPathCoverageKm2).toBe(union!.clearPathCoverageKm2);
    expect(union!.analysisStats.evaluatedPaths).toBe(50);
  });
  it("unions disjoint cells with latitude and boundary weights, and honors masks", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockImplementation((_lat, lon, from) => metrics((from.id === "a" ? lon < 10.5 : lon >= 10.5) ? -90 : -110));
    const all = await buildCoverageAreaAsync({ ...input(), sites: [site, { ...site, id: "b" }] });
    const left = await buildCoverageAreaAsync(input());
    const right = await buildCoverageAreaAsync({ ...input(), sites: [{ ...site, id: "b" }] });
    expect(all!.totalCoverageKm2).toBeCloseTo(left!.totalCoverageKm2 + right!.totalCoverageKm2, 8);
    const masked = await buildCoverageAreaAsync({ ...input(), sites: [site, { ...site, id: "b" }], pointMask: (_lat: number, lon: number) => lon < 10.5 });
    expect(masked!.totalCoverageKm2).toBeCloseTo(left!.totalCoverageKm2, 8);
    const latitudes = Array.from({ length: 5 }, (_, row) => latitudeForRasterRow(row, 5, 59, 60));
    const expected = latitudes.reduce((sum, lat, row) => sum + 111.32 ** 2 * Math.cos(lat * Math.PI / 180) * ((row === 0 ? 60 : (latitudes[row - 1] + lat) / 2) - (row === 4 ? 59 : (lat + latitudes[row + 1]) / 2)), 0);
    expect(all!.totalCoverageKm2).toBeCloseTo(expected, 8);
  });
  it("rejects missing terrain on endpoints and intermediate paths but accepts known ocean elevation", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockImplementation((_lat, _lon, _from, _link, _height, _gain, sampler) => { sampler(59.5, 10.5); return metrics(-90); });
    await expect(buildCoverageAreaAsync({ ...input(), terrainSampler: () => null })).rejects.toThrow("Terrain data is unavailable");
    await expect(buildCoverageAreaAsync({ ...input(), terrainSampler: (lat: number, lon: number) => lat === 59.5 && lon === 10.5 ? null : 0 })).rejects.toThrow("Terrain data is unavailable");
    expect((await buildCoverageAreaAsync(input()))!.totalCoverageKm2).toBeGreaterThan(0);
  });
  it("matches exhaustive traversal for stable classifications and reuses cached metrics", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockReturnValue(metrics(-80));
    const exhaustive = await buildCoverageAreaAsync(input());
    const adaptive = await buildCoverageAreaAsync({ ...input(), adaptive: true, terrainCacheKey: "stable-area" });
    const cached = await buildCoverageAreaAsync({ ...input(), adaptive: true, terrainCacheKey: "stable-area", rxTargetDbm: -99 });
    expect(adaptive!.totalCoverageKm2).toBe(exhaustive!.totalCoverageKm2);
    expect(cached!.analysisStats.evaluatedPaths).toBe(0);
    expect(adaptive!.analysisStats.evaluatedPaths).toBeLessThanOrEqual(25);
  });
  it("shares complete single-Site overlay metrics and rejects cached incomplete paths", async () => {
    const spy = vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockImplementation((_lat, _lon, _from, _link, _height, _gain, sampler) => { sampler(59.5, 10.5); return metrics(-80); });
    const current = input();
    const source = (key: string, sampler: (lat: number, lon: number) => number | null) => buildSourcePassFailOverlayPixelsAsync(
      current.bounds, site, { id: "map-single", fromSiteId: site.id, toSiteId: site.id, frequencyMHz: 868,
        txPowerDbm: site.txPowerDbm, txGainDbi: site.txGainDbi, rxGainDbi: site.rxGainDbi, cableLossDb: site.cableLossDb },
      site.antennaHeightM, site.rxGainDbi, current.propagationEnvironment, -100, 0, sampler,
      current.dimensions, 20, undefined, undefined, { adaptive: false, terrainCacheKey: key },
    );
    await source("shared-source", () => 0);
    spy.mockClear();
    const area = await buildCoverageAreaAsync({ ...current, terrainCacheKey: "shared-source" });
    expect(area!.analysisStats.evaluatedPaths).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    const missing = (lat: number, lon: number) => lat === 59.5 && lon === 10.5 ? null : 0;
    await source("incomplete-source", missing);
    await expect(buildCoverageAreaAsync({ ...current, terrainCacheKey: "incomplete-source", terrainSampler: missing })).rejects.toThrow("Terrain data is unavailable");
  });

  it("refines mixed states and margins near the threshold to match exhaustive unions", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockImplementation((lat, lon, from) => metrics(
      (from.id === "a" ? lon < 10.5 : lat > 59.5) ? -99 : -101, from.id === "a",
    ));
    const current = { ...input(), dimensions: { width: 17, height: 17 }, sites: [site, { ...site, id: "b" }] };
    const exhaustive = await buildCoverageAreaAsync(current);
    const adaptive = await buildCoverageAreaAsync({ ...current, adaptive: true });
    expect(adaptive!.totalCoverageKm2).toBe(exhaustive!.totalCoverageKm2);
    expect(adaptive!.clearPathCoverageKm2).toBe(exhaustive!.clearPathCoverageKm2);
    expect(adaptive!.clearPathCoverageKm2).toBeLessThanOrEqual(adaptive!.totalCoverageKm2);
  });

  it("rejects unavailable intermediate terrain on an adaptively inherited path", async () => {
    const spy = vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockImplementation((lat, lon, from, _link, _height, _gain, sampler) => {
      for (let sample = 0; sample < 16; sample += 1) {
        const t = sample / 15;
        sampler(from.position.lat + (lat - from.position.lat) * t, from.position.lon + (lon - from.position.lon) * t);
      }
      return metrics(-80);
    });
    const current = { ...input(), dimensions: { width: 97, height: 97 }, terrainSamples: 2, adaptive: true };
    await buildCoverageAreaAsync(current);
    const evaluated = new Set(spy.mock.calls.map(([lat, lon]) => `${lat},${lon}`));
    let inherited: { lat: number; lon: number } | undefined;
    for (let row = 1; row < 96 && !inherited; row += 1) {
      for (let col = 1; col < 96 && !inherited; col += 1) {
        const point = { lat: latitudeForRasterRow(row, 97, 59, 60), lon: 10 + col / 96 };
        if (!evaluated.has(`${point.lat},${point.lon}`)) inherited = point;
      }
    }
    expect(inherited).toBeDefined();
    const missing = { lat: 60 + (inherited!.lat - 60) / 15, lon: 10 + (inherited!.lon - 10) / 15 };
    await expect(buildCoverageAreaAsync({ ...current, terrainSampler: (lat: number, lon: number) =>
      Math.abs(lat - missing.lat) < 1e-10 && Math.abs(lon - missing.lon) < 1e-10 ? null : 0,
    })).rejects.toThrow("Terrain data is unavailable");
  });

  it("reuses complete-path validation and cancels before the validation pass publishes results", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockReturnValue(metrics(-80));
    const sampler = vi.fn(() => 0);
    const current = { ...input(), terrainSampler: sampler, terrainCacheKey: "validated-path-cache" };
    await buildCoverageAreaAsync(current);
    sampler.mockClear();
    await buildCoverageAreaAsync(current);
    expect(sampler).toHaveBeenCalledTimes(25); // Only the final receiver-grid guard remains.
    let cancelled = false;
    await expect(buildCoverageAreaAsync({ ...input(), adaptive: true,
      context: { phase: "area", signature: "cancel-after-classification", shouldCancel: () => cancelled,
        onProgress: ({ percent }) => { if (percent === 100) cancelled = true; } },
    })).rejects.toBeInstanceOf(OverlayTaskCancelledError);
  });

  it("scales by unique contributors and cancels cooperatively", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockReturnValue(metrics(-80));
    const eight = await buildCoverageAreaAsync({ ...input(), sites: Array.from({ length: 8 }, (_, i) => ({ ...site, id: `perf-${i}` })) });
    expect(eight!.analysisStats.evaluatedPaths).toBe(8 * 25);
    await expect(buildCoverageAreaAsync({ ...input(), context: { phase: "area", signature: "cancel", shouldCancel: () => true } })).rejects.toBeInstanceOf(OverlayTaskCancelledError);
    expect(await buildCoverageAreaAsync({ ...input(), sites: [] })).toBeNull();
  });
});


describe("coverage area terrain certification", () => {
  it("avoids exhaustive path sampling only after certifying the whole source-to-grid rectangle", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockReturnValue(metrics(-80));
    const sampler = vi.fn(() => 0);
    const certificate = vi.fn(() => true);
    const current = { ...input(), dimensions: { width: 97, height: 97 }, adaptive: true, terrainSampler: sampler };
    const baseline = await buildCoverageAreaAsync(current);
    const baselineCalls = sampler.mock.calls.length;
    sampler.mockClear();
    const certified = await buildCoverageAreaAsync({ ...current, terrainCompleteness: certificate });
    expect(certified!.totalCoverageKm2).toBe(baseline!.totalCoverageKm2);
    expect(certified!.clearPathCoverageKm2).toBe(baseline!.clearPathCoverageKm2);
    expect(sampler.mock.calls.length).toBeLessThan(baselineCalls / 10);
    expect(certificate).toHaveBeenCalledWith(current.bounds);
    await buildCoverageAreaAsync({ ...current, sites: [{ ...site, position: { lat: 61, lon: 9 } }], terrainCompleteness: certificate });
    expect(certificate).toHaveBeenLastCalledWith({ ...current.bounds, maxLat: 61, minLon: 9 });
  });
  it("retains exhaustive validation when completeness cannot be certified", async () => {
    vi.spyOn(passFail, "computeSourceCentricRxMetrics").mockReturnValue(metrics(-80));
    await expect(buildCoverageAreaAsync({ ...input(), terrainCompleteness: () => false,
      terrainSampler: (lat: number, lon: number) => Math.abs(lat - 60) < 1e-8 && Math.abs(lon - 10) < 1e-8 ? null : 0,
    })).rejects.toThrow("Terrain data is unavailable");
  });
});
