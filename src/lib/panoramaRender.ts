import type { PanoramaRay, PanoramaRaySample } from "./panorama";

export type PanoramaDepthPoint = {
  x: number;
  y: number;
  angleDeg: number;
  sample: PanoramaRaySample | null;
};

export type PanoramaDepthBand = {
  bandIndex: number;
  depthRatio: number;
  points: PanoramaDepthPoint[];
  lineSegments: string[];
  fillSegments: PanoramaDepthPoint[][];
};

export type PanoramaBandSelectionOptions = {
  ridgeSnap?: {
    enabled?: boolean;
    windowRatio?: number;
  };
};

export type PanoramaDepthStyle = {
  strokeWidth: number;
  strokeOpacity: number;
  fillOpacity: number;
  strokeMixTerrainPct: number;
  strokeMixMutedPct: number;
};

export type PanoramaRenderedEndpoint = {
  endpoint: { lat: number; lon: number };
  azimuthDeg: number;
  distanceKm: number;
};

const linePath = (points: PanoramaDepthPoint[]): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

const visibleLineSegments = (points: PanoramaDepthPoint[], visibleMask: boolean[]): string[] => {
  const segments: string[] = [];
  let run: PanoramaDepthPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (!visibleMask[i]) {
      if (run.length >= 2) segments.push(linePath(run));
      run = [];
      continue;
    }
    run.push(points[i]);
  }
  if (run.length >= 2) segments.push(linePath(run));
  return segments;
};

const visiblePointRuns = (points: PanoramaDepthPoint[], visibleMask: boolean[]): PanoramaDepthPoint[][] => {
  const runs: PanoramaDepthPoint[][] = [];
  let run: PanoramaDepthPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (!visibleMask[i]) {
      if (run.length >= 2) runs.push(run);
      run = [];
      continue;
    }
    run.push(points[i]);
  }
  if (run.length >= 2) runs.push(run);
  return runs;
};

export const depthStyleForBand = (bandIndex: number, bandCount: number): PanoramaDepthStyle => {
  const denom = Math.max(1, bandCount - 1);
  const depthRatio = bandIndex / denom;
  const nearRatio = 1 - depthRatio;
  return {
    strokeWidth: 0.7 + nearRatio * 1.3,
    strokeOpacity: 0.24 + nearRatio * 0.68,
    fillOpacity: 0.03 + nearRatio * 0.1,
    strokeMixTerrainPct: Math.round(30 + nearRatio * 58),
    strokeMixMutedPct: Math.round(12 + depthRatio * 68),
  };
};

export const buildNearBiasedDepthFractions = (lineCount: number): number[] => {
  const count = Math.max(1, Math.round(lineCount));
  if (count === 1) return [1];
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    return Number(Math.pow(t, 1.6).toFixed(6));
  });
};

