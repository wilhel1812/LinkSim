import { expect, it } from "vitest";
import { buildCoverageAreaAsync } from "./overlayRaster";
import { computeCalibratedOverlayGridDimensions } from "./coverage";
import { buildBufferedSelectionArea } from "./simulationOverlayRadius";
import { isSrtmAreaCompleteAsync, sampleSrtmElevation } from "./srtm";
import { defaultPropagationEnvironment } from "./propagationEnvironment";
import type { Site, SrtmTile } from "../types/radio";

it("preserves two-Site 20 km 2× totals with at least 80% fewer total DEM reads", async () => {
  const sites: Site[] = [
    { id: "a", name: "A", position: { lat: 59.9, lon: 10.65 }, groundElevationM: 100,
      antennaHeightM: 15, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
    { id: "b", name: "B", position: { lat: 59.93, lon: 10.74 }, groundElevationM: 100,
      antennaHeightM: 12, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
  ];
  // Synthetic flat DEM data; exercise the production nearest-neighbour sampler and RF model.
  const tiles: SrtmTile[] = [];
  for (const lat of [59, 60]) for (const lon of [10, 11]) {
    tiles.push({ key: `N${lat}E0${lon}`, latStart: lat, lonStart: lon, size: 1201,
      width: 1201, height: 1201, arcSecondSpacing: 3, elevations: new Int16Array(1201 * 1201).fill(100) });
  }
  const area = buildBufferedSelectionArea(sites, 20)!;
  const dimensions = computeCalibratedOverlayGridDimensions(42, area.bounds, "passfail");
  let lookups = 0;
  let certificateReads = 0;
  const certificateTiles = tiles.map((tile) => ({ ...tile, elevations: new Proxy(tile.elevations, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) certificateReads += 1;
      return Reflect.get(target, key, target);
    },
  }) }));
  const input = {
    bounds: area.bounds, dimensions, sites, frequencyMHz: 868,
    propagationEnvironment: defaultPropagationEnvironment(), rxTargetDbm: -130,
    environmentLossDb: 0, terrainSamples: 42, adaptive: true, pointMask: area.contains,
    terrainSampler: (lat: number, lon: number) => { lookups += 1; return sampleSrtmElevation(tiles, lat, lon); },
    context: { phase: "area-performance", signature: "area-performance", frameBudgetMs: 14 },
  };
  // Use separate cold metric-cache keys so the optimization cannot pass through RF cache reuse.
  const referenceStarted = performance.now();
  const reference = await buildCoverageAreaAsync({ ...input, terrainCacheKey: "performance-reference" });
  const referenceMs = performance.now() - referenceStarted;
  const referenceLookups = lookups;
  lookups = 0;
  const optimizedStarted = performance.now();
  const optimized = await buildCoverageAreaAsync({ ...input, terrainCacheKey: "performance-certified",
    terrainCompleteness: (bounds, context) => isSrtmAreaCompleteAsync(certificateTiles, bounds, context) });
  expect(optimized).toEqual(reference);
  expect(certificateReads).toBeGreaterThan(0);
  expect(lookups + certificateReads).toBeLessThan(referenceLookups * 0.2);
  expect(performance.now() - optimizedStarted).toBeLessThan(referenceMs * 0.5);
}, 60_000);
