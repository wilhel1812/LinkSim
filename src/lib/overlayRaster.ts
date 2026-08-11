import { classifyPassFailState, computeSourceCentricRxMetrics } from "./passFailState";
import { STANDARD_SITE_RADIO } from "./linkRadio";
import { effectiveGainTowardSiteDbi } from "./antennaPattern";
import {
  buildCoverageGridPoints,
  computeCoverageGridDimensions,
  type CoverageContributorEvaluator,
} from "./coverage";
import { haversineDistanceKm } from "./geo";
import { getPathLossDb } from "./rfModels";
import type { Link, PropagationEnvironment, Site } from "../types/radio";
import { interpolateHeatmapColor } from "../themes/heatmapColors";
import { createLruCache } from "./lruCache";

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

export type AdaptiveCoverageOverlayInput = {
  bounds: TerrainBounds;
  dimensions: { width: number; height: number };
  initialGridSize: number;
  mode: "heatmap" | "weakest" | "contours";
  rxTargetDbm: number;
  contributors: readonly CoverageContributorEvaluator[];
  pointMask?: (lat: number, lon: number) => boolean;
  context?: OverlayTaskContext;
  adaptive?: boolean;
  analysisCacheKey?: string;
};

export type OverlayRasterPixels = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  minDbm?: number;
  maxDbm?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
  analysisStats?: OverlayAnalysisStats;
  signalValuesDbm?: Float32Array;
};

export type OverlayAnalysisStats = {
  evaluatedPaths: number;
  refinedBlocks: number;
  filledPixels: number;
  totalPixels: number;
};

export type AdaptiveOverlayOptions = {
  adaptive?: boolean;
  analysisCacheKey?: string;
};

export type OverlayRasterDataUrl = {
  url: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  minDbm?: number;
  maxDbm?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
};

export type MeshExtensionCandidateProfile = {
  antennaHeightM: number;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
};

export type MeshExtensionPeerSignals = {
  selectedToCandidateDbm: number;
  candidateToSelectedDbm: number;
};

export type MeshExtensionOverlayInput = {
  bounds: TerrainBounds;
  selectedSites: Site[];
  frequencyMHz: number;
  propagationEnvironment: PropagationEnvironment;
  rxTargetDbm: number;
  environmentLossDb: number;
  terrainSampler: (lat: number, lon: number) => number | null;
  dimensions: { width: number; height: number };
  candidateGridSize: number;
  coverageGridSize?: number;
  terrainSamples: number;
  pointMask?: (lat: number, lon: number) => boolean;
  context?: OverlayTaskContext;
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
const COVERAGE_ADAPTIVE_ERROR_DB = 1.15;
const PASS_FAIL_BOUNDARY_MARGIN_DB = 5;
const PASS_FAIL_DENSE_SAMPLE_MIN_SPAN_PX = 9;

type PassFailMetricCache = {
  width: number;
  height: number;
  rxDbm: Float64Array;
  obstruction: Int8Array;
  evaluated: Uint8Array;
};

type CoverageMetricCache = {
  width: number;
  height: number;
  valuesDbm: Float32Array;
};

type RelayMetricCache = {
  width: number;
  height: number;
  baseDbm: Float64Array;
  evaluated: Uint8Array;
};

const passFailMetricCache = createLruCache<PassFailMetricCache>(2);
const relayMetricCache = createLruCache<RelayMetricCache>(2);
const coverageMetricCache = createLruCache<CoverageMetricCache>(2);

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

const contextForProgressRange = (
  context: OverlayTaskContext | undefined,
  startPercent: number,
  endPercent: number,
): OverlayTaskContext | undefined => {
  if (!context) return undefined;
  return {
    ...context,
    onProgress: context.onProgress
      ? (payload) =>
          context.onProgress?.({
            ...payload,
            percent: Math.round(lerp(startPercent, endPercent, payload.percent / 100)),
          })
      : undefined,
  };
};

type RasterBlock = { x0: number; x1: number; y0: number; y1: number };

const rasterBlockArea = (block: RasterBlock): number =>
  Math.max(0, block.x1 - block.x0) * Math.max(0, block.y1 - block.y0);

const partitionRasterBlocks = (
  width: number,
  height: number,
  gridSize: number,
  bounds: TerrainBounds,
): RasterBlock[] => {
  const dimensions = computeCoverageGridDimensions(gridSize, bounds);
  return partitionRasterBlocksByCount(width, height, dimensions.rows, dimensions.cols);
};

const partitionRasterBlocksByCount = (
  width: number,
  height: number,
  requestedRows: number,
  requestedCols: number,
): RasterBlock[] => {
  const rowPartitions = Math.max(1, Math.min(height, requestedRows));
  const colPartitions = Math.max(1, Math.min(width, requestedCols));
  const blocks: RasterBlock[] = [];
  for (let row = 0; row < rowPartitions; row += 1) {
    const y0 = Math.floor((row * height) / rowPartitions);
    const y1 = Math.floor(((row + 1) * height) / rowPartitions);
    for (let col = 0; col < colPartitions; col += 1) {
      const x0 = Math.floor((col * width) / colPartitions);
      const x1 = Math.floor(((col + 1) * width) / colPartitions);
      if (x1 > x0 && y1 > y0) blocks.push({ x0, x1, y0, y1 });
    }
  }
  return blocks;
};

const partitionAdaptiveCoverageBlocks = (
  width: number,
  height: number,
  seedGridSize: number,
): RasterBlock[] => {
  const targetBlocks = Math.max(16, Math.round(seedGridSize * seedGridSize));
  const aspect = Math.max(0.2, Math.min(5, width / Math.max(1, height)));
  const cols = Math.max(2, Math.round(Math.sqrt(targetBlocks * aspect)));
  const rows = Math.max(2, Math.round(targetBlocks / cols));
  return partitionRasterBlocksByCount(width, height, rows, cols);
};

const splitRasterBlock = (block: RasterBlock): RasterBlock[] => {
  const xMid = block.x0 + Math.ceil((block.x1 - block.x0) / 2);
  const yMid = block.y0 + Math.ceil((block.y1 - block.y0) / 2);
  const xRanges: Array<[number, number]> = xMid < block.x1
    ? [[block.x0, xMid], [xMid, block.x1]]
    : [[block.x0, block.x1]];
  const yRanges: Array<[number, number]> = yMid < block.y1
    ? [[block.y0, yMid], [yMid, block.y1]]
    : [[block.y0, block.y1]];
  return yRanges.flatMap(([y0, y1]) => xRanges.map(([x0, x1]) => ({ x0, x1, y0, y1 })));
};

const sampleIndicesForRasterBlock = (block: RasterBlock, width: number): number[] => {
  const xLast = block.x1 - 1;
  const yLast = block.y1 - 1;
  const xMid = Math.floor((block.x0 + xLast) / 2);
  const yMid = Math.floor((block.y0 + yLast) / 2);
  return Array.from(new Set([
    block.y0 * width + block.x0,
    block.y0 * width + xLast,
    yLast * width + block.x0,
    yLast * width + xLast,
    yMid * width + xMid,
  ]));
};

const passFailSampleIndicesForRasterBlock = (block: RasterBlock, width: number): number[] => {
  const baseIndices = sampleIndicesForRasterBlock(block, width);
  if (
    block.x1 - block.x0 < PASS_FAIL_DENSE_SAMPLE_MIN_SPAN_PX &&
    block.y1 - block.y0 < PASS_FAIL_DENSE_SAMPLE_MIN_SPAN_PX
  ) return baseIndices;
  const xLast = block.x1 - 1;
  const yLast = block.y1 - 1;
  const xMid = Math.floor((block.x0 + xLast) / 2);
  const yMid = Math.floor((block.y0 + yLast) / 2);
  return Array.from(new Set([
    ...baseIndices,
    block.y0 * width + xMid,
    yLast * width + xMid,
    yMid * width + block.x0,
    yMid * width + xLast,
  ]));
};

const runAdaptiveBlockQueue = async (
  blocks: RasterBlock[],
  totalPixels: number,
  process: (block: RasterBlock) => RasterBlock[] | null | Promise<RasterBlock[] | null>,
  context?: OverlayTaskContext,
): Promise<{ refinedBlocks: number; filledPixels: number }> => {
  const queue = blocks.slice().reverse();
  let refinedBlocks = 0;
  let filledPixels = 0;
  const frameBudgetMs = Math.max(1, context?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS);
  const longTaskMs = Math.max(frameBudgetMs, context?.longTaskMs ?? DEFAULT_LONG_TASK_MS);
  let chunkStartedAt = nowMs();

  while (queue.length) {
    throwIfCancelled(context);
    const block = queue.pop()!;
    const children = await process(block);
    if (children?.length) {
      refinedBlocks += 1;
      for (let index = children.length - 1; index >= 0; index -= 1) queue.push(children[index]);
    } else {
      filledPixels += rasterBlockArea(block);
    }

    const durationMs = nowMs() - chunkStartedAt;
    if (durationMs >= frameBudgetMs && queue.length) {
      if (durationMs >= longTaskMs) {
        context?.onLongTask?.({
          phase: context.phase,
          signature: context.signature,
          durationMs,
          processed: filledPixels,
          total: totalPixels,
        });
      }
      context?.onProgress?.({
        phase: context.phase,
        signature: context.signature,
        processed: filledPixels,
        total: totalPixels,
        percent: Math.round((filledPixels / Math.max(1, totalPixels)) * 100),
      });
      await nextFrame();
      chunkStartedAt = nowMs();
    }
  }

  context?.onProgress?.({
    phase: context.phase,
    signature: context.signature,
    processed: totalPixels,
    total: totalPixels,
    percent: 100,
  });
  return { refinedBlocks, filledPixels };
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

const median = (values: number[], fallback: number): number => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return fallback;
  const midpoint = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[midpoint - 1] + finite[midpoint]) / 2 : finite[midpoint];
};