export const buildDepthBands = (
  rays: PanoramaRay[],
  fractions: number[],
  mapPoint: (ray: PanoramaRay, sample: PanoramaRaySample | null) => { x: number; y: number; angleDeg: number },
  options?: PanoramaBandSelectionOptions,
): PanoramaDepthBand[] => {
  if (!rays.length || !fractions.length) return [];

  const ridgeSnapEnabled = options?.ridgeSnap?.enabled !== false;
  const ridgeWindowRatio = Math.max(0.01, Math.min(0.35, options?.ridgeSnap?.windowRatio ?? 0.08));

  const pickSampleIndex = (
    ray: PanoramaRay,
    targetIndex: number,
    minIndex: number,
  ): number => {
    if (!ray.samples.length) return 0;
    const maxIndex = ray.samples.length - 1;
    const clampedTarget = Math.max(0, Math.min(maxIndex, targetIndex));
    if (!ridgeSnapEnabled) return Math.max(minIndex, clampedTarget);
    const windowRadius = Math.max(1, Math.round(maxIndex * ridgeWindowRatio));
    const start = Math.max(minIndex, clampedTarget - windowRadius);
    const end = Math.min(maxIndex, clampedTarget + windowRadius);
    let bestIndex = Math.max(minIndex, clampedTarget);
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = start; i <= end; i += 1) {
      const sample = ray.samples[i];
      if (!sample) continue;
      const crestScore = Math.max(0, sample.angleDeg - sample.maxAngleBeforeDeg);
      const proximityScore = 1 - Math.min(1, Math.abs(i - clampedTarget) / Math.max(1, windowRadius));
      const score = sample.angleDeg + crestScore * 0.35 + proximityScore * 0.08;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return Math.max(minIndex, bestIndex);
  };

  const rawBands: { bandIndex: number; depthRatio: number; points: PanoramaDepthPoint[] }[] = [];
  for (let bandIndex = 0; bandIndex < fractions.length; bandIndex += 1) {
    const fraction = fractions[bandIndex] ?? 1;
    const points: PanoramaDepthPoint[] = [];
    for (let rayIndex = 0; rayIndex < rays.length; rayIndex += 1) {
      const ray = rays[rayIndex];
      const maxIndex = Math.max(0, ray.samples.length - 1);
      const targetIndex = Math.round(maxIndex * fraction);
      const prevSample = bandIndex > 0 ? rawBands[bandIndex - 1]?.points[rayIndex]?.sample : null;
      const minIndex = prevSample
        ? Math.min(maxIndex, Math.max(0, Math.round((prevSample.distanceKm / Math.max(0.001, ray.maxDistanceKm)) * maxIndex)))
        : 0;
      const sampleIndex = pickSampleIndex(ray, targetIndex, minIndex);
      const sample = ray.samples.length ? ray.samples[sampleIndex] ?? ray.samples[maxIndex] : null;
      const mapped = mapPoint(ray, sample);
      points.push({
        x: mapped.x,
        y: mapped.y,
        angleDeg: mapped.angleDeg,
        sample,
      });
    }
    rawBands.push({ bandIndex, depthRatio: fraction, points });
  }

  const visibility: boolean[][] = rawBands.map(() => new Array<boolean>(rays.length).fill(false));
  for (let rayIndex = 0; rayIndex < rays.length; rayIndex += 1) {
    let foregroundAngle = Number.NEGATIVE_INFINITY;
    for (let bandIndex = 0; bandIndex < rawBands.length; bandIndex += 1) {
      const angle = rawBands[bandIndex].points[rayIndex]?.angleDeg ?? Number.NEGATIVE_INFINITY;
      const isVisible = Number.isFinite(angle) && angle > foregroundAngle;
      visibility[bandIndex][rayIndex] = isVisible;
      if (isVisible) foregroundAngle = angle;
    }
  }

  return rawBands.map((band, bandIndex) => ({
    ...band,
    lineSegments: visibleLineSegments(band.points, visibility[bandIndex]),
    fillSegments: visiblePointRuns(band.points, visibility[bandIndex]),
  }));
};

export const resolveRenderedEndpoint = (params: {
  hoveredNode?: { lat: number; lon: number; azimuthDeg: number; distanceKm: number } | null;
  hoveredSample?: PanoramaRaySample | null;
  hoveredAzimuthDeg?: number | null;
  fallbackRay?: PanoramaRay | null;
}): PanoramaRenderedEndpoint | null => {
  const { hoveredNode, hoveredSample, hoveredAzimuthDeg, fallbackRay } = params;
  if (hoveredNode) {
    return {
      endpoint: { lat: hoveredNode.lat, lon: hoveredNode.lon },
      azimuthDeg: hoveredNode.azimuthDeg,
      distanceKm: hoveredNode.distanceKm,
    };
  }
  if (hoveredSample && hoveredAzimuthDeg != null) {
    return {
      endpoint: { lat: hoveredSample.lat, lon: hoveredSample.lon },
      azimuthDeg: hoveredAzimuthDeg,
      distanceKm: hoveredSample.distanceKm,
    };
  }
  if (fallbackRay) {
    return {
      endpoint: { lat: fallbackRay.horizonLat, lon: fallbackRay.horizonLon },
      azimuthDeg: fallbackRay.azimuthDeg,
      distanceKm: fallbackRay.horizonDistanceKm,
    };
  }
  return null;
};
