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
  shouldCancel?: () => boolean;
  requireCompleteTerrain?: boolean;
};

export class CoverageBuildCancelledError extends Error {
  constructor() {
    super("Coverage build cancelled");
    this.name = "CoverageBuildCancelledError";
  }
}

export class CoverageTerrainUnavailableError extends Error {
  constructor(coordinates: Coordinates) {
    super(
      `Terrain data is unavailable at ${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`,
    );
    this.name = "CoverageTerrainUnavailableError";
  }
}

const requireTerrainSample = (
  terrainSampler: (coordinates: Coordinates) => number | null,
): ((coordinates: Coordinates) => number) =>
  (coordinates) => {
    const elevationM = terrainSampler(coordinates);
    if (elevationM === null) throw new CoverageTerrainUnavailableError(coordinates);
    return elevationM;
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

export type CoverageGridPoint = {
  lat: number;
  lon: number;
};

const COVERAGE_COMPUTE_CHUNK_SIZE = 48;
const COVERAGE_COMPUTE_FRAME_BUDGET_MS = 12;
export const CANONICAL_OVERLAY_PIXELS_PER_BASE_SAMPLE = 174;

export type CalibratedOverlayGridMode =
  | "heatmap"
  | "weakest"
  | "contours"
  | "passfail"
  | "relay"
  | "mesh-extension";

/**
 * Every area overlay shares Pass/Fail's logical grid so the selected
 * resolution always means the same thing. Adaptive evaluation can still
 * reduce the number of expensive RF calculations underneath that grid.
 */
export const resolveOverlayGridWorkloadScale = (
  mode: CalibratedOverlayGridMode,
  participantCount = 1,
): number => {
  void mode;
  void participantCount;
  return 1;
};

export const resolveMeshExtensionCoverageBudgetGridSize = (gridSize: number): number =>
  Math.max(6, Math.round(gridSize));

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

export const computeCanonicalOverlayGridDimensions = (
  gridSize: number,
  bounds: CoverageGridBounds,
  resolutionScale = 1,
): { width: number; height: number; totalSamples: number } => {
  const { rows, cols } = computeCoverageGridDimensions(gridSize, bounds, 1);
  const displaySupersample = Math.sqrt(CANONICAL_OVERLAY_PIXELS_PER_BASE_SAMPLE);
  const width = Math.max(8, Math.min(1400, Math.round(cols * resolutionScale * displaySupersample)));
  const height = Math.max(8, Math.min(1400, Math.round(rows * resolutionScale * displaySupersample)));
  return { width, height, totalSamples: width * height };
};

export const computeCalibratedOverlayGridDimensions = (
  gridSize: number,
  bounds: CoverageGridBounds,
  mode: CalibratedOverlayGridMode,
  resolutionScale = 1,
  participantCount = 1,
): { width: number; height: number; totalSamples: number } =>
  computeCanonicalOverlayGridDimensions(
    gridSize,
    bounds,
    resolutionScale * resolveOverlayGridWorkloadScale(mode, participantCount),
  );

export const resolveCanonicalOverlayResolutionScale = (bounds: CoverageGridBounds): number => {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latSpanKm = Math.abs(bounds.maxLat - bounds.minLat) * 111.32;
  const lonSpanKm =
    Math.abs(bounds.maxLon - bounds.minLon) *
    111.32 *
    Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const diagonalKm = Math.hypot(latSpanKm, lonSpanKm);
  if (diagonalKm > 600) return 0.52;
  if (diagonalKm > 400) return 0.64;
  if (diagonalKm > 250) return 0.76;
  return 1;
};

export const buildCoverageGridPoints = (
  gridSize: number,
  bounds: CoverageGridBounds,
  sampleMultiplier = 1,
): CoverageGridPoint[] => {
  const { rows, cols } = computeCoverageGridDimensions(gridSize, bounds, sampleMultiplier);
  const points: CoverageGridPoint[] = [];
  for (let y = 0; y < rows; y += 1) {
    const ty = rows <= 1 ? 0 : y / (rows - 1);
    const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * ty;
    for (let x = 0; x < cols; x += 1) {
      const tx = cols <= 1 ? 0 : x / (cols - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tx;
      points.push({ lat, lon });
    }
  }
  return points;
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

type ResolvedCoverageMembership = { site: Site; system: RadioSystem };

const resolveCoverageMemberships = (
  network: Network,
  sites: Site[],
  systems: RadioSystem[],
): ResolvedCoverageMembership[] => {
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const systemsById = new Map(systems.map((system) => [system.id, system]));
  const resolved = network.memberships.flatMap((member) => {
    const site = sitesById.get(member.siteId);
    const system = systemsById.get(member.systemId);
    return site && system ? [{ site, system }] : [];
  });
  if (resolved.length) return resolved;
  const fallbackSystem = systems[0];
  return fallbackSystem ? sites.map((site) => ({ site, system: fallbackSystem })) : [];
};

const evaluateCoveragePoint = (
  sample: CoverageGridPoint,
  memberships: ResolvedCoverageMembership[],
  frequencyMHz: number,
  terrainSamples: number,
  environment: PropagationEnvironment,
  terrainSampler?: (coordinates: Coordinates) => number | null,
  terrainCacheKey?: string,
): Pick<CoverageSample, "valueDbm" | "weakestDbm"> => {
  let strongestDbm = Number.NEGATIVE_INFINITY;
  let weakestDbm = Number.POSITIVE_INFINITY;
  for (const { site, system } of memberships) {
    const valueDbm = evalRx(
      sample.lat,
      sample.lon,
      site,
      system,
      frequencyMHz,
      terrainSamples,
      environment,
      terrainSampler,
      terrainCacheKey,
    );
    strongestDbm = Math.max(strongestDbm, valueDbm);
    weakestDbm = Math.min(weakestDbm, valueDbm);
  }
  return {
    valueDbm: Number.isFinite(strongestDbm) ? strongestDbm : -140,
    weakestDbm: Number.isFinite(weakestDbm) ? weakestDbm : -140,
  };
};

export type CoverageContributorEvaluator = {
  id: string;
  evaluatePoint: (lat: number, lon: number) => number;
};

export const createCoverageContributorEvaluators = (
  network: Network,
  sites: Site[],
  systems: RadioSystem[],
  environment: PropagationEnvironment,
  terrainSampler?: (coordinates: Coordinates) => number | null,
  options?: Pick<BuildCoverageOptions, "terrainSamples" | "terrainCacheKey" | "requireCompleteTerrain">,
): CoverageContributorEvaluator[] => {
  const memberships = resolveCoverageMemberships(network, sites, systems);
  const frequencyMHz = network.frequencyOverrideMHz ?? network.frequencyMHz;
  const terrainSamples = Math.max(16, Math.round(options?.terrainSamples ?? 20));
  const effectiveTerrainSampler =
    terrainSampler && options?.requireCompleteTerrain
      ? requireTerrainSample(terrainSampler)
      : terrainSampler;
  return memberships.map(({ site, system }) => ({
    id: `${site.id}:${system.id}`,
    evaluatePoint: (lat, lon) =>
      evalRx(
        lat,
        lon,
        site,
        system,
        frequencyMHz,
        terrainSamples,
        environment,
        effectiveTerrainSampler,
        options?.terrainCacheKey,
      ),
  }));
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
  const effectiveTerrainSampler =
    terrainSampler && options?.requireCompleteTerrain
      ? requireTerrainSample(terrainSampler)
      : terrainSampler;
  const onProgress = options?.onProgress;
  const shouldCancel = options?.shouldCancel;
  const membershipsToUse = resolveCoverageMemberships(network, sites, systems);

  const bounds = simulationAreaBoundsForSites(sites, {
    overlayRadiusKm: options?.overlayRadiusKm,
    singleSiteRadiusKm: options?.singleSiteRadiusKm,
  });
  if (!bounds) return [];
  const samples = buildCoverageGridPoints(gridSize, bounds, sampleMultiplier);

  onProgress?.(0);
  const total = Math.max(1, samples.length);
  const notifyEvery = Math.max(1, Math.floor(total / 40));
  const results: CoverageSample[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (shouldCancel?.()) throw new CoverageBuildCancelledError();
    const sample = samples[i];
    const levels = evaluateCoveragePoint(
      sample,
      membershipsToUse,
      effectiveFrequencyMHz,
      terrainSamples,
      environment,
      effectiveTerrainSampler,
      options?.terrainCacheKey,
    );
    results.push({ ...sample, ...levels });
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
  const effectiveTerrainSampler =
    terrainSampler && options?.requireCompleteTerrain
      ? requireTerrainSample(terrainSampler)
      : terrainSampler;
  const onProgress = options?.onProgress;
  const shouldCancel = options?.shouldCancel;
  const membershipsToUse = resolveCoverageMemberships(network, sites, systems);

  const bounds = simulationAreaBoundsForSites(sites, {
    overlayRadiusKm: options?.overlayRadiusKm,
    singleSiteRadiusKm: options?.singleSiteRadiusKm,
  });
  if (!bounds) return [];
  const samples = buildCoverageGridPoints(gridSize, bounds, sampleMultiplier);

  onProgress?.(0);
  const total = Math.max(1, samples.length);
  const notifyEvery = Math.max(1, Math.floor(total / 40));
  const results: CoverageSample[] = [];
  const chunkSize = COVERAGE_COMPUTE_CHUNK_SIZE;
  let chunkStartedAt = performance.now();

  for (let i = 0; i < samples.length; i += 1) {
    if (shouldCancel?.()) throw new CoverageBuildCancelledError();
    const sample = samples[i];
    const levels = evaluateCoveragePoint(
      sample,
      membershipsToUse,
      effectiveFrequencyMHz,
      terrainSamples,
      environment,
      effectiveTerrainSampler,
      options?.terrainCacheKey,
    );
    results.push({ ...sample, ...levels });
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
      if (shouldCancel?.()) throw new CoverageBuildCancelledError();
      chunkStartedAt = performance.now();
    }
  }
  return results;
};
