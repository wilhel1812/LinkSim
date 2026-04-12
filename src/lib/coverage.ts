import { haversineDistanceKm } from "./geo";
import { getPathLossDb } from "./rfModels";
import { simulationAreaBoundsForSites } from "./simulationArea";
import { estimateTerrainExcessLossDb } from "./terrainLoss";
import type {
  Coordinates,
  CoverageSample,
  Network,
  PropagationEnvironment,
  RadioSystem,
  Site,
} from "../types/radio";

export type BuildCoverageOptions = {
  sampleMultiplier?: number;
  terrainSamples?: number;
  onProgress?: (progress: number) => void;
  terrainCacheKey?: string;
  overlayRadiusKm?: number;
  singleSiteRadiusKm?: number;
};

export type CoverageGridBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type CoverageGridDimensions = {
  rows: number;
  cols: number;
  totalSamples: number;
  targetSamples: number;
};

const COVERAGE_COMPUTE_CHUNK_SIZE = 48;
const COVERAGE_COMPUTE_FRAME_BUDGET_MS = 12;

export const computeCoverageGridDimensions = (
  gridSize: number,
  bounds: CoverageGridBounds,
  sampleMultiplier = 1,
): CoverageGridDimensions => {
  const targetSamples = Math.max(64, Math.round(gridSize * gridSize * sampleMultiplier * sampleMultiplier));
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latSpanKm = Math.max(0.001, (bounds.maxLat - bounds.minLat) * 111.32);
  const lonScale = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const lonSpanKm = Math.max(0.001, (bounds.maxLon - bounds.minLon) * 111.32 * lonScale);
  const aspect = latSpanKm / lonSpanKm;
  const cols = Math.max(6, Math.round(Math.sqrt(targetSamples / Math.max(0.2, Math.min(5, aspect)))));
  const rows = Math.max(6, Math.round(targetSamples / cols));
  return {
    rows,
    cols,
    totalSamples: rows * cols,
    targetSamples,
  };
};

const nUnitsToKFactor = (nUnits: number): number => {
  const n = Math.max(250, Math.min(400, nUnits));
  return Math.max(1, Math.min(2, 1 + (n - 250) / 153));
};

const TERRAIN_LOSS_CACHE_LIMIT = 100_000;
const terrainLossMemo = new Map<string, number>();

const quantize = (value: number): string => value.toFixed(5);

const terrainLossCacheKeyFor = (
  scopeKey: string,
  sampleLat: number,
  sampleLon: number,
  rxSite: Site,
  txSystem: RadioSystem,
  frequencyMHz: number,
  terrainSamples: number,
  environment: PropagationEnvironment,
): string =>
  [
    scopeKey,
    quantize(sampleLat),
    quantize(sampleLon),
    rxSite.id,
    txSystem.id,
    quantize(rxSite.groundElevationM),
    quantize(rxSite.antennaHeightM),
    quantize(txSystem.antennaHeightM),
    quantize(frequencyMHz),
    String(terrainSamples),
    quantize(environment.atmosphericBendingNUnits),
    quantize(environment.clutterHeightM),
    environment.polarization,
  ].join("|");

const getMemoizedTerrainLoss = (
  key: string,
  compute: () => number,
): number => {
  const cached = terrainLossMemo.get(key);
  if (typeof cached === "number") return cached;
  const value = compute();
  terrainLossMemo.set(key, value);
  if (terrainLossMemo.size > TERRAIN_LOSS_CACHE_LIMIT) {
    const oldest = terrainLossMemo.keys().next().value;
    if (typeof oldest === "string") terrainLossMemo.delete(oldest);
  }
  return value;
};

export const clearTerrainLossCache = (): void => {
  terrainLossMemo.clear();
};

