import { classifyPassFailState, computeSourceCentricRxMetrics } from "./passFailState";
import { STANDARD_SITE_RADIO } from "./linkRadio";
import type { Link, PropagationEnvironment, Site } from "../types/radio";
import { interpolateHeatmapColor } from "../themes/heatmapColors";

export type TerrainBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type CoverageSampleLite = { lat: number; lon: number; valueDbm: number };

export type CoverageOverlayOptions = {
  rxTargetDbm?: number;
};

export type OverlayRasterPixels = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  minDbm?: number;
  maxDbm?: number;
};

export type OverlayRasterDataUrl = {
  url: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  minDbm?: number;
  maxDbm?: number;
};

export type OverlayTaskContext = {
  phase: string;
  signature: string;
  frameBudgetMs?: number;
  longTaskMs?: number;
  shouldCancel?: () => boolean;
  onLongTask?: (payload: {
    phase: string;
    signature: string;
    durationMs: number;
    processed: number;
    total: number;
  }) => void;
  onProgress?: (payload: {
    phase: string;
    signature: string;
    processed: number;
    total: number;
    percent: number;
  }) => void;
};

const DEFAULT_FRAME_BUDGET_MS = 8;
const DEFAULT_LONG_TASK_MS = 28;

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const nextFrame = async (): Promise<void> => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const MAX_MERCATOR_LAT = 85.05112878;
const mercatorYForLatitude = (lat: number): number => {
  const radians = (clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
};
const latitudeForMercatorY = (mercatorY: number): number =>
  ((2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2) * 180) / Math.PI;

export const latitudeForRasterRow = (
  row: number,
  height: number,
  minLat: number,
  maxLat: number,
): number => {
  const divisor = Math.max(1, height - 1);
  const fraction = clamp(row / divisor, 0, 1);
  return latitudeForMercatorY(lerp(mercatorYForLatitude(maxLat), mercatorYForLatitude(minLat), fraction));
};

const overlayCoordinates = (bounds: TerrainBounds): OverlayRasterPixels["coordinates"] => [
  [bounds.minLon, bounds.maxLat],
  [bounds.maxLon, bounds.maxLat],
  [bounds.maxLon, bounds.minLat],
  [bounds.minLon, bounds.minLat],
];

export class OverlayTaskCancelledError extends Error {
  constructor() {
    super("overlay-task-cancelled");
    this.name = "OverlayTaskCancelledError";
  }
}

const throwIfCancelled = (context?: OverlayTaskContext): void => {
  if (context?.shouldCancel?.()) throw new OverlayTaskCancelledError();
};

const runCooperativeLoop = async (
  total: number,
  runner: (index: number) => void,
  context?: OverlayTaskContext,
): Promise<void> => {
  let processed = 0;
  const frameBudgetMs = Math.max(1, context?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS);
  const longTaskMs = Math.max(frameBudgetMs, context?.longTaskMs ?? DEFAULT_LONG_TASK_MS);

  while (processed < total) {
    throwIfCancelled(context);
    const chunkStartedAt = nowMs();

    while (processed < total) {
      runner(processed);
      processed += 1;
      throwIfCancelled(context);
      if (nowMs() - chunkStartedAt >= frameBudgetMs) {
        break;
      }
    }

    const chunkDuration = nowMs() - chunkStartedAt;
    if (chunkDuration >= longTaskMs) {
      context?.onLongTask?.({
        phase: context.phase,
        signature: context.signature,
        durationMs: chunkDuration,
        processed,
        total,
      });
    }

    if (total > 0) {
      context?.onProgress?.({
        phase: context.phase,
        signature: context.signature,
        processed,
        total,
        percent: Math.round((processed / total) * 100),
      });
    }

    if (processed < total) {
      await nextFrame();
    }
  }

  if (total > 0 && processed >= total) {
    context?.onProgress?.({
      phase: context.phase,
      signature: context.signature,
      processed: total,
      total,
      percent: 100,
    });
  }
};

const precomputeGridAxes = (
  bounds: TerrainBounds,
  dimensions: { width: number; height: number },
): { latByRow: Float64Array; lonByCol: Float64Array } => {
  const width = dimensions.width;
  const height = dimensions.height;
  const latByRow = new Float64Array(height);
  const lonByCol = new Float64Array(width);
  const lonSpan = bounds.maxLon - bounds.minLon;
  const widthDivisor = Math.max(1, width - 1);

  for (let y = 0; y < height; y += 1) {
    latByRow[y] = latitudeForRasterRow(y, height, bounds.minLat, bounds.maxLat);
  }
  for (let x = 0; x < width; x += 1) {
    lonByCol[x] = bounds.minLon + lonSpan * (x / widthDivisor);
  }

  return { latByRow, lonByCol };
};

export type CoverageRxTargetScale = { min: number; max: number };

const percentile = (values: number[], ratio: number): number => {
  if (!values.length) return 0;
  const index = clamp((values.length - 1) * ratio, 0, values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return lerp(values[lower], values[upper], index - lower);
};

export const computeCoverageRxTargetScale = (
  samples: CoverageSampleLite[],
  rxTargetDbm: number,
): CoverageRxTargetScale => {
  const values = samples
    .map((sample) => sample.valueDbm)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length || !Number.isFinite(rxTargetDbm)) {
    const target = Number.isFinite(rxTargetDbm) ? rxTargetDbm : -120;
    return { min: target - 30, max: target + 30 };
  }
  const low = percentile(values, 0.05);
  const high = percentile(values, 0.95);
  const span = clamp(Math.max(rxTargetDbm - low, high - rxTargetDbm, 20), 20, 55);
  return { min: rxTargetDbm - span, max: rxTargetDbm + span };
};

export const normalizeCoverageDbmForRxTarget = (
  valueDbm: number,
  rxTargetDbm: number,
  scale: CoverageRxTargetScale = { min: rxTargetDbm - 20, max: rxTargetDbm + 30 },
): number => {
  const min = scale.min;
  const max = scale.max;
  return clamp((valueDbm - min) / (max - min), 0, 1);
};

const coverageColorForNormalized = (normalized: number): [number, number, number] => {
  const color = interpolateHeatmapColor(normalized);
  return [color.r, color.g, color.b];
};

const coverageColorForDbm = (valueDbm: number): [number, number, number] =>
  coverageColorForNormalized((valueDbm + 125) / 63);

const computeCoverageAdaptiveScale = (
  samples: CoverageSampleLite[],
): { min: number; range: number } | null => {
  if (samples.length < 2) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample.valueDbm);
    max = Math.max(max, sample.valueDbm);
  }
  return {
    min,
    range: Math.max(6, max - min),
  };
};