export const deriveMeshExtensionCandidateProfile = (selectedSites: Site[]): MeshExtensionCandidateProfile => ({
  antennaHeightM: median(selectedSites.map((site) => site.antennaHeightM), 2),
  txPowerDbm: median(selectedSites.map((site) => site.txPowerDbm), STANDARD_SITE_RADIO.txPowerDbm),
  txGainDbi: median(selectedSites.map((site) => site.txGainDbi), STANDARD_SITE_RADIO.txGainDbi),
  rxGainDbi: median(selectedSites.map((site) => site.rxGainDbi), STANDARD_SITE_RADIO.rxGainDbi),
  cableLossDb: median(selectedSites.map((site) => site.cableLossDb), STANDARD_SITE_RADIO.cableLossDb),
});

export const strongestBidirectionalPeerDbm = (signals: MeshExtensionPeerSignals[]): number =>
  signals.reduce(
    (strongest, signal) =>
      Math.max(strongest, Math.min(signal.selectedToCandidateDbm, signal.candidateToSelectedDbm)),
    Number.NEGATIVE_INFINITY,
  );

export const meshExtensionAlphaForDbm = (
  valueDbm: number,
  rxTargetDbm: number,
  scale: CoverageRxTargetScale,
): number => {
  if (!Number.isFinite(valueDbm) || valueDbm < rxTargetDbm) return 0;
  const above = clamp((valueDbm - rxTargetDbm) / Math.max(1, scale.max - rxTargetDbm), 0, 1);
  return Math.round(lerp(162, 180, above));
};

export const resolveMeshExtensionCandidateGridSize = (requestedGridSize: number): number =>
  Math.max(6, Math.min(168, Math.round(requestedGridSize)));

export const resolveMeshExtensionCoverageGridSize = (requestedGridSize: number): number =>
  Math.max(6, Math.min(168, Math.round(requestedGridSize)));

export const meshExtensionColorForArea = (areaKm2: number, maxAreaKm2: number): [number, number, number] =>
  coverageColorForNormalized(maxAreaKm2 > 0 ? clamp(areaKm2 / maxAreaKm2, 0, 1) : 0);

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

const computeDenseCoverageRxTargetScale = (
  values: Float32Array,
  rxTargetDbm: number,
): CoverageRxTargetScale => {
  const stride = Math.max(1, Math.floor(values.length / 1_024));
  const finiteValues: number[] = [];
  for (let index = 0; index < values.length; index += stride) {
    const value = values[index];
    if (Number.isFinite(value)) finiteValues.push(value);
  }
  if (!finiteValues.length || !Number.isFinite(rxTargetDbm)) {
    const target = Number.isFinite(rxTargetDbm) ? rxTargetDbm : -120;
    return { min: target - 30, max: target + 30 };
  }
  finiteValues.sort((left, right) => left - right);
  const low = percentile(finiteValues, 0.05);
  const high = percentile(finiteValues, 0.95);
  const span = clamp(Math.max(rxTargetDbm - low, high - rxTargetDbm, 20), 20, 55);
  return { min: rxTargetDbm - span, max: rxTargetDbm + span };
};

