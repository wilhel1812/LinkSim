import { describe, expect, it } from "vitest";
import {
  buildCoverageOverlayPixelsAsync,
  buildMeshExtensionOverlayPixelsAsync,
  computeCoverageRxTargetScale,
  deriveMeshExtensionCandidateProfile,
  meshExtensionAlphaForDbm,
  meshExtensionColorForArea,
  resolveMeshExtensionCandidateGridSize,
  strongestBidirectionalPeerDbm,
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
  it("derives a representative mesh-extension profile from selected-site medians", () => {
    const profile = deriveMeshExtensionCandidateProfile([
      { ...fromSite, antennaHeightM: 4, txPowerDbm: 18, txGainDbi: 1, rxGainDbi: 2, cableLossDb: 0.5 },
      { ...toSite, antennaHeightM: 12, txPowerDbm: 24, txGainDbi: 5, rxGainDbi: 6, cableLossDb: 1.5 },
      { ...toSite, id: "c", antennaHeightM: 8, txPowerDbm: 22, txGainDbi: 3, rxGainDbi: 4, cableLossDb: 1 },
    ]);

    expect(profile).toEqual({
      antennaHeightM: 8,
      txPowerDbm: 22,
      txGainDbi: 3,
      rxGainDbi: 4,
      cableLossDb: 1,
    });
  });

  it("uses the strongest peer after taking each bidirectional bottleneck", () => {
    expect(
      strongestBidirectionalPeerDbm([
        { selectedToCandidateDbm: -95, candidateToSelectedDbm: -130 },
        { selectedToCandidateDbm: -108, candidateToSelectedDbm: -104 },
      ]),
    ).toBe(-108);
  });

  it("anchors mesh-extension opacity to established pass/fail and heatmap alpha levels", () => {
    expect(meshExtensionAlphaForDbm(-120, -120, { min: -150, max: -90 })).toBe(162);
    expect(meshExtensionAlphaForDbm(-90, -120, { min: -150, max: -90 })).toBe(180);
    expect(meshExtensionAlphaForDbm(-150, -120, { min: -150, max: -90 })).toBe(36);
  });

  it("caps mesh-extension candidate scoring at the 2x grid", () => {
    expect(resolveMeshExtensionCandidateGridSize(24)).toBe(24);
    expect(resolveMeshExtensionCandidateGridSize(42)).toBe(42);
    expect(resolveMeshExtensionCandidateGridSize(168)).toBe(42);
  });

  it("changes extension hue with new area independently of signal alpha", () => {
    expect(meshExtensionColorForArea(0, 20)).not.toEqual(meshExtensionColorForArea(20, 20));
    expect(meshExtensionAlphaForDbm(-140, -120, { min: -150, max: -90 })).not.toBe(
      meshExtensionAlphaForDbm(-100, -120, { min: -150, max: -90 }),
    );
  });

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

  it("builds mesh-extension metadata and finds positive newly covered area", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds: {
        minLat: 59.89,
        maxLat: 59.91,
        minLon: 10.64,
        maxLon: 10.68,
      },
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -70,
      environmentLossDb: 0,
      terrainSampler: () => 100,
      dimensions: { width: 8, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-positive", frameBudgetMs: 2 },
    });

    expect(raster).not.toBeNull();
    expect(raster?.pixels.length).toBe(8 * 6 * 4);
    expect(raster?.minAreaKm2).toBe(0);
    expect(raster?.maxAreaKm2).toBeGreaterThan(0);
    expect(raster?.minDbm).toEqual(expect.any(Number));
    expect(raster?.maxDbm).toEqual(expect.any(Number));
  });

  it("reports zero new area when the selected mesh already covers the comparison grid", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds: { minLat: 59.899, maxLat: 59.901, minLon: 10.649, maxLon: 10.651 },
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -140,
      environmentLossDb: 0,
      terrainSampler: () => 100,
      dimensions: { width: 6, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-covered", frameBudgetMs: 2 },
    });

    expect(raster?.minAreaKm2).toBe(0);
    expect(raster?.maxAreaKm2).toBe(0);
  });

  it("returns no mesh-extension raster when terrain is unavailable", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds,
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -118,
      environmentLossDb: 0,
      terrainSampler: () => null,
      dimensions: { width: 6, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-no-terrain", frameBudgetMs: 2 },
    });

    expect(raster).toBeNull();
  });

  it("cancels mesh-extension scoring before returning stale pixels", async () => {
    await expect(
      buildMeshExtensionOverlayPixelsAsync({
        bounds,
        selectedSites: [fromSite],
        frequencyMHz: 868,
        propagationEnvironment: environment,
        rxTargetDbm: -118,
        environmentLossDb: 0,
        terrainSampler,
        dimensions: { width: 12, height: 12 },
        candidateGridSize: 12,
        coverageGridSize: 12,
        terrainSamples: 16,
        context: {
          phase: "mesh-extension",
          signature: "mesh-extension-cancelled",
          shouldCancel: () => true,
        },
      }),
    ).rejects.toBeInstanceOf(OverlayTaskCancelledError);
  });

  it("reports monotonic aggregate progress across mesh-extension stages", async () => {
    const progress: number[] = [];
    await buildMeshExtensionOverlayPixelsAsync({
      bounds: { minLat: 59.899, maxLat: 59.901, minLon: 10.649, maxLon: 10.651 },
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -120,
      environmentLossDb: 0,
      terrainSampler,
      dimensions: { width: 6, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: {
        phase: "mesh-extension",
        signature: "mesh-extension-progress",
        onProgress: ({ percent }) => progress.push(percent),
      },
    });

    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
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