const coverageColorAdaptive = (
  valueDbm: number,
  scale: { min: number; range: number } | null,
): [number, number, number] => {
  if (!scale) return coverageColorForDbm(valueDbm);
  const normalized = -125 + ((valueDbm - scale.min) / scale.range) * 63;
  return coverageColorForDbm(clamp(normalized, -125, -62));
};

const coverageColorFixed = (
  valueDbm: number,
  rxTargetDbm: number,
  scale?: CoverageRxTargetScale,
): [number, number, number] =>
  coverageColorForNormalized(normalizeCoverageDbmForRxTarget(valueDbm, rxTargetDbm, scale));

const interpolateCoverageDbm = (samples: CoverageSampleLite[], lat: number, lon: number): number | null => {
  if (!samples.length) return null;
  let weightSum = 0;
  let valueSum = 0;
  for (const sample of samples) {
    const dLat = sample.lat - lat;
    const dLon = sample.lon - lon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < 1e-12) return sample.valueDbm;
    const weight = 1 / d2;
    weightSum += weight;
    valueSum += sample.valueDbm * weight;
  }
  if (weightSum <= 0) return null;
  return valueSum / weightSum;
};

const binarySearchFloor = (values: number[], target: number): number => {
  let lo = 0;
  let hi = values.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = values[mid];
    if (value <= target) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return clamp(hi, 0, values.length - 1);
};