const computeDensePositivePercentile = (values: Float32Array, ratio: number): number => {
  const stride = Math.max(1, Math.floor(values.length / 20_000));
  const positiveValues: number[] = [];
  for (let index = 0; index < values.length; index += stride) {
    const value = values[index];
    if (Number.isFinite(value) && value > 0) positiveValues.push(value);
  }
  positiveValues.sort((left, right) => left - right);
  return positiveValues.length ? percentile(positiveValues, ratio) : 0;
};

export const buildAdaptiveCoverageOverlayPixelsAsync = async (
  input: AdaptiveCoverageOverlayInput,
): Promise<OverlayRasterPixels | null> => {
  const { bounds, dimensions, initialGridSize, mode, rxTargetDbm, contributors, pointMask, context } = input;
  const width = dimensions.width;
  const height = dimensions.height;
  const totalPixels = width * height;
  if (totalPixels <= 0 || contributors.length === 0) return null;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const metricKind = mode === "weakest" ? "weakest" : "strongest";
  const metricCacheKey = input.analysisCacheKey
    ? `${input.analysisCacheKey}|${width}x${height}|${metricKind}`
    : "";
  const cachedMetrics = metricCacheKey ? coverageMetricCache.get(metricCacheKey) : undefined;
  const reuseCachedMetrics = cachedMetrics?.width === width && cachedMetrics.height === height;
  const metricCache =
    reuseCachedMetrics
      ? cachedMetrics
      : {
          width,
          height,
          valuesDbm: new Float32Array(totalPixels).fill(Number.NaN),
        };
  let evaluatedPaths = 0;
  const colorContext = contextForProgressRange(context, 90, 100);
  const adaptiveSeedGridSize = Math.max(4, Math.round(initialGridSize / 4));
  let refinedBlocks = 0;
  const filledPixels = totalPixels;
  if (!reuseCachedMetrics) {
    const evaluated = new Uint8Array(totalPixels);
    const analysisContext = contextForProgressRange(context, 0, 90);
    const evaluate = (index: number): number => {
      if (!evaluated[index]) {
        evaluated[index] = 1;
        const y = Math.floor(index / width);
        const x = index - y * width;
        const lat = latByRow[y];
        const lon = lonByCol[x];
        if (!pointMask || pointMask(lat, lon)) {
          let aggregateDbm = metricKind === "weakest"
            ? Number.POSITIVE_INFINITY
            : Number.NEGATIVE_INFINITY;
          for (const contributor of contributors) {
            const valueDbm = contributor.evaluatePoint(lat, lon);
            evaluatedPaths += 1;
            aggregateDbm = metricKind === "weakest"
              ? Math.min(aggregateDbm, valueDbm)
              : Math.max(aggregateDbm, valueDbm);
          }
          metricCache.valuesDbm[index] = Number.isFinite(aggregateDbm) ? aggregateDbm : Number.NaN;
        }
      }
      return metricCache.valuesDbm[index];
    };

    if (input.adaptive === false) {
      await runCooperativeLoop(totalPixels, evaluate, analysisContext);
    } else {
      const result = await runAdaptiveBlockQueue(
        partitionAdaptiveCoverageBlocks(width, height, adaptiveSeedGridSize),
        totalPixels,
        (block) => {
          const area = rasterBlockArea(block);
          const sampleIndices = passFailSampleIndicesForRasterBlock(block, width);
          const finiteSamples = sampleIndices
            .map((index) => ({ index, valueDbm: evaluate(index) }))
            .filter((sample) => Number.isFinite(sample.valueDbm));
          if (area === 1 || finiteSamples.length === 0) return null;
          if (finiteSamples.length !== sampleIndices.length) return splitRasterBlock(block);

          const xLast = block.x1 - 1;
          const yLast = block.y1 - 1;
          const cornerValues = [
            evaluate(block.y0 * width + block.x0),
            evaluate(block.y0 * width + xLast),
            evaluate(yLast * width + block.x0),
            evaluate(yLast * width + xLast),
          ];
          const predict = (index: number): number => {
            const y = Math.floor(index / width);
            const x = index - y * width;
            const tx = xLast === block.x0 ? 0 : (x - block.x0) / (xLast - block.x0);
            const ty = yLast === block.y0 ? 0 : (y - block.y0) / (yLast - block.y0);
            const top = cornerValues[0] + (cornerValues[1] - cornerValues[0]) * tx;
            const bottom = cornerValues[2] + (cornerValues[3] - cornerValues[2]) * tx;
            return top + (bottom - top) * ty;
          };
          if (
            finiteSamples.some(
              (sample) => Math.abs(sample.valueDbm - predict(sample.index)) > COVERAGE_ADAPTIVE_ERROR_DB,
            )
          ) {
            return splitRasterBlock(block);
          }

          for (let y = block.y0; y < block.y1; y += 1) {
            for (let x = block.x0; x < block.x1; x += 1) {
              const index = y * width + x;
              if (!evaluated[index]) metricCache.valuesDbm[index] = predict(index);
            }
          }
          return null;
        },
        analysisContext,
      );
      refinedBlocks = result.refinedBlocks;
    }
  }
  if (metricCacheKey) coverageMetricCache.set(metricCacheKey, metricCache);

  const signalValuesDbm = metricCache.valuesDbm;
  const scale = computeDenseCoverageRxTargetScale(signalValuesDbm, rxTargetDbm);
  const pixels = new Uint8ClampedArray(totalPixels * 4);
  await runCooperativeLoop(totalPixels, (index) => {
    const valueDbm = signalValuesDbm[index];
    if (!Number.isFinite(valueDbm)) return;
    const y = Math.floor(index / width);
    const x = index - y * width;
    const lat = latByRow[y];
    const lon = lonByCol[x];
    if (pointMask && !pointMask(lat, lon)) return;
    let isTargetContour = false;
    if (mode === "contours") {
      const rightValue = x < width - 1 ? signalValuesDbm[index + 1] : Number.NaN;
      const downValue = y < height - 1 ? signalValuesDbm[index + width] : Number.NaN;
      const crossesRight = Number.isFinite(rightValue) && (valueDbm - rxTargetDbm) * (rightValue - rxTargetDbm) <= 0;
      const crossesDown = Number.isFinite(downValue) && (valueDbm - rxTargetDbm) * (downValue - rxTargetDbm) <= 0;
      isTargetContour = Math.abs(valueDbm - rxTargetDbm) <= 1.25 || crossesRight || crossesDown;
    }
    const [r, g, b] = coverageColorFixed(
      isTargetContour ? rxTargetDbm : valueDbm,
      rxTargetDbm,
      scale,
    );
    const px = index * 4;
    pixels[px] = r;
    pixels[px + 1] = g;
    pixels[px + 2] = b;
    pixels[px + 3] = isTargetContour ? 230 : 180;
  }, colorContext);

  return {
    width,
    height,
    pixels,
    coordinates: overlayCoordinates(bounds),
    minDbm: scale.min,
    maxDbm: scale.max,
    signalValuesDbm,
    analysisStats: { evaluatedPaths, refinedBlocks, filledPixels, totalPixels },
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
  receiverSite?: Site,
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
    receiverSite,
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
  options?: AdaptiveOverlayOptions,
  receiverSite?: Site,
): Promise<OverlayRasterPixels | null> => {
  const width = dimensions.width;
  const height = dimensions.height;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const stateByPixel = new Int8Array(width * height).fill(-1);
  const marginByPixel = new Float64Array(width * height).fill(Number.NaN);
  const metricCacheKey = options?.analysisCacheKey
    ? `${options.analysisCacheKey}|${width}x${height}`
    : "";
  const cachedMetrics = metricCacheKey ? passFailMetricCache.get(metricCacheKey) : undefined;
  const metricCache =
    cachedMetrics?.width === width && cachedMetrics.height === height
      ? cachedMetrics
      : {
          width,
          height,
          rxDbm: new Float64Array(width * height),
          obstruction: new Int8Array(width * height),
          evaluated: new Uint8Array(width * height),
        };
  let evaluatedPaths = 0;

  const writeState = (index: number, stateCode: number): void => {
    if (stateCode <= 0) return;
    const px = index * 4;
    if (stateCode === 1) {
      pixels[px] = 82;
      pixels[px + 1] = 181;
      pixels[px + 2] = 96;
    } else if (stateCode === 2) {
      pixels[px] = 232;
      pixels[px + 1] = 170;
      pixels[px + 2] = 72;
    } else if (stateCode === 3) {
      pixels[px] = 235;
      pixels[px + 1] = 120;
      pixels[px + 2] = 70;
    } else {
      pixels[px] = 205;
      pixels[px + 1] = 87;
      pixels[px + 2] = 79;
    }
    pixels[px + 3] = 162;
  };

  const evaluate = (index: number): number => {
    const cached = stateByPixel[index];
    if (cached >= 0) return cached;
    if (!metricCache.evaluated[index]) {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const lat = latByRow[y];
      const lon = lonByCol[x];
      metricCache.evaluated[index] = 1;
      if ((pointMask && !pointMask(lat, lon)) || terrainSampler(lat, lon) === null) {
        metricCache.obstruction[index] = -1;
      } else {
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
          receiverSite,
        );
        metricCache.rxDbm[index] = metrics.rxDbm;
        metricCache.obstruction[index] = metrics.terrainObstructed ? 1 : 0;
        evaluatedPaths += 1;
      }
    }
    if (metricCache.obstruction[index] < 0) {
      stateByPixel[index] = 0;
      return 0;
    }
    const marginDb = metricCache.rxDbm[index] - environmentLossDb - rxTargetDbm;
    marginByPixel[index] = marginDb;
    const state = classifyPassFailState(marginDb >= 0, metricCache.obstruction[index] === 1);
    const stateCode = state === "pass_clear" ? 1 : state === "pass_blocked" ? 2 : state === "fail_clear" ? 3 : 4;
    stateByPixel[index] = stateCode;
    return stateCode;
  };

  let refinedBlocks = 0;
  let filledPixels = width * height;
  if (options?.adaptive === false) {
    await runCooperativeLoop(
      width * height,
      (index) => writeState(index, evaluate(index)),
      context,
    );
  } else {
    const result = await runAdaptiveBlockQueue(
      partitionRasterBlocks(width, height, terrainSamples, bounds),
      width * height,
      (block) => {
        const area = rasterBlockArea(block);
        const sampleIndices = passFailSampleIndicesForRasterBlock(block, width);
        const states = sampleIndices.map(evaluate);
        const firstState = states[0] ?? 0;
        const stableState = states.every((state) => state === firstState);
        const safelyAwayFromThreshold =
          firstState === 0 || sampleIndices.every((index) => Math.abs(marginByPixel[index]) >= PASS_FAIL_BOUNDARY_MARGIN_DB);
        const stableUnavailable = firstState === 0 && !pointMask;
        if (
          area === 1 ||
          (stableState && safelyAwayFromThreshold && (firstState !== 0 || stableUnavailable))
        ) {
          for (let y = block.y0; y < block.y1; y += 1) {
            for (let x = block.x0; x < block.x1; x += 1) {
              const index = y * width + x;
              stateByPixel[index] = firstState;
              writeState(index, firstState);
            }
          }
          return null;
        }
        return splitRasterBlock(block);
      },
      context,
    );
    refinedBlocks = result.refinedBlocks;
    filledPixels = result.filledPixels;
  }
  if (metricCacheKey) passFailMetricCache.set(metricCacheKey, metricCache);

  return {
    width,
    height,
    pixels,
    coordinates: overlayCoordinates(bounds),
    analysisStats: { evaluatedPaths, refinedBlocks, filledPixels, totalPixels: width * height },
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
  options?: AdaptiveOverlayOptions,
): Promise<OverlayRasterPixels | null> => {
  const width = dimensions.width;
  const height = dimensions.height;
  const { latByRow, lonByCol } = precomputeGridAxes(bounds, dimensions);
  const relayAntennaHeightM = Math.max(2, (fromSite.antennaHeightM + toSite.antennaHeightM) / 2);
  const fallbackRelayGround = (fromSite.groundElevationM + toSite.groundElevationM) / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const bottleneck = new Float32Array(width * height).fill(-Infinity);
  const metricCacheKey = options?.analysisCacheKey
    ? `${options.analysisCacheKey}|${width}x${height}`
    : "";
  const cachedMetrics = metricCacheKey ? relayMetricCache.get(metricCacheKey) : undefined;
  const metricCache =
    cachedMetrics?.width === width && cachedMetrics.height === height
      ? cachedMetrics
      : {
          width,
          height,
          baseDbm: new Float64Array(width * height).fill(Number.NEGATIVE_INFINITY),
          evaluated: new Uint8Array(width * height),
        };
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
  let evaluatedPaths = 0;
  const evaluate = (index: number): number => {
    if (!metricCache.evaluated[index]) {
      metricCache.evaluated[index] = 1;
      const y = Math.floor(index / width);
      const x = index - y * width;
      const lat = latByRow[y];
      const lon = lonByCol[x];
      if (!pointMask || pointMask(lat, lon)) {
        const sampledGround = terrainSampler(lat, lon);
        if (sampledGround !== null) {
          relaySite.position.lat = lat;
          relaySite.position.lon = lon;
          relaySite.groundElevationM = sampledGround ?? fallbackRelayGround;
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
            toSite,
          );
          metricCache.baseDbm[index] = Math.min(fromToRelayRx, relayToTargetRx);
          evaluatedPaths += 1;
        }
      }
    }
    const value = metricCache.baseDbm[index] - environmentLossDb;
    bottleneck[index] = value;
    return value;
  };

  let refinedBlocks = 0;
  let filledPixels = width * height;
  if (options?.adaptive === false) {
    await runCooperativeLoop(width * height, evaluate, context);
  } else {
    const result = await runAdaptiveBlockQueue(
      partitionRasterBlocks(width, height, terrainSamples, bounds),
      width * height,
      (block) => {
        const area = rasterBlockArea(block);
        const indices = sampleIndicesForRasterBlock(block, width);
        const values = indices.map(evaluate);
        const finiteValues = values.filter(Number.isFinite);
        const allUnavailable = finiteValues.length === 0;
        const mixedAvailability = finiteValues.length !== 0 && finiteValues.length !== values.length;
        const xLast = block.x1 - 1;
        const yLast = block.y1 - 1;
        const cornerValues = [
          evaluate(block.y0 * width + block.x0),
          evaluate(block.y0 * width + xLast),
          evaluate(yLast * width + block.x0),
          evaluate(yLast * width + xLast),
        ];
        const centerValue = evaluate(
          Math.floor((block.y0 + yLast) / 2) * width + Math.floor((block.x0 + xLast) / 2),
        );
        const range = finiteValues.length
          ? Math.max(...finiteValues) - Math.min(...finiteValues)
          : 0;
        const predictedCenter = cornerValues.every(Number.isFinite)
          ? cornerValues.reduce((sum, value) => sum + value, 0) / 4
          : Number.NaN;
        const stable =
          (allUnavailable && !pointMask) ||
          (!mixedAvailability && range <= 6 && Number.isFinite(centerValue) && Math.abs(centerValue - predictedCenter) <= 0.75);
        if (area === 1 || stable) {
          if (!allUnavailable) {
            const [q00, q10, q01, q11] = cornerValues;
            for (let y = block.y0; y < block.y1; y += 1) {
              const ty = yLast === block.y0 ? 0 : (y - block.y0) / (yLast - block.y0);
              for (let x = block.x0; x < block.x1; x += 1) {
                const tx = xLast === block.x0 ? 0 : (x - block.x0) / (xLast - block.x0);
                const top = q00 + (q10 - q00) * tx;
                const bottom = q01 + (q11 - q01) * tx;
                bottleneck[y * width + x] = top + (bottom - top) * ty;
              }
            }
          }
          return null;
        }
        return splitRasterBlock(block);
      },
      context,
    );
    refinedBlocks = result.refinedBlocks;
    filledPixels = result.filledPixels;
  }
  if (metricCacheKey) relayMetricCache.set(metricCacheKey, metricCache);

  let minDbm = Number.POSITIVE_INFINITY;
  let maxDbm = Number.NEGATIVE_INFINITY;
  for (const value of bottleneck) {
    if (!Number.isFinite(value)) continue;
    minDbm = Math.min(minDbm, value);
    maxDbm = Math.max(maxDbm, value);
  }

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
    signalValuesDbm: bottleneck,
    analysisStats: { evaluatedPaths, refinedBlocks, filledPixels, totalPixels: width * height },
  };
};

