import { describe, expect, it } from "vitest";
import {
  buildCoverageOverlayPixelsAsync,
  computeCoverageRxTargetScale,
  normalizeCoverageDbmForRxTarget,
  buildRelayCandidateOverlayPixelsAsync,
  buildSourcePassFailOverlayPixelsAsync,
  buildTerrainShadeOverlayPixelsAsync,
  latitudeForRasterRow,
  OverlayTaskCancelledError,
  type CoverageSampleLite,
  type TerrainBounds,
} from "./overlayRaster";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

const bounds: TerrainBounds = {
  minLat: 59.8,
  maxLat: 60.0,
  minLon: 10.6,
  maxLon: 10.8,
};

const samples: CoverageSampleLite[] = [
  { lat: 59.8, lon: 10.6, valueDbm: -112 },
  { lat: 59.8, lon: 10.8, valueDbm: -92 },
  { lat: 60.0, lon: 10.6, valueDbm: -99 },
  { lat: 60.0, lon: 10.8, valueDbm: -72 },
];

const fromSite: Site = {
  id: "a",
  name: "A",
  position: { lat: 59.9, lon: 10.65 },
  groundElevationM: 120,
  antennaHeightM: 15,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const toSite: Site = {
  id: "b",
  name: "B",
  position: { lat: 59.93, lon: 10.74 },
  groundElevationM: 140,
  antennaHeightM: 12,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const link: Link = {
  id: "link-1",
  fromSiteId: fromSite.id,
  toSiteId: toSite.id,
  frequencyMHz: 868,
};

const environment: PropagationEnvironment = {
  radioClimate: "Continental Temperate",
  polarization: "Vertical",
  clutterHeightM: 10,
  groundDielectric: 15,
  groundConductivity: 0.005,
  atmosphericBendingNUnits: 301,
};

const terrainSampler = () => 135;

describe("overlayRaster async builders", () => {
  it("samples raster rows in Web Mercator space so image overlays align with GeoJSON", () => {
    const minLat = 62.97069520171348;
    const maxLat = 63.869006376704505;

    expect(latitudeForRasterRow(0, 3, minLat, maxLat)).toBeCloseTo(maxLat, 12);
    expect(latitudeForRasterRow(2, 3, minLat, maxLat)).toBeCloseTo(minLat, 12);
    expect(latitudeForRasterRow(1, 3, minLat, maxLat)).toBeCloseTo(63.42336981712888, 12);
    expect(latitudeForRasterRow(1, 3, minLat, maxLat)).not.toBeCloseTo((minLat + maxLat) / 2, 4);
  });

  it("normalizes coverage colors against the RX target instead of sample min/max", () => {
    const scale = { min: -150, max: -90 };
    expect(normalizeCoverageDbmForRxTarget(-150, -120, scale)).toBe(0);
    expect(normalizeCoverageDbmForRxTarget(-120, -120, scale)).toBeCloseTo(0.5, 4);
    expect(normalizeCoverageDbmForRxTarget(-90, -120, scale)).toBe(1);
  });

  it("centers the RX target scale while widening to observed signal distribution", () => {
    const scale = computeCoverageRxTargetScale(
      [
        { lat: 0, lon: 0, valueDbm: -150 },
        { lat: 0, lon: 1, valueDbm: -190 },
        { lat: 1, lon: 0, valueDbm: -125 },
        { lat: 1, lon: 1, valueDbm: -85 },
      ],
      -120,
    );

    expect(scale).toEqual({ min: -175, max: -65 });
  });

  it("reports the target-centered heatmap scale for the legend", async () => {
    const raster = await buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "heatmap",
      5,
      { width: 16, height: 10 },
      undefined,
      terrainSampler,
      { phase: "coverage", signature: "legend-scale-test" },
      { rxTargetDbm: -100 },
    );

    expect(raster?.minDbm).toBeCloseTo(-125, 4);
    expect(raster?.maxDbm).toBeCloseTo(-75, 4);
  });

  it("builds coverage raster pixels with expected metadata shape", async () => {
    const raster = await buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "heatmap",
      5,
      { width: 16, height: 10 },
      undefined,
      terrainSampler,
      { phase: "coverage", signature: "shape-test" },
    );

    expect(raster).not.toBeNull();
    expect(raster?.width).toBe(16);
    expect(raster?.height).toBe(10);
    expect(raster?.pixels.length).toBe(16 * 10 * 4);
    expect(raster?.coordinates).toEqual([
      [bounds.minLon, bounds.maxLat],
      [bounds.maxLon, bounds.maxLat],
      [bounds.maxLon, bounds.minLat],
      [bounds.minLon, bounds.minLat],
    ]);
  });

  it("draws contour pixels only near the RX target threshold", async () => {
    const raster = await buildCoverageOverlayPixelsAsync(
      bounds,
      [
        { lat: 59.8, lon: 10.6, valueDbm: -130 },
        { lat: 59.8, lon: 10.8, valueDbm: -110 },
        { lat: 60.0, lon: 10.6, valueDbm: -130 },
        { lat: 60.0, lon: 10.8, valueDbm: -110 },
      ],
      "contours",
      5,
      { width: 24, height: 8 },
      undefined,
      terrainSampler,
      { phase: "coverage", signature: "target-contour-test" },
      { rxTargetDbm: -120 },
    );

    expect(raster).not.toBeNull();
    const alphas = Array.from(raster!.pixels).filter((_, index) => index % 4 === 3);
    const visiblePixels = alphas.filter((alpha) => alpha > 0).length;
    expect(visiblePixels).toBeGreaterThan(0);
    expect(visiblePixels).toBeLessThan(alphas.length / 2);
  });

  it("supports all overlay modes through async chunked builders", async () => {
    const passFail = await buildSourcePassFailOverlayPixelsAsync(
      bounds,
      fromSite,
      link,
      toSite.antennaHeightM,
      toSite.rxGainDbi,
      environment,
      -118,
      0,
      terrainSampler,
      { width: 10, height: 10 },
      24,
      undefined,
      { phase: "passfail", signature: "mode-passfail", frameBudgetMs: 2 },
    );

    const relay = await buildRelayCandidateOverlayPixelsAsync(
      bounds,
      fromSite,
      toSite,
      link,
      environment,
      0,
      terrainSampler,
      { width: 10, height: 10 },
      24,
      undefined,
      { phase: "relay", signature: "mode-relay", frameBudgetMs: 2 },
    );

    const terrain = await buildTerrainShadeOverlayPixelsAsync(
      bounds,
      terrainSampler,
      { width: 10, height: 10 },
      undefined,
      { phase: "terrain", signature: "mode-terrain", frameBudgetMs: 2 },
    );

    expect(passFail?.pixels.length).toBe(10 * 10 * 4);
    expect(relay?.pixels.length).toBe(10 * 10 * 4);
    expect(terrain?.pixels.length).toBe(10 * 10 * 4);
    expect(relay?.minDbm).toEqual(expect.any(Number));
    expect(relay?.maxDbm).toEqual(expect.any(Number));
  });

  it("cancels an in-flight overlay task without returning stale data", async () => {
    let shouldCancel = false;
    const promise = buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "contours",
      5,
      { width: 220, height: 220 },
      undefined,
      terrainSampler,
      {
        phase: "coverage",
        signature: "cancel-test",
        frameBudgetMs: 1,
        longTaskMs: 1,
        shouldCancel: () => shouldCancel,
        onLongTask: () => {
          shouldCancel = true;
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(OverlayTaskCancelledError);
  });

  it("reports cooperative progress for overlay build callbacks", async () => {
    const checkpoints: Array<{ processed: number; total: number; percent: number }> = [];
    await buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "heatmap",
      5,
      { width: 40, height: 40 },
      undefined,
      terrainSampler,
      {
        phase: "coverage",
        signature: "progress-test",
        frameBudgetMs: 1,
        onProgress: (payload) => {
          checkpoints.push({
            processed: payload.processed,
            total: payload.total,
            percent: payload.percent,
          });
        },
      },
    );

    expect(checkpoints.length).toBeGreaterThan(0);
    const last = checkpoints[checkpoints.length - 1];
    expect(last).toEqual({ processed: 1600, total: 1600, percent: 100 });
  });
});