const makeGridInterpolator = (
  samples: CoverageSampleLite[],
): ((lat: number, lon: number) => number | null) | null => {
  if (samples.length < 4) return null;
  const latSet = new Set<number>();
  const lonSet = new Set<number>();
  for (const sample of samples) {
    latSet.add(sample.lat);
    lonSet.add(sample.lon);
  }
  const lats = Array.from(latSet).sort((a, b) => a - b);
  const lons = Array.from(lonSet).sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  if (lats.length * lons.length !== samples.length) return null;

  const latIndex = new globalThis.Map<number, number>();
  const lonIndex = new globalThis.Map<number, number>();
  lats.forEach((value, index) => latIndex.set(value, index));
  lons.forEach((value, index) => lonIndex.set(value, index));

  const values = new Float64Array(lats.length * lons.length);
  const seen = new Uint8Array(lats.length * lons.length);
  for (const sample of samples) {
    const yi = latIndex.get(sample.lat);
    const xi = lonIndex.get(sample.lon);
    if (yi === undefined || xi === undefined) return null;
    const idx = yi * lons.length + xi;
    values[idx] = sample.valueDbm;
    seen[idx] = 1;
  }
  for (const mark of seen) {
    if (mark !== 1) return null;
  }

  return (lat, lon) => {
    const latClamped = clamp(lat, lats[0], lats[lats.length - 1]);
    const lonClamped = clamp(lon, lons[0], lons[lons.length - 1]);
    const y0 = binarySearchFloor(lats, latClamped);
    const x0 = binarySearchFloor(lons, lonClamped);
    const y1 = Math.min(y0 + 1, lats.length - 1);
    const x1 = Math.min(x0 + 1, lons.length - 1);

    const lat0 = lats[y0];
    const lat1 = lats[y1];
    const lon0 = lons[x0];
    const lon1 = lons[x1];
    const ty = lat1 === lat0 ? 0 : (latClamped - lat0) / (lat1 - lat0);
    const tx = lon1 === lon0 ? 0 : (lonClamped - lon0) / (lon1 - lon0);

    const q00 = values[y0 * lons.length + x0];
    const q10 = values[y0 * lons.length + x1];
    const q01 = values[y1 * lons.length + x0];
    const q11 = values[y1 * lons.length + x1];
    const a = q00 + (q10 - q00) * tx;
    const b = q01 + (q11 - q01) * tx;
    return a + (b - a) * ty;
  };
};

const computeSourceCentricRxDbm = (
  lat: number,
  lon: number,
  fromSite: Site,
  effectiveLink: Link,
  receiverAntennaHeightM: number,
  receiverRxGainDbi: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
  propagationEnvironment: PropagationEnvironment,
): number =>
  computeSourceCentricRxMetrics(
    lat,
    lon,
    fromSite,
    effectiveLink,
    receiverAntennaHeightM,
    receiverRxGainDbi,
    terrainSampler,
    terrainSamples,
    propagationEnvironment,
  ).rxDbm;