const directionalBaseRxDbm = (
  fromSite: Site,
  toSite: Site,
  frequencyMHz: number,
  environment: PropagationEnvironment,
): number => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(fromSite.position, toSite.position));
  const loss = getPathLossDb(
    distanceKm,
    frequencyMHz,
    fromSite.antennaHeightM,
    toSite.antennaHeightM,
    environment,
  );
  const txGainDbi = effectiveGainTowardSiteDbi(fromSite.txGainDbi, fromSite, toSite);
  const rxGainDbi = effectiveGainTowardSiteDbi(toSite.rxGainDbi, toSite, fromSite);
  return fromSite.txPowerDbm + txGainDbi - fromSite.cableLossDb + rxGainDbi - loss;
};

const directionalTerrainRxDbm = (
  fromSite: Site,
  toSite: Site,
  frequencyMHz: number,
  environment: PropagationEnvironment,
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
): number =>
  computeSourceCentricRxMetrics(
    toSite.position.lat,
    toSite.position.lon,
    fromSite,
    {
      id: "__mesh_extension_link__",
      fromSiteId: fromSite.id,
      toSiteId: toSite.id,
      frequencyMHz,
    },
    toSite.antennaHeightM,
    toSite.rxGainDbi,
    terrainSampler,
    terrainSamples,
    environment,
    toSite,
  ).rxDbm;

