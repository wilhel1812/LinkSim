import { describe, expect, it } from "vitest";
import {
  buildCoverageOverlayPixelsAsync,
  buildRelayCandidateOverlayPixelsAsync,
  buildSourcePassFailOverlayPixelsAsync,
  buildTerrainShadeOverlayPixelsAsync,
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