export const buildCoverageOverlayPixelsAsync = async (
  bounds: TerrainBounds,
  samples: CoverageSampleLite[],
  mode: "heatmap" | "contours",
  bandStepDb: number,
  dimensions: { width: number; height: number },
  pointMask?: (lat: number, lon: number) => boolean,
  terrainSampler?: (lat: number, lon: number) => number | null,
  context?: OverlayTaskContext,
  options?: CoverageOverlayOptions,
): Promise<OverlayRasterPixels | null> => {
  if (!samples.length) return null;
  const gridInterpolator = makeGridInterpolator(samples);
  const width = dimensions.width;
  const height = dimensions.height;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const rxTargetDbm = options?.rxTargetDbm;
  const adaptiveScale = rxTargetDbm === undefined ? computeCoverageAdaptiveScale(samples) : null;
  const rxTargetScale = rxTargetDbm === undefined ? null : computeCoverageRxTargetScale(samples, rxTargetDbm);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const valueAt = (lat: number, lon: number): number | null =>
    gridInterpolator ? gridInterpolator(lat, lon) : interpolateCoverageDbm(samples, lat, lon);

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const lat = latByRow[y];
      const lon = lonByCol[x];
      if (pointMask && !pointMask(lat, lon)) return;
      if (terrainSampler && terrainSampler(lat, lon) === null) return;
      const valueDbm = valueAt(lat, lon);
      if (valueDbm === null) return;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 180;
      if (mode === "heatmap") {
        [r, g, b] = rxTargetDbm === undefined
          ? coverageColorAdaptive(valueDbm, adaptiveScale)
          : coverageColorFixed(valueDbm, rxTargetDbm, rxTargetScale ?? undefined);
      } else {
        const target = rxTargetDbm;
        if (target === undefined) {
          const banded = Math.round(valueDbm / Math.max(1, bandStepDb)) * Math.max(1, bandStepDb);
          [r, g, b] = coverageColorAdaptive(banded, adaptiveScale);
          a = 170;
        } else {
          const toleranceDb = 1.25;
          const nextLon = lonByCol[Math.min(width - 1, x + 1)];
          const nextLat = latByRow[Math.min(height - 1, y + 1)];
          const rightValue = x < width - 1 ? valueAt(lat, nextLon) : null;
          const downValue = y < height - 1 ? valueAt(nextLat, lon) : null;
          const crossesRight = rightValue !== null && (valueDbm - target) * (rightValue - target) <= 0;
          const crossesDown = downValue !== null && (valueDbm - target) * (downValue - target) <= 0;
          if (Math.abs(valueDbm - target) > toleranceDb && !crossesRight && !crossesDown) return;
          [r, g, b] = coverageColorFixed(target, target, rxTargetScale ?? undefined);
          a = 230;
        }
      }

      const px = index * 4;
      pixels[px] = r;
      pixels[px + 1] = g;
      pixels[px + 2] = b;
      pixels[px + 3] = a;
    },
    context,
  );

  return {
    width,
    height,
    pixels,
    coordinates: overlayCoordinates(bounds),
    minDbm: rxTargetScale?.min,
    maxDbm: rxTargetScale?.max,
  };
};

export const buildSourcePassFailOverlayPixelsAsync = async (
  bounds: TerrainBounds,
  fromSite: Site,
  effectiveLink: Link,
  receiverAntennaHeightM: number,
  receiverRxGainDbi: number,
  propagationEnvironment: PropagationEnvironment,
  rxTargetDbm: number,
  environmentLossDb: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  terrainSamples: number,
  pointMask?: (lat: number, lon: number) => boolean,
  context?: OverlayTaskContext,
): Promise<OverlayRasterPixels | null> => {
  const width = dimensions.width;
  const height = dimensions.height;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const pixels = new Uint8ClampedArray(width * height * 4);

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const lat = latByRow[y];
      const lon = lonByCol[x];
      if (pointMask && !pointMask(lat, lon)) return;
      if (terrainSampler(lat, lon) === null) return;

      const metrics = computeSourceCentricRxMetrics(
        lat,
        lon,
        fromSite,
        effectiveLink,
        receiverAntennaHeightM,
        receiverRxGainDbi,
        terrainSampler,
        terrainSamples,
        propagationEnvironment,
      );
      const pass = metrics.rxDbm - environmentLossDb >= rxTargetDbm;
      const losBlocked = metrics.terrainObstructed;
      const state = classifyPassFailState(pass, losBlocked);

      const px = index * 4;
      if (state === "pass_clear") {
        pixels[px] = 82;
        pixels[px + 1] = 181;
        pixels[px + 2] = 96;
      } else if (state === "pass_blocked") {
        pixels[px] = 232;
        pixels[px + 1] = 170;
        pixels[px + 2] = 72;
      } else if (state === "fail_clear") {
        pixels[px] = 235;
        pixels[px + 1] = 120;
        pixels[px + 2] = 70;
      } else {
        pixels[px] = 205;
        pixels[px + 1] = 87;
        pixels[px + 2] = 79;
      }
      pixels[px + 3] = 162;
    },
    context,
  );

  return {
    width,
    height,
    pixels,
    coordinates: overlayCoordinates(bounds),
  };
};