const bidirectionalBaseDbm = (
  left: Site,
  right: Site,
  frequencyMHz: number,
  environment: PropagationEnvironment,
): number =>
  Math.min(
    directionalBaseRxDbm(left, right, frequencyMHz, environment),
    directionalBaseRxDbm(right, left, frequencyMHz, environment),
  );

const bidirectionalTerrainDbm = (
  left: Site,
  right: Site,
  frequencyMHz: number,
  environment: PropagationEnvironment,
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
): number =>
  Math.min(
    directionalTerrainRxDbm(left, right, frequencyMHz, environment, terrainSampler, terrainSamples),
    directionalTerrainRxDbm(right, left, frequencyMHz, environment, terrainSampler, terrainSamples),
  );

const siteFromProfile = (
  id: string,
  lat: number,
  lon: number,
  groundElevationM: number,
  profile: MeshExtensionCandidateProfile,
): Site => ({
  id,
  name: id,
  position: { lat, lon },
  groundElevationM,
  ...profile,
});

const cellAreaKm2 = (
  index: number,
  dimensions: { rows: number; cols: number },
  bounds: TerrainBounds,
  lat: number,
): number => {
  const row = Math.floor(index / dimensions.cols);
  const col = index - row * dimensions.cols;
  const latStep = (bounds.maxLat - bounds.minLat) / Math.max(1, dimensions.rows - 1);
  const lonStep = (bounds.maxLon - bounds.minLon) / Math.max(1, dimensions.cols - 1);
  const latShare = row === 0 || row === dimensions.rows - 1 ? 0.5 : 1;
  const lonShare = col === 0 || col === dimensions.cols - 1 ? 0.5 : 1;
  const heightKm = Math.abs(latStep) * 111.32 * latShare;
  const widthKm = Math.abs(lonStep) * 111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)) * lonShare;
  return heightKm * widthKm;
};

