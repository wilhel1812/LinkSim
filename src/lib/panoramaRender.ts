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

export const buildDepthBands = (
  rays: PanoramaRay[],
  fractions: number[],
  mapPoint: (ray: PanoramaRay, sample: PanoramaRaySample | null) => { x: number; y: number; angleDeg: number },
): PanoramaDepthBand[] => {
  if (!rays.length || !fractions.length) return [];

  const rawBands = fractions.map((fraction, bandIndex) => {
    const points: PanoramaDepthPoint[] = rays.map((ray) => {
      const sampleIndex = Math.max(0, Math.min(ray.samples.length - 1, Math.round((ray.samples.length - 1) * fraction)));
      const sample = ray.samples.length ? ray.samples[sampleIndex] ?? ray.samples[ray.samples.length - 1] : null;
      const mapped = mapPoint(ray, sample);
      return {
        x: mapped.x,
        y: mapped.y,
        angleDeg: mapped.angleDeg,
        sample,
      };
    });
    return { bandIndex, depthRatio: fraction, points };
  });

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