export const buildRelayCandidateOverlayPixelsAsync = async (
  bounds: TerrainBounds,
  fromSite: Site,
  toSite: Site,
  effectiveLink: Link,
  propagationEnvironment: PropagationEnvironment,
  environmentLossDb: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  terrainSamples: number,
  pointMask?: (lat: number, lon: number) => boolean,
  context?: OverlayTaskContext,
): Promise<OverlayRasterPixels | null> => {
  const width = dimensions.width;
  const height = dimensions.height;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const relayAntennaHeightM = Math.max(2, (fromSite.antennaHeightM + toSite.antennaHeightM) / 2);
  const fallbackRelayGround = (fromSite.groundElevationM + toSite.groundElevationM) / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const bottleneck = new Float32Array(width * height).fill(-Infinity);
  const relaySite: Site = {
    id: "__relay_candidate__",
    name: "Relay candidate",
    position: { lat: fromSite.position.lat, lon: fromSite.position.lon },
    antennaHeightM: relayAntennaHeightM,
    groundElevationM: fallbackRelayGround,
    txPowerDbm: STANDARD_SITE_RADIO.txPowerDbm,
    txGainDbi: STANDARD_SITE_RADIO.txGainDbi,
    rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
    cableLossDb: STANDARD_SITE_RADIO.cableLossDb,
  };
  let minDbm = Number.POSITIVE_INFINITY;
  let maxDbm = Number.NEGATIVE_INFINITY;

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const lat = latByRow[y];
      const lon = lonByCol[x];
      if (pointMask && !pointMask(lat, lon)) return;

      const sampledGround = terrainSampler(lat, lon);
      if (sampledGround === null) return;
      const relayGround = sampledGround ?? fallbackRelayGround;
      relaySite.position.lat = lat;
      relaySite.position.lon = lon;
      relaySite.groundElevationM = relayGround;

      const fromToRelayRx = computeSourceCentricRxDbm(
        lat,
        lon,
        fromSite,
        effectiveLink,
        relayAntennaHeightM,
        relaySite.rxGainDbi,
        terrainSampler,
        terrainSamples,
        propagationEnvironment,
      );
      const relayToTargetRx = computeSourceCentricRxDbm(
        toSite.position.lat,
        toSite.position.lon,
        relaySite,
        effectiveLink,
        toSite.antennaHeightM,
        toSite.rxGainDbi,
        terrainSampler,
        terrainSamples,
        propagationEnvironment,
      );
      const bottleneckDbm = Math.min(fromToRelayRx, relayToTargetRx) - environmentLossDb;

      bottleneck[index] = bottleneckDbm;
      minDbm = Math.min(minDbm, bottleneckDbm);
      maxDbm = Math.max(maxDbm, bottleneckDbm);
    },
    context,
  );

  if (!Number.isFinite(minDbm) || !Number.isFinite(maxDbm)) return null;
  const dynamicRange = Math.max(6, maxDbm - minDbm);

  await runCooperativeLoop(
    width * height,
    (index) => {
      const value = bottleneck[index];
      if (!Number.isFinite(value)) return;
      const normalized = -125 + ((value - minDbm) / dynamicRange) * 63;
      const [r, g, b] = coverageColorForDbm(clamp(normalized, -125, -62));
      const px = index * 4;
      pixels[px] = r;
      pixels[px + 1] = g;
      pixels[px + 2] = b;
      pixels[px + 3] = 172;
    },
    context,
  );

  return {
    width,
    height,
    pixels,
    coordinates: overlayCoordinates(bounds),
    minDbm,
    maxDbm,
  };
};