const evalRx = (
  sampleLat: number,
  sampleLon: number,
  rxSite: Site,
  txSystem: RadioSystem,
  frequencyMHz: number,
  terrainSamples: number,
  environment: PropagationEnvironment,
  terrainSampler?: (coordinates: Coordinates) => number | null,
  terrainCacheKey?: string,
): number => {
  const distanceKm = Math.max(
    0.001,
    haversineDistanceKm({ lat: sampleLat, lon: sampleLon }, rxSite.position),
  );
  const loss = getPathLossDb(
    distanceKm,
    frequencyMHz,
    txSystem.antennaHeightM,
    rxSite.antennaHeightM,
    environment,
  );
  const txGround = terrainSampler ? terrainSampler({ lat: sampleLat, lon: sampleLon }) : null;
  const terrainLoss =
    terrainSampler && txGround !== null
      ? getMemoizedTerrainLoss(
          terrainLossCacheKeyFor(
            terrainCacheKey ?? "global",
            sampleLat,
            sampleLon,
            rxSite,
            txSystem,
            frequencyMHz,
            terrainSamples,
            environment,
          ),
          () =>
            estimateTerrainExcessLossDb({
              from: { lat: sampleLat, lon: sampleLon },
              to: rxSite.position,
              fromAntennaAbsM: txGround + txSystem.antennaHeightM,
              toAntennaAbsM: rxSite.groundElevationM + rxSite.antennaHeightM,
              frequencyMHz,
              terrainSampler,
              samples: terrainSamples,
              kFactor: nUnitsToKFactor(environment.atmosphericBendingNUnits),
              clutterHeightM: environment.clutterHeightM,
              polarization: environment.polarization,
            }),
        )
      : 0;

  const eirp = txSystem.txPowerDbm + txSystem.txGainDbi - txSystem.cableLossDb;
  return eirp + txSystem.rxGainDbi - (loss + terrainLoss);
};


