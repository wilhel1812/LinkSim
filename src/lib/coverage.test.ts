import { describe, expect, it } from "vitest";
import {
  buildCoverage,
  buildCoverageAsync,
  computeCalibratedOverlayGridDimensions,
  computeCanonicalOverlayGridDimensions,
  computeCoverageGridDimensions,
  CoverageBuildCancelledError,
  clearTerrainLossCache,
  createCoverageContributorEvaluators,
  resolveMeshExtensionCoverageBudgetGridSize,
  resolveOverlayGridWorkloadScale,
} from "./coverage";
import { haversineDistanceKm } from "./geo";
import { defaultPropagationEnvironment } from "./propagationEnvironment";
import { resolveSimulationSitesForSelection } from "./simulationArea";
import { resolveRequiredOverlayTerrainTileKeys } from "./simulationOverlayRadius";
import { normalizeLongitude } from "./terrainTiles";
import type { Network, RadioSystem, Site } from "../types/radio";

const sites: Site[] = [
  {
    id: "s1",
    name: "One",
    position: { lat: 59.9, lon: 10.7 },
    groundElevationM: 100,
    antennaHeightM: 20,
    txPowerDbm: 22,
    txGainDbi: 2,
    rxGainDbi: 2,
    cableLossDb: 1,
  },
  {
    id: "s2",
    name: "Two",
    position: { lat: 59.95, lon: 10.85 },
    groundElevationM: 130,
    antennaHeightM: 16,
    txPowerDbm: 22,
    txGainDbi: 2,
    rxGainDbi: 2,
    cableLossDb: 1,
  },
];

const systems: RadioSystem[] = [
  {
    id: "sys-a",
    name: "Base",
    txPowerDbm: 30,
    txGainDbi: 12,
    rxGainDbi: 12,
    cableLossDb: 1,
    antennaHeightM: 24,
  },
];

const network: Network = {
  id: "n1",
  name: "Test",
  frequencyMHz: 433,
  bandwidthKhz: 250,
  spreadFactor: 11,
  codingRate: 5,
  memberships: [
    { siteId: "s1", systemId: "sys-a" },
    { siteId: "s2", systemId: "sys-a" },
  ],
};

const NORMAL_GRID = 24;
const HIGH_GRID = 42;