export const buildTerrainShadeOverlayPixelsAsync = async (
  bounds: TerrainBounds,
  sampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  pointMask?: (lat: number, lon: number) => boolean,
  context?: OverlayTaskContext,
): Promise<OverlayRasterPixels | null> => {
  const width = dimensions.width;
  const height = dimensions.height;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const elevations = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  const allowed = new Uint8Array(width * height);
  const pixels = new Uint8ClampedArray(width * height * 4);

  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const lat = latByRow[y];
      const lon = lonByCol[x];
      const isAllowed = pointMask ? pointMask(lat, lon) : true;
      const elevation = sampler(lat, lon);

      if (isAllowed) {
        allowed[index] = 1;
      }
      if (!isAllowed || elevation === null) return;

      elevations[index] = elevation;
      valid[index] = 1;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    },
    context,
  );

  if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) return null;

  for (let pass = 0; pass < 3; pass += 1) {
    await runCooperativeLoop(
      width * height,
      (index) => {
        const y = Math.floor(index / width);
        const x = index - y * width;
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;
        if (!allowed[index] || valid[index]) return;

        const neighbors = [index - 1, index + 1, index - width, index + width];
        let sum = 0;
        let count = 0;
        for (const neighbor of neighbors) {
          if (!allowed[neighbor] || !valid[neighbor]) continue;
          sum += elevations[neighbor];
          count += 1;
        }
        if (!count) return;
        elevations[index] = sum / count;
        valid[index] = 1;
      },
      context,
    );
  }

  const lightAzimuthRad = (315 * Math.PI) / 180;
  const lightAltitudeRad = (45 * Math.PI) / 180;
  const lx = Math.cos(lightAltitudeRad) * Math.sin(lightAzimuthRad);
  const ly = Math.cos(lightAltitudeRad) * Math.cos(lightAzimuthRad);
  const lz = Math.sin(lightAltitudeRad);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const metersPerLon =
    ((bounds.maxLon - bounds.minLon) * 111_320 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180))) /
    Math.max(1, width - 1);
  const metersPerLat = ((bounds.maxLat - bounds.minLat) * 111_320) / Math.max(1, height - 1);
  const range = Math.max(1, maxElevation - minElevation);

  await runCooperativeLoop(
    width * height,
    (index) => {
      if (!allowed[index] || !valid[index]) {
        pixels[index * 4 + 3] = 0;
        return;
      }
      const y = Math.floor(index / width);
      const x = index - y * width;
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      const left = elevations[y * width + x0];
      const right = elevations[y * width + x1];
      const top = elevations[y0 * width + x];
      const bottom = elevations[y1 * width + x];

      const dzdx = (right - left) / Math.max(1, (x1 - x0) * metersPerLon);
      const dzdy = (bottom - top) / Math.max(1, (y1 - y0) * metersPerLat);

      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1;
      const norm = Math.hypot(nx, ny, nz) || 1;
      const shade = Math.max(0, (nx * lx + ny * ly + nz * lz) / norm);

      const elevationNorm = (elevations[index] - minElevation) / range;
      const base = 58 + elevationNorm * 112;
      const lit = clamp(base * 0.65 + shade * 145, 0, 255);

      const px = index * 4;
      pixels[px] = lit * 0.95;
      pixels[px + 1] = lit;
      pixels[px + 2] = lit * 1.04;
      pixels[px + 3] = 210;
    },
    context,
  );

  return {
    width,
    height,
    pixels,
    coordinates: overlayCoordinates(bounds),
  };
};

export const overlayPixelsToDataUrl = (raster: OverlayRasterPixels): OverlayRasterDataUrl | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(raster.width, raster.height);
  image.data.set(raster.pixels);
  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    coordinates: raster.coordinates,
    minDbm: raster.minDbm,
    maxDbm: raster.maxDbm,
  };
};