export const buildCoverage = (
  gridSize: number,
  network: Network,
  sites: Site[],
  systems: RadioSystem[],
  environment: PropagationEnvironment,
  terrainSampler?: (coordinates: Coordinates) => number | null,
  options?: BuildCoverageOptions,
): CoverageSample[] => {
  if (sites.length === 0 || systems.length === 0) return [];
  const effectiveFrequencyMHz = network.frequencyOverrideMHz ?? network.frequencyMHz;
  const sampleMultiplier = Math.max(1, options?.sampleMultiplier ?? 1);
  const terrainSamples = Math.max(16, Math.round(options?.terrainSamples ?? 20));
  const onProgress = options?.onProgress;
  const fallbackSystemId = systems[0]?.id ?? "";
  const effectiveMemberships =
    network.memberships
      .filter(
        (member) =>
          sites.some((site) => site.id === member.siteId) &&
          systems.some((system) => system.id === member.systemId),
      )
      .map((member) => ({ siteId: member.siteId, systemId: member.systemId })) || [];
  const membershipsToUse =
    effectiveMemberships.length > 0
      ? effectiveMemberships
      : sites.map((site) => ({ siteId: site.id, systemId: fallbackSystemId }));

  const samples: { lat: number; lon: number }[] = [];
  const bounds = simulationAreaBoundsForSites(sites, {
    overlayRadiusKm: options?.overlayRadiusKm,
    singleSiteRadiusKm: options?.singleSiteRadiusKm,
  });
  if (!bounds) return [];

  const { rows, cols } = computeCoverageGridDimensions(gridSize, bounds, sampleMultiplier);

  for (let y = 0; y < rows; y += 1) {
    const ty = rows <= 1 ? 0 : y / (rows - 1);
    const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * ty;
    for (let x = 0; x < cols; x += 1) {
      const tx = cols <= 1 ? 0 : x / (cols - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tx;
      samples.push({ lat, lon });
    }
  }

  onProgress?.(0);
  const total = Math.max(1, samples.length);
  const notifyEvery = Math.max(1, Math.floor(total / 40));
  const results: CoverageSample[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const rxLevels = membershipsToUse
      .map((m) => {
        const site = sites.find((s) => s.id === m.siteId);
        const system = systems.find((sys) => sys.id === m.systemId);
        if (!site || !system) return null;
        return evalRx(
          sample.lat,
          sample.lon,
          site,
          system,
          effectiveFrequencyMHz,
          terrainSamples,
          environment,
          terrainSampler,
          options?.terrainCacheKey,
        );
      })
      .filter((v): v is number => v !== null);

    const valueDbm = rxLevels.length ? Math.min(...rxLevels) : -140;

    results.push({ ...sample, valueDbm });
    if ((i + 1) % notifyEvery === 0 || i === samples.length - 1) {
      onProgress?.((i + 1) / total);
    }
  }
  return results;
};

export const buildCoverageAsync = async (
  gridSize: number,
  network: Network,
  sites: Site[],
  systems: RadioSystem[],
  environment: PropagationEnvironment,
  terrainSampler?: (coordinates: Coordinates) => number | null,
  options?: BuildCoverageOptions,
): Promise<CoverageSample[]> => {
  if (sites.length === 0 || systems.length === 0) return [];
  const effectiveFrequencyMHz = network.frequencyOverrideMHz ?? network.frequencyMHz;
  const sampleMultiplier = Math.max(1, options?.sampleMultiplier ?? 1);
  const terrainSamples = Math.max(16, Math.round(options?.terrainSamples ?? 20));
  const onProgress = options?.onProgress;
  const fallbackSystemId = systems[0]?.id ?? "";
  const effectiveMemberships =
    network.memberships
      .filter(
        (member) =>
          sites.some((site) => site.id === member.siteId) &&
          systems.some((system) => system.id === member.systemId),
      )
      .map((member) => ({ siteId: member.siteId, systemId: member.systemId })) || [];
  const membershipsToUse =
    effectiveMemberships.length > 0
      ? effectiveMemberships
      : sites.map((site) => ({ siteId: site.id, systemId: fallbackSystemId }));

  const samples: { lat: number; lon: number }[] = [];
  const bounds = simulationAreaBoundsForSites(sites, {
    overlayRadiusKm: options?.overlayRadiusKm,
    singleSiteRadiusKm: options?.singleSiteRadiusKm,
  });
  if (!bounds) return [];

  const { rows, cols } = computeCoverageGridDimensions(gridSize, bounds, sampleMultiplier);

  for (let y = 0; y < rows; y += 1) {
    const ty = rows <= 1 ? 0 : y / (rows - 1);
    const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * ty;
    for (let x = 0; x < cols; x += 1) {
      const tx = cols <= 1 ? 0 : x / (cols - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tx;
      samples.push({ lat, lon });
    }
  }

  onProgress?.(0);
  const total = Math.max(1, samples.length);
  const notifyEvery = Math.max(1, Math.floor(total / 40));
  const results: CoverageSample[] = [];
  const chunkSize = COVERAGE_COMPUTE_CHUNK_SIZE;
  let chunkStartedAt = performance.now();

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const rxLevels = membershipsToUse
      .map((m) => {
        const site = sites.find((s) => s.id === m.siteId);
        const system = systems.find((sys) => sys.id === m.systemId);
        if (!site || !system) return null;
        return evalRx(
          sample.lat,
          sample.lon,
          site,
          system,
          effectiveFrequencyMHz,
          terrainSamples,
          environment,
          terrainSampler,
          options?.terrainCacheKey,
        );
      })
      .filter((v): v is number => v !== null);

    const valueDbm = rxLevels.length ? Math.min(...rxLevels) : -140;

    results.push({ ...sample, valueDbm });
    if ((i + 1) % notifyEvery === 0 || i === samples.length - 1) {
      onProgress?.((i + 1) / total);
    }
    if ((i + 1) % chunkSize === 0 || performance.now() - chunkStartedAt > COVERAGE_COMPUTE_FRAME_BUDGET_MS) {
      await new Promise<void>((resolve) => {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => resolve());
          return;
        }
        setTimeout(resolve, 0);
      });
      chunkStartedAt = performance.now();
    }
  }
  return results;
};