type MeshExtensionGridBlock = {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
};

// Seed a small set of blocks, then recursively split only mixed pass/fail terrain boundaries.
// This keeps 8x scoring responsive without reverting its finest cells to the 1x grid.
const MESH_EXTENSION_ADAPTIVE_BASE_GRID_SIZE = 8;

const partitionGridAxis = (length: number, targetPartitions: number): Array<[number, number]> => {
  const partitions = Math.max(1, Math.min(length, targetPartitions));
  return Array.from({ length: partitions }, (_, index) => [
    Math.floor((index * length) / partitions),
    Math.floor(((index + 1) * length) / partitions),
  ]);
};

const buildAdaptiveGridBlocks = (
  dimensions: { rows: number; cols: number },
  baseGridSize = MESH_EXTENSION_ADAPTIVE_BASE_GRID_SIZE,
): MeshExtensionGridBlock[] => {
  const rowRanges = partitionGridAxis(dimensions.rows, baseGridSize);
  const colRanges = partitionGridAxis(dimensions.cols, baseGridSize);
  return rowRanges.flatMap(([rowStart, rowEnd]) =>
    colRanges.map(([colStart, colEnd]) => ({ rowStart, rowEnd, colStart, colEnd })),
  );
};

const splitAdaptiveGridBlock = (block: MeshExtensionGridBlock): MeshExtensionGridBlock[] => {
  const rowMid = block.rowStart + Math.ceil((block.rowEnd - block.rowStart) / 2);
  const colMid = block.colStart + Math.ceil((block.colEnd - block.colStart) / 2);
  const rowRanges: Array<[number, number]> =
    rowMid < block.rowEnd
      ? [[block.rowStart, rowMid], [rowMid, block.rowEnd]]
      : [[block.rowStart, block.rowEnd]];
  const colRanges: Array<[number, number]> =
    colMid < block.colEnd
      ? [[block.colStart, colMid], [colMid, block.colEnd]]
      : [[block.colStart, block.colEnd]];
  return rowRanges.flatMap(([rowStart, rowEnd]) =>
    colRanges.map(([colStart, colEnd]) => ({ rowStart, rowEnd, colStart, colEnd })),
  );
};

