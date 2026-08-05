import { describe, expect, it } from "vitest";
import {
  computeCalibratedOverlayGridDimensions,
  createCoveragePointEvaluator,
  resolveMeshExtensionCoverageBudgetGridSize,
} from "./coverage";
import {
  buildAdaptiveCoverageOverlayPixelsAsync,
  buildMeshExtensionOverlayPixelsAsync,
  buildRelayCandidateOverlayPixelsAsync,
  buildSourcePassFailOverlayPixelsAsync,
} from "./overlayRaster";
import type { Link, Network, PropagationEnvironment, RadioSystem, Site } from "../types/radio";

const bounds = { minLat: 59.8, maxLat: 60, minLon: 10.6, maxLon: 10.8 };
const environment: PropagationEnvironment = {
  radioClimate: "Continental Temperate",
  polarization: "Vertical",
  clutterHeightM: 10,
  groundDielectric: 15,
  groundConductivity: 0.005,
  atmosphericBendingNUnits: 301,
};
const sites: Site[] = [
  {
    id: "a", name: "A", position: { lat: 59.9, lon: 10.65 }, groundElevationM: 120,
    antennaHeightM: 15, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
  },
  {
    id: "b", name: "B", position: { lat: 59.93, lon: 10.74 }, groundElevationM: 140,
    antennaHeightM: 12, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
  },
];
const system: RadioSystem = {
  id: "sys", name: "System", txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
  antennaHeightM: 15,
};
const network: Network = {
  id: "network", name: "Network", frequencyMHz: 868, bandwidthKhz: 250, spreadFactor: 11,
  codingRate: 5, memberships: sites.map((site) => ({ siteId: site.id, systemId: system.id })),
};
const link: Link = { id: "link", fromSiteId: "a", toSiteId: "b", frequencyMHz: 868 };
const terrain = () => 100;
const context = (signature: string) => ({ phase: "benchmark", signature, frameBudgetMs: 1_000_000 });

describe("overlay mode timing calibration", () => {
  it("keeps representative cold 1x modes within the same broad performance budget", async () => {
    const timings: Record<string, number> = {};
    const measure = async (name: string, run: () => Promise<unknown>) => {
      const startedAt = performance.now();
      await run();
      timings[name] = performance.now() - startedAt;
    };
    const dimensionsFor = (mode: "passfail" | "heatmap" | "relay" | "mesh-extension", participants: number) => {
      const { width, height } = computeCalibratedOverlayGridDimensions(24, bounds, mode, 1, participants);
      return { width, height };
    };
    const passFailDimensions = dimensionsFor("passfail", 1);
    const heatmapDimensions = dimensionsFor("heatmap", sites.length);
    const relayDimensions = dimensionsFor("relay", 2);
    const meshDimensions = dimensionsFor("mesh-extension", sites.length);
    await measure("passfail", () => buildSourcePassFailOverlayPixelsAsync(
      bounds, sites[0], link, sites[1].antennaHeightM, sites[1].rxGainDbi, environment,
      -118, 0, terrain, passFailDimensions, 24, undefined, context("passfail"),
      { adaptive: true, analysisCacheKey: "bench-passfail" },
    ));
    await measure("heatmap", () => buildAdaptiveCoverageOverlayPixelsAsync({
      bounds, dimensions: heatmapDimensions, initialGridSize: 24, mode: "heatmap", rxTargetDbm: -118,
      evaluatePoint: createCoveragePointEvaluator(network, sites, [system], environment, () => 100, {
        terrainSamples: 20, terrainCacheKey: "bench-heatmap", requireCompleteTerrain: true,
      }),
      context: context("heatmap"), adaptive: true, analysisCacheKey: "bench-heatmap",
    }));
    await measure("relay", () => buildRelayCandidateOverlayPixelsAsync(
      bounds, sites[0], sites[1], link, environment, 0, terrain, relayDimensions, 24, undefined,
      context("relay"), { adaptive: true, analysisCacheKey: "bench-relay" },
    ));
    await measure("mesh-extension", () => buildMeshExtensionOverlayPixelsAsync({
      bounds, selectedSites: sites, frequencyMHz: 868, propagationEnvironment: environment,
      rxTargetDbm: -118, environmentLossDb: 0, terrainSampler: terrain, dimensions: meshDimensions,
      candidateGridSize: 24, coverageGridSize: resolveMeshExtensionCoverageBudgetGridSize(24), terrainSamples: 20,
      context: context("mesh-extension"),
    }));
    expect(timings.passfail).toBeGreaterThan(0);
    expect(timings.heatmap).toBeLessThan(timings.passfail * 1.75);
    expect(timings.relay).toBeLessThan(timings.passfail * 1.75);
    expect(timings["mesh-extension"]).toBeLessThan(timings.passfail * 1.75);
  }, 120_000);

  it("keeps the calibrated Mesh Extension area estimate close to the former 1x comparison grid", async () => {
    const meshBounds = { minLat: 59.89, maxLat: 59.91, minLon: 10.64, maxLon: 10.68 };
    const { width, height } = computeCalibratedOverlayGridDimensions(
      24,
      meshBounds,
      "mesh-extension",
      1,
      1,
    );
    const common = {
      bounds: meshBounds,
      selectedSites: [sites[0]],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -70,
      environmentLossDb: 0,
      terrainSampler: terrain,
      dimensions: { width, height },
      candidateGridSize: 24,
      terrainSamples: 20,
    };
    const reference = await buildMeshExtensionOverlayPixelsAsync({ ...common, coverageGridSize: 24 });
    const calibrated = await buildMeshExtensionOverlayPixelsAsync({
      ...common,
      coverageGridSize: resolveMeshExtensionCoverageBudgetGridSize(24),
    });

    expect(reference?.maxAreaKm2).toBeGreaterThan(0);
    expect(calibrated?.maxAreaKm2).toBeGreaterThan(0);
    const relativeError = Math.abs(calibrated!.maxAreaKm2! - reference!.maxAreaKm2!) / reference!.maxAreaKm2!;
    expect(relativeError).toBeLessThanOrEqual(0.15);
  });
});
