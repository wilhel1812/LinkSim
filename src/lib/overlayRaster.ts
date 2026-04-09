import { classifyPassFailState, computeSourceCentricRxMetrics } from "./passFailState";
import { STANDARD_SITE_RADIO } from "./linkRadio";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

export type TerrainBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type CoverageSampleLite = { lat: number; lon: number; valueDbm: number };

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

    if (processed < total) {
      await nextFrame();
    }
  }
};

const coverageColorForDbm = (valueDbm: number): [number, number, number] => {
  const stops: Array<{ v: number; c: [number, number, number] }> = [
    { v: -125, c: [105, 42, 45] },
    { v: -114, c: [156, 63, 49] },
    { v: -104, c: [201, 92, 45] },
    { v: -95, c: [226, 127, 45] },
    { v: -86, c: [218, 175, 55] },
    { v: -78, c: [164, 193, 68] },
    { v: -70, c: [95, 178, 95] },
    { v: -62, c: [64, 150, 178] },
  ];
  if (valueDbm <= stops[0].v) return stops[0].c;
  if (valueDbm >= stops[stops.length - 1].v) return stops[stops.length - 1].c;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (valueDbm < a.v || valueDbm > b.v) continue;
    const t = (valueDbm - a.v) / (b.v - a.v);
    return [
      Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
      Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
      Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
    ];
  }
  return [255, 255, 255];
};

const coverageColorAdaptive = (valueDbm: number, samples: CoverageSampleLite[]): [number, number, number] => {
  if (samples.length < 2) return coverageColorForDbm(valueDbm);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample.valueDbm);
    max = Math.max(max, sample.valueDbm);
  }
  const range = Math.max(6, max - min);
  const normalized = -125 + ((valueDbm - min) / range) * 63;
  return coverageColorForDbm(clamp(normalized, -125, -62));
};

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
): Promise<OverlayRasterPixels | null> => {
  if (!samples.length) return null;
  const gridInterpolator = makeGridInterpolator(samples);
  const width = dimensions.width;
  const height = dimensions.height;
  const pixels = new Uint8ClampedArray(width * height * 4);

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const tY = y / Math.max(1, height - 1);
      const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      if (pointMask && !pointMask(lat, lon)) return;
      if (terrainSampler && terrainSampler(lat, lon) === null) return;
      const valueDbm = gridInterpolator
        ? gridInterpolator(lat, lon)
        : interpolateCoverageDbm(samples, lat, lon);
      if (valueDbm === null) return;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 180;
      if (mode === "heatmap") {
        [r, g, b] = coverageColorAdaptive(valueDbm, samples);
      } else {
        const banded = Math.round(valueDbm / Math.max(1, bandStepDb)) * Math.max(1, bandStepDb);
        [r, g, b] = coverageColorAdaptive(banded, samples);
        a = 170;
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
  const pixels = new Uint8ClampedArray(width * height * 4);

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const tY = y / Math.max(1, height - 1);
      const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
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
  const relayAntennaHeightM = Math.max(2, (fromSite.antennaHeightM + toSite.antennaHeightM) / 2);
  const fallbackRelayGround = (fromSite.groundElevationM + toSite.groundElevationM) / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const bottleneck = new Float32Array(width * height).fill(-Infinity);
  let minDbm = Number.POSITIVE_INFINITY;
  let maxDbm = Number.NEGATIVE_INFINITY;

  await runCooperativeLoop(
    width * height,
    (index) => {
      const y = Math.floor(index / width);
      const x = index - y * width;
      const tY = y / Math.max(1, height - 1);
      const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      if (pointMask && !pointMask(lat, lon)) return;

      const sampledGround = terrainSampler(lat, lon);
      if (sampledGround === null) return;
      const relayGround = sampledGround ?? fallbackRelayGround;

      const relaySite: Site = {
        id: "__relay_candidate__",
        name: "Relay candidate",
        position: { lat, lon },
        antennaHeightM: relayAntennaHeightM,
        groundElevationM: relayGround,
        txPowerDbm: STANDARD_SITE_RADIO.txPowerDbm,
        txGainDbi: STANDARD_SITE_RADIO.txGainDbi,
        rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
        cableLossDb: STANDARD_SITE_RADIO.cableLossDb,
      };

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
      const tY = y / Math.max(1, height - 1);
      const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
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
