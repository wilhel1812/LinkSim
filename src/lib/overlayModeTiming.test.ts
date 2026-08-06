import { describe, expect, it } from "vitest";
import {
  buildCoverageGridPoints,
  computeCalibratedOverlayGridDimensions,
  createCoverageContributorEvaluators,
  resolveMeshExtensionCoverageBudgetGridSize,
} from "./coverage";
import {
  buildAdaptiveCoverageOverlayPixelsAsync,
  buildCoverageOverlayPixelsAsync,
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
  {
    id: "c", name: "C", position: { lat: 59.84, lon: 10.72 }, groundElevationM: 110,
    antennaHeightM: 14, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
  },
  {
    id: "d", name: "D", position: { lat: 59.97, lon: 10.66 }, groundElevationM: 150,
    antennaHeightM: 10, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
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
  it("executes representative cold 1x modes on their resolved grids", async () => {
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
      contributors: createCoverageContributorEvaluators(network, sites, [system], environment, () => 100, {
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
    expect(Object.values(timings)).toHaveLength(4);
    expect(Object.values(timings).every((durationMs) => durationMs > 0)).toBe(true);
  }, 120_000);

  it("keeps four-site 1x Heatmap within a bounded production-reference budget", async () => {
    const dimensions = computeCalibratedOverlayGridDimensions(24, bounds, "heatmap");
    const rasterDimensions = { width: dimensions.width, height: dimensions.height };
    const measure = async (run: () => Promise<unknown>): Promise<number> => {
      const startedAt = performance.now();
      await run();
      return performance.now() - startedAt;
    };
    const productionDurations: number[] = [];
    const adaptiveDurations: number[] = [];
    const adaptivePathCounts: number[] = [];
    for (let runIndex = 0; runIndex < 3; runIndex += 1) {
      const productionContributors = createCoverageContributorEvaluators(
        network,
        sites,
        [system],
        environment,
        () => 100,
        { terrainSamples: 20, terrainCacheKey: `production-${runIndex}`, requireCompleteTerrain: true },
      );
      productionDurations.push(await measure(async () => {
        const samples = buildCoverageGridPoints(24, bounds).map((point) => ({
          ...point,
          valueDbm: Math.max(...productionContributors.map((contributor) =>
            contributor.evaluatePoint(point.lat, point.lon))),
        }));
        await buildCoverageOverlayPixelsAsync(
          bounds,
          samples,
          "heatmap",
          5,
          rasterDimensions,
          undefined,
          () => 100,
          context(`production-${runIndex}`),
          { rxTargetDbm: -118 },
        );
      }));

      const adaptiveContributors = createCoverageContributorEvaluators(
        network,
        sites,
        [system],
        environment,
        () => 100,
        { terrainSamples: 20, terrainCacheKey: `adaptive-${runIndex}`, requireCompleteTerrain: true },
      );
      adaptiveDurations.push(await measure(async () => {
        const result = await buildAdaptiveCoverageOverlayPixelsAsync({
          bounds,
          dimensions: rasterDimensions,
          initialGridSize: 24,
          mode: "heatmap",
          rxTargetDbm: -118,
          contributors: adaptiveContributors,
          context: context(`adaptive-${runIndex}`),
          adaptive: true,
        });
        adaptivePathCounts.push(result?.analysisStats?.evaluatedPaths ?? Number.POSITIVE_INFINITY);
      }));
    }
    productionDurations.sort((left, right) => left - right);
    adaptiveDurations.sort((left, right) => left - right);
    const productionPathBudget = buildCoverageGridPoints(24, bounds).length * sites.length;
    expect(adaptivePathCounts.every((count) => count <= productionPathBudget * 3.5)).toBe(true);
    expect(adaptiveDurations[1]).toBeLessThanOrEqual(productionDurations[1] * 2);
  }, 120_000);

});