describe("buildCoverage", () => {
  it("renders smooth coverage modes at half the Pass/Fail resolution per axis", () => {
    expect(resolveOverlayGridWorkloadScale("passfail", 2)).toBe(1);
    expect(resolveOverlayGridWorkloadScale("relay", 2)).toBe(1);
    expect(resolveOverlayGridWorkloadScale("heatmap", 1)).toBe(0.5);
    expect(resolveOverlayGridWorkloadScale("heatmap", 4)).toBe(0.5);
    expect(resolveOverlayGridWorkloadScale("weakest", 4)).toBe(0.5);
    expect(resolveOverlayGridWorkloadScale("contours", 4)).toBe(0.5);
    expect(resolveOverlayGridWorkloadScale("mesh-extension", 2)).toBe(1);
    expect(resolveOverlayGridWorkloadScale("mesh-extension", 4)).toBe(1);
  });

  it("turns a 317x317 Pass/Fail grid into a 158x158 smooth coverage grid", () => {
    const bounds = { minLat: 59.8, maxLat: 60, minLon: 10.6, maxLon: 11.0 };
    const passFail = computeCalibratedOverlayGridDimensions(24, bounds, "passfail", 1, 2);
    const heatmap = computeCalibratedOverlayGridDimensions(24, bounds, "heatmap", 1, 4);
    const weakest = computeCalibratedOverlayGridDimensions(24, bounds, "weakest", 1, 4);
    const contours = computeCalibratedOverlayGridDimensions(24, bounds, "contours", 1, 4);

    expect(passFail).toEqual(computeCanonicalOverlayGridDimensions(24, bounds, 1));
    expect(passFail).toMatchObject({ width: 317, height: 317 });
    expect(heatmap).toMatchObject({ width: 158, height: 158, totalSamples: 24_964 });
    expect(weakest).toEqual(heatmap);
    expect(contours).toEqual(heatmap);
  });

  it("uses selected sites as coverage contributors and all sites for an empty selection", () => {
    expect(resolveSimulationSitesForSelection(sites, ["s2"])).toEqual([sites[1]]);
    expect(resolveSimulationSitesForSelection(sites, ["missing", "s1"])).toEqual([sites[0]]);
    expect(resolveSimulationSitesForSelection(sites, [])).toEqual(sites);
    expect(resolveSimulationSitesForSelection(sites, ["missing"])).toEqual(sites);
  });

  it("applies Site receive directionality to coverage contributors", () => {
    const directionalSite: Site = {
      ...sites[0],
      antennaMode: "directional",
      antennaAzimuthDeg: 0,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 30,
      antennaVerticalBeamwidthDeg: 180,
      antennaMaxAttenuationDb: 20,
    };
    const singleNetwork = { ...network, memberships: [{ siteId: directionalSite.id, systemId: systems[0].id }] };
    const toward = createCoverageContributorEvaluators(singleNetwork, [directionalSite], systems, defaultPropagationEnvironment())[0];
    const awaySite = { ...directionalSite, antennaAzimuthDeg: 180 };
    const away = createCoverageContributorEvaluators(singleNetwork, [awaySite], systems, defaultPropagationEnvironment())[0];

    expect(toward.evaluatePoint(59.91, 10.7) - away.evaluatePoint(59.91, 10.7)).toBeCloseTo(20, 4);
  });

  it("evaluates only the selected coverage contributors", () => {
    const selectedSites = resolveSimulationSitesForSelection(sites, ["s1"]);
    const selectedEvaluators = createCoverageContributorEvaluators(
      network,
      selectedSites,
      systems,
      defaultPropagationEnvironment(),
    );
    const singleMembershipEvaluators = createCoverageContributorEvaluators(
      { ...network, memberships: [network.memberships[0]] },
      sites,
      systems,
      defaultPropagationEnvironment(),
    );

    expect(selectedEvaluators).toHaveLength(1);
    expect(singleMembershipEvaluators).toHaveLength(1);
    expect(selectedEvaluators[0].evaluatePoint(59.95, 10.85)).toBe(
      singleMembershipEvaluators[0].evaluatePoint(59.95, 10.85),
    );
  });

  it("discards stale terrain-loss entries when the coverage selection scope changes", () => {
    clearTerrainLossCache();
    let terrainReads = 0;
    const terrainSampler = () => {
      terrainReads += 1;
      return 120;
    };
    const createForScope = (terrainCacheKey: string) => createCoverageContributorEvaluators(
      network,
      [sites[0]],
      systems,
      defaultPropagationEnvironment(),
      terrainSampler,
      { terrainSamples: 20, terrainCacheKey, requireCompleteTerrain: true },
    )[0];

    createForScope("selection-one").evaluatePoint(59.95, 10.85);
    terrainReads = 0;
    createForScope("selection-one").evaluatePoint(59.95, 10.85);
    expect(terrainReads).toBe(1);

    createForScope("selection-two").evaluatePoint(59.96, 10.86);
    terrainReads = 0;
    createForScope("selection-one").evaluatePoint(59.95, 10.85);

    expect(terrainReads).toBeGreaterThan(1);
  });

  it("keeps Mesh Extension's nested comparison grid at the selected resolution", () => {
    expect(resolveMeshExtensionCoverageBudgetGridSize(24)).toBe(24);
    expect(resolveMeshExtensionCoverageBudgetGridSize(42)).toBe(42);
  });

  it("creates non-empty coverage at normal resolution", () => {
    const result = buildCoverage(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment());
    expect(result.length).toBeGreaterThan(100);
    expect(Number.isFinite(result[0].valueDbm)).toBe(true);
  });

  it("creates more samples at high resolution", () => {
    const normal = buildCoverage(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment());
    const high = buildCoverage(HIGH_GRID, network, sites, systems, defaultPropagationEnvironment());
    expect(high.length).toBeGreaterThan(normal.length);
  });

  it("uses strongest site signal as the default value and keeps weakest signal separately", () => {
    const result = buildCoverage(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment());
    const samplesWithDifferentBestAndWeakest = result.filter(
      (sample) => typeof sample.weakestDbm === "number" && sample.valueDbm > sample.weakestDbm,
    );

    expect(samplesWithDifferentBestAndWeakest.length).toBeGreaterThan(0);
    for (const sample of result) {
      expect(sample.weakestDbm).toEqual(expect.any(Number));
      expect(sample.valueDbm).toBeGreaterThanOrEqual(sample.weakestDbm!);
    }
  });

  it("buildCoverageAsync matches sync output shape", async () => {
    const sync = buildCoverage(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment());
    const asyncResult = await buildCoverageAsync(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment());
    expect(asyncResult).toHaveLength(sync.length);
    expect(Math.abs(asyncResult[0].valueDbm - sync[0].valueDbm)).toBeLessThan(0.0001);
  });

  it("cooperatively cancels asynchronous coverage work", async () => {
    let checks = 0;
    await expect(
      buildCoverageAsync(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment(), undefined, {
        shouldCancel: () => {
          checks += 1;
          return checks > 8;
        },
      }),
    ).rejects.toBeInstanceOf(CoverageBuildCancelledError);
  });

  it("rejects a terrain-backed build when any required terrain sample is unavailable", async () => {
    await expect(
      buildCoverageAsync(
        NORMAL_GRID,
        network,
        [sites[0]],
        systems,
        defaultPropagationEnvironment(),
        () => null,
        { overlayRadiusKm: 50, requireCompleteTerrain: true },
      ),
    ).rejects.toThrow("Terrain data is unavailable");
  });

  it("keeps complete-terrain contributor paths on the short antimeridian interval", () => {
    const datelineSite: Site = {
      ...sites[0],
      id: "dateline-east",
      position: { lat: 10.1, lon: 179.9 },
      groundElevationM: 100,
    };
    const datelineNetwork: Network = {
      ...network,
      memberships: [{ siteId: datelineSite.id, systemId: systems[0].id }],
    };
    const sampledLongitudes: number[] = [];
    const terrainSampler = ({ lon }: { lat: number; lon: number }) => {
      const normalized = normalizeLongitude(lon);
      sampledLongitudes.push(normalized);
      return Math.abs(normalized) >= 179 ? 100 : null;
    };
    const [evaluator] = createCoverageContributorEvaluators(
      datelineNetwork,
      [datelineSite],
      systems,
      defaultPropagationEnvironment(),
      terrainSampler,
      { requireCompleteTerrain: true, terrainCacheKey: "dateline-complete" },
    );

    expect(() => evaluator.evaluatePoint(10.1, -179.9)).not.toThrow();
    expect(sampledLongitudes.length).toBeGreaterThan(3);
    expect(sampledLongitudes.every((lon) => Math.abs(lon) >= 179)).toBe(true);
    expect(
      resolveRequiredOverlayTerrainTileKeys(
        [datelineSite, { ...datelineSite, id: "dateline-west", position: { lat: 10.1, lon: -179.9 } }],
        20,
      ).every((key) => key.endsWith("E179") || key.endsWith("W180")),
    ).toBe(true);
  });

  it("uses single-site radius override for sampling bounds", () => {
    const singleSite = [sites[0]];
    const base = buildCoverage(NORMAL_GRID, network, singleSite, systems, defaultPropagationEnvironment());
    const expanded = buildCoverage(NORMAL_GRID, network, singleSite, systems, defaultPropagationEnvironment(), undefined, {
      singleSiteRadiusKm: 60,
    });
    const farthestBase = Math.max(
      ...base.map((sample) => haversineDistanceKm(sample, singleSite[0].position)),
    );
    const farthestExpanded = Math.max(
      ...expanded.map((sample) => haversineDistanceKm(sample, singleSite[0].position)),
    );
    expect(farthestExpanded).toBeGreaterThan(farthestBase + 20);
  });

  it("uses overlay radius override for multi-site sampling bounds", () => {
    const base = buildCoverage(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment());
    const expanded = buildCoverage(NORMAL_GRID, network, sites, systems, defaultPropagationEnvironment(), undefined, {
      overlayRadiusKm: 100,
    });
    const center = {
      lat: (sites[0].position.lat + sites[1].position.lat) / 2,
      lon: (sites[0].position.lon + sites[1].position.lon) / 2,
    };
    const farthestBase = Math.max(...base.map((sample) => haversineDistanceKm(sample, center)));
    const farthestExpanded = Math.max(...expanded.map((sample) => haversineDistanceKm(sample, center)));
    expect(farthestExpanded).toBeGreaterThan(farthestBase + 30);
  });

  it("computes aspect-ratio adjusted grid dimensions", () => {
    const dims = computeCoverageGridDimensions(24, {
      minLat: 59.8,
      maxLat: 60.1,
      minLon: 10.7,
      maxLon: 10.8,
    });
    expect(dims.totalSamples).toBe(dims.rows * dims.cols);
    expect(dims.targetSamples).toBe(576);
    expect(dims.rows).toBeGreaterThan(0);
    expect(dims.cols).toBeGreaterThan(0);
  });

  it("uses the Pass/Fail raster as the canonical area-overlay grid", () => {
    const bounds = {
      minLat: 59.8,
      maxLat: 60.1,
      minLon: 10.7,
      maxLon: 10.8,
    };
    const base = computeCoverageGridDimensions(24, bounds);
    const canonical = computeCanonicalOverlayGridDimensions(24, bounds);

    expect(canonical.width).toBe(Math.round(base.cols * Math.sqrt(174)));
    expect(canonical.height).toBe(Math.round(base.rows * Math.sqrt(174)));
    expect(canonical.totalSamples).toBe(canonical.width * canonical.height);
  });
});