const uniqueBlockSampleIndices = (
  block: MeshExtensionGridBlock,
  cols: number,
): number[] => {
  const rows = [
    block.rowStart,
    Math.floor((block.rowStart + block.rowEnd - 1) / 2),
    block.rowEnd - 1,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const columns = [
    block.colStart,
    Math.floor((block.colStart + block.colEnd - 1) / 2),
    block.colEnd - 1,
  ].filter((value, index, values) => values.indexOf(value) === index);
  return rows.flatMap((row) => columns.map((col) => row * cols + col));
};

const buildAreaPrefixSum = (
  values: Float64Array,
  dimensions: { rows: number; cols: number },
): Float64Array => {
  const stride = dimensions.cols + 1;
  const prefix = new Float64Array((dimensions.rows + 1) * stride);
  for (let row = 0; row < dimensions.rows; row += 1) {
    let rowSum = 0;
    for (let col = 0; col < dimensions.cols; col += 1) {
      rowSum += values[row * dimensions.cols + col];
      prefix[(row + 1) * stride + col + 1] = prefix[row * stride + col + 1] + rowSum;
    }
  }
  return prefix;
};

const areaForGridBlock = (
  prefix: Float64Array,
  dimensions: { rows: number; cols: number },
  block: MeshExtensionGridBlock,
): number => {
  const stride = dimensions.cols + 1;
  return (
    prefix[block.rowEnd * stride + block.colEnd] -
    prefix[block.rowStart * stride + block.colEnd] -
    prefix[block.rowEnd * stride + block.colStart] +
    prefix[block.rowStart * stride + block.colStart]
  );
};

export const buildMeshExtensionOverlayPixelsAsync = async (
  input: MeshExtensionOverlayInput,
): Promise<OverlayRasterPixels | null> => {
  if (!input.selectedSites.length) return null;
  const candidateGridSize = resolveMeshExtensionCandidateGridSize(input.candidateGridSize);
  const coverageGridSize = resolveMeshExtensionCoverageGridSize(input.coverageGridSize ?? candidateGridSize);
  const coveragePoints = buildCoverageGridPoints(coverageGridSize, input.bounds);
  const coverageDimensions = computeCoverageGridDimensions(coverageGridSize, input.bounds);
  const candidateDimensions = computeCoverageGridDimensions(candidateGridSize, input.bounds);
  const profile = deriveMeshExtensionCandidateProfile(input.selectedSites);
  const terrainSamples = Math.max(16, Math.round(input.terrainSamples));
  const thresholdBeforeEnvironmentDbm = input.rxTargetDbm + input.environmentLossDb;
  const progressContext = (startPercent: number, endPercent: number): OverlayTaskContext | undefined =>
    contextForProgressRange(input.context, startPercent, endPercent);

  const targetSites: Array<Site | null> = coveragePoints.map((point, index) => {
    if (input.pointMask && !input.pointMask(point.lat, point.lon)) return null;
    const ground = input.terrainSampler(point.lat, point.lon);
    return ground === null ? null : siteFromProfile(`__mesh_extension_target_${index}__`, point.lat, point.lon, ground, profile);
  });
  const targetAreaKm2 = coveragePoints.map((point, index) =>
    targetSites[index] ? cellAreaKm2(index, coverageDimensions, input.bounds, point.lat) : 0,
  );
  const existingCovered = new Uint8Array(coveragePoints.length);

  await runCooperativeLoop(
    coveragePoints.length,
    (targetIndex) => {
      const target = targetSites[targetIndex];
      if (!target) return;
      for (const selectedSite of input.selectedSites) {
        const optimistic = bidirectionalBaseDbm(
          selectedSite,
          target,
          input.frequencyMHz,
          input.propagationEnvironment,
        );
        if (optimistic < thresholdBeforeEnvironmentDbm) continue;
        const actual = bidirectionalTerrainDbm(
          selectedSite,
          target,
          input.frequencyMHz,
          input.propagationEnvironment,
          input.terrainSampler,
          terrainSamples,
        );
        if (actual - input.environmentLossDb >= input.rxTargetDbm) {
          existingCovered[targetIndex] = 1;
          return;
        }
      }
    },
    progressContext(0, 15),
  );

  const uncoveredAreaByTarget = new Float64Array(coveragePoints.length);
  for (let index = 0; index < coveragePoints.length; index += 1) {
    if (!existingCovered[index] && targetSites[index]) uncoveredAreaByTarget[index] = targetAreaKm2[index];
  }
  const uncoveredAreaPrefix = buildAreaPrefixSum(uncoveredAreaByTarget, coverageDimensions);
  const adaptiveBlocks = buildAdaptiveGridBlocks(coverageDimensions);

  const width = candidateDimensions.cols;
  const height = candidateDimensions.rows;
  const totalCandidates = width * height;
  const { latByRow, lonByCol } = precomputeGridAxes(input.bounds, { width, height });
  const connectivityDbm = new Float32Array(totalCandidates).fill(Number.NaN);
  const newlyCoveredAreaKm2 = new Float32Array(totalCandidates).fill(Number.NaN);
  const candidateEvaluated = new Uint8Array(totalCandidates);
  const evaluationStamp = new Uint32Array(coveragePoints.length);
  const evaluationPass = new Uint8Array(coveragePoints.length);
  const candidateContext = progressContext(15, 90);
  const areaFrameBudgetMs = Math.max(1, input.context?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS);
  const areaLongTaskMs = Math.max(areaFrameBudgetMs, input.context?.longTaskMs ?? DEFAULT_LONG_TASK_MS);
  let evaluatedCandidates = 0;

  const evaluateCandidate = async (candidateIndex: number): Promise<void> => {
    if (candidateEvaluated[candidateIndex]) return;
    candidateEvaluated[candidateIndex] = 1;
    evaluatedCandidates += 1;
    const y = Math.floor(candidateIndex / width);
    const x = candidateIndex - y * width;
    const lat = latByRow[y];
    const lon = lonByCol[x];
    const ground = input.terrainSampler(lat, lon);
    if (ground === null) return;
    const candidate = siteFromProfile(`__mesh_extension_candidate_${candidateIndex}__`, lat, lon, ground, profile);
    const peers = input.selectedSites.map((selectedSite) => {
      const selectedToCandidateBase =
        directionalBaseRxDbm(selectedSite, candidate, input.frequencyMHz, input.propagationEnvironment) -
        input.environmentLossDb;
      const candidateToSelectedBase =
        directionalBaseRxDbm(candidate, selectedSite, input.frequencyMHz, input.propagationEnvironment) -
        input.environmentLossDb;
      if (Math.min(selectedToCandidateBase, candidateToSelectedBase) < input.rxTargetDbm) {
        return {
          selectedToCandidateDbm: selectedToCandidateBase,
          candidateToSelectedDbm: candidateToSelectedBase,
        };
      }
      return {
        selectedToCandidateDbm:
          directionalTerrainRxDbm(
            selectedSite,
            candidate,
            input.frequencyMHz,
            input.propagationEnvironment,
            input.terrainSampler,
            terrainSamples,
          ) - input.environmentLossDb,
        candidateToSelectedDbm:
          directionalTerrainRxDbm(
            candidate,
            selectedSite,
            input.frequencyMHz,
            input.propagationEnvironment,
            input.terrainSampler,
            terrainSamples,
          ) - input.environmentLossDb,
      };
    });
    const connectivity = strongestBidirectionalPeerDbm(peers);
    connectivityDbm[candidateIndex] = connectivity;
    newlyCoveredAreaKm2[candidateIndex] = 0;
    if (connectivity < input.rxTargetDbm) return;

    const stamp = candidateIndex + 1;
    const stack = adaptiveBlocks.slice();
    let chunkStartedAt = nowMs();
    const evaluateTarget = (targetIndex: number): number => {
      if (existingCovered[targetIndex] || !targetSites[targetIndex]) return -1;
      if (evaluationStamp[targetIndex] === stamp) return evaluationPass[targetIndex];
      const target = targetSites[targetIndex]!;
      const optimistic = directionalBaseRxDbm(candidate, target, input.frequencyMHz, input.propagationEnvironment);
      let pass = false;
      if (optimistic >= thresholdBeforeEnvironmentDbm) {
        const actual = directionalTerrainRxDbm(
          candidate,
          target,
          input.frequencyMHz,
          input.propagationEnvironment,
          input.terrainSampler,
          terrainSamples,
        );
        pass = actual - input.environmentLossDb >= input.rxTargetDbm;
      }
      evaluationStamp[targetIndex] = stamp;
      evaluationPass[targetIndex] = pass ? 1 : 0;
      return evaluationPass[targetIndex];
    };

    while (stack.length) {
      throwIfCancelled(input.context);
      const block = stack.pop()!;
      const blockArea = areaForGridBlock(uncoveredAreaPrefix, coverageDimensions, block);
      if (blockArea <= 0) continue;
      const states = uniqueBlockSampleIndices(block, coverageDimensions.cols)
        .map(evaluateTarget)
        .filter((state) => state >= 0);
      const isLeaf = block.rowEnd - block.rowStart === 1 && block.colEnd - block.colStart === 1;
      if (states.length && states.every((state) => state === states[0])) {
        if (states[0] === 1) newlyCoveredAreaKm2[candidateIndex] += blockArea;
      } else if (!isLeaf) {
        stack.push(...splitAdaptiveGridBlock(block));
      }

      const chunkDuration = nowMs() - chunkStartedAt;
      if (chunkDuration >= areaFrameBudgetMs && stack.length) {
        if (chunkDuration >= areaLongTaskMs) {
          input.context?.onLongTask?.({
            phase: input.context.phase,
            signature: input.context.signature,
            durationMs: chunkDuration,
            processed: evaluatedCandidates,
            total: totalCandidates,
          });
        }
        await nextFrame();
        chunkStartedAt = nowMs();
      }
    }
  };

  const candidateResult = await runAdaptiveBlockQueue(
    partitionRasterBlocks(width, height, candidateGridSize, input.bounds),
    totalCandidates,
    async (block) => {
      const area = rasterBlockArea(block);
      const sampleIndices = passFailSampleIndicesForRasterBlock(block, width);
      for (const index of sampleIndices) await evaluateCandidate(index);
      const finiteIndices = sampleIndices.filter(
        (index) => Number.isFinite(connectivityDbm[index]) && Number.isFinite(newlyCoveredAreaKm2[index]),
      );
      if (area === 1 || finiteIndices.length === 0) return null;
      if (finiteIndices.length !== sampleIndices.length) return splitRasterBlock(block);

      const xLast = block.x1 - 1;
      const yLast = block.y1 - 1;
      const cornerIndices = [
        block.y0 * width + block.x0,
        block.y0 * width + xLast,
        yLast * width + block.x0,
        yLast * width + xLast,
      ];
      const predict = (index: number, values: Float32Array): number => {
        const y = Math.floor(index / width);
        const x = index - y * width;
        const tx = xLast === block.x0 ? 0 : (x - block.x0) / (xLast - block.x0);
        const ty = yLast === block.y0 ? 0 : (y - block.y0) / (yLast - block.y0);
        const top = values[cornerIndices[0]] + (values[cornerIndices[1]] - values[cornerIndices[0]]) * tx;
        const bottom = values[cornerIndices[2]] + (values[cornerIndices[3]] - values[cornerIndices[2]]) * tx;
        return top + (bottom - top) * ty;
      };
      const allSafelyFail = finiteIndices.every((index) => connectivityDbm[index] <= input.rxTargetDbm - 5);
      const areaScale = Math.max(0.01, ...finiteIndices.map((index) => newlyCoveredAreaKm2[index])) * 0.02;
      const stable = allSafelyFail || finiteIndices.every(
        (index) =>
          Math.abs(connectivityDbm[index] - predict(index, connectivityDbm)) <= 0.75 &&
          Math.abs(newlyCoveredAreaKm2[index] - predict(index, newlyCoveredAreaKm2)) <= Math.max(0.01, areaScale),
      );
      if (!stable) return splitRasterBlock(block);

      for (let y = block.y0; y < block.y1; y += 1) {
        for (let x = block.x0; x < block.x1; x += 1) {
          const index = y * width + x;
          if (allSafelyFail) {
            connectivityDbm[index] = input.rxTargetDbm - 5;
            newlyCoveredAreaKm2[index] = 0;
          } else {
            connectivityDbm[index] = predict(index, connectivityDbm);
            newlyCoveredAreaKm2[index] = Math.max(0, predict(index, newlyCoveredAreaKm2));
          }
        }
      }
      return null;
    },
    candidateContext,
  );

  const hasFiniteCandidate = connectivityDbm.some(Number.isFinite);
  if (!hasFiniteCandidate) return null;
  const maxAreaKm2 = computeDensePositivePercentile(newlyCoveredAreaKm2, 0.95);
  const connectivityScale = computeDenseCoverageRxTargetScale(connectivityDbm, input.rxTargetDbm);
  const outputWidth = input.dimensions.width;
  const outputHeight = input.dimensions.height;
  const outputPixels = outputWidth * outputHeight;
  const pixels = new Uint8ClampedArray(outputPixels * 4);
  const { latByRow: outputLatByRow, lonByCol: outputLonByCol } = precomputeGridAxes(
    input.bounds,
    input.dimensions,
  );
  const interpolateCandidateValue = (values: Float32Array, x: number, y: number): number => {
    const sourceX = outputWidth <= 1 ? 0 : (x / (outputWidth - 1)) * (width - 1);
    const sourceY = outputHeight <= 1 ? 0 : (y / (outputHeight - 1)) * (height - 1);
    const x0 = Math.floor(sourceX);
    const y0 = Math.floor(sourceY);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = sourceX - x0;
    const ty = sourceY - y0;
    const q00 = values[y0 * width + x0];
    const q10 = values[y0 * width + x1];
    const q01 = values[y1 * width + x0];
    const q11 = values[y1 * width + x1];
    if (![q00, q10, q01, q11].every(Number.isFinite)) return Number.NaN;
    const top = q00 + (q10 - q00) * tx;
    const bottom = q01 + (q11 - q01) * tx;
    return top + (bottom - top) * ty;
  };

  await runCooperativeLoop(
    outputPixels,
    (index) => {
      const y = Math.floor(index / outputWidth);
      const x = index - y * outputWidth;
      const lat = outputLatByRow[y];
      const lon = outputLonByCol[x];
      if (input.pointMask && !input.pointMask(lat, lon)) return;
      if (input.terrainSampler(lat, lon) === null) return;
      const area = interpolateCandidateValue(newlyCoveredAreaKm2, x, y);
      const connectivity = interpolateCandidateValue(connectivityDbm, x, y);
      if (!Number.isFinite(area) || !Number.isFinite(connectivity)) return;
      const [r, g, b] = meshExtensionColorForArea(area, maxAreaKm2);
      const px = index * 4;
      pixels[px] = r;
      pixels[px + 1] = g;
      pixels[px + 2] = b;
      pixels[px + 3] = meshExtensionAlphaForDbm(connectivity, input.rxTargetDbm, connectivityScale);
    },
    progressContext(85, 100),
  );

  return {
    width: outputWidth,
    height: outputHeight,
    pixels,
    coordinates: overlayCoordinates(input.bounds),
    minDbm: connectivityScale.min,
    maxDbm: connectivityScale.max,
    minAreaKm2: 0,
    maxAreaKm2,
    analysisStats: {
      evaluatedPaths: evaluatedCandidates,
      refinedBlocks: candidateResult.refinedBlocks,
      filledPixels: candidateResult.filledPixels,
      totalPixels: totalCandidates,
    },
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
    minAreaKm2: raster.minAreaKm2,
    maxAreaKm2: raster.maxAreaKm2,
  };
};
