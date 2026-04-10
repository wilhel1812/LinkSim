import { unwrapAzimuthForWindow } from "./panoramaView";
import type { PanoramaRay, PanoramaResult } from "./panorama";

export type PanoramaComposedRay = {
  ray: PanoramaRay;
  xValue: number;
  source: "base" | "detail";
};

export type PanoramaCoverageSegment = {
  source: "base" | "detail";
  startDeg: number;
  endDeg: number;
};

const inWindow = (value: number, start: number, end: number): boolean => value >= start && value <= end;

const mapVisible = (rays: PanoramaRay[], centerDeg: number, startDeg: number, endDeg: number): Array<{ ray: PanoramaRay; xValue: number }> =>
  rays
    .map((ray) => {
      const xValue = unwrapAzimuthForWindow(ray.azimuthDeg, centerDeg);
      return { ray, xValue };
    })
    .filter((entry) => inWindow(entry.xValue, startDeg, endDeg))
    .sort((a, b) => a.xValue - b.xValue);

export const composePanoramaWindow = (params: {
  basePanorama: PanoramaResult | null;
  detailPanorama: PanoramaResult | null;
  centerDeg: number;
  startDeg: number;
  endDeg: number;
}): { rays: PanoramaComposedRay[]; segments: PanoramaCoverageSegment[] } => {
  const { basePanorama, detailPanorama, centerDeg, startDeg, endDeg } = params;
  const baseVisible = basePanorama ? mapVisible(basePanorama.rays, centerDeg, startDeg, endDeg) : [];
  const detailVisible = detailPanorama ? mapVisible(detailPanorama.rays, centerDeg, startDeg, endDeg) : [];

  if (!detailVisible.length) {
    return {
      rays: baseVisible.map((entry) => ({ ...entry, source: "base" as const })),
      segments: baseVisible.length ? [{ source: "base", startDeg, endDeg }] : [],
    };
  }

  if (!baseVisible.length) {
    const start = detailVisible[0]?.xValue ?? startDeg;
    const end = detailVisible[detailVisible.length - 1]?.xValue ?? endDeg;
    return {
      rays: detailVisible.map((entry) => ({ ...entry, source: "detail" as const })),
      segments: [{ source: "detail", startDeg: start, endDeg: end }],
    };
  }

  const detailStart = detailVisible[0]?.xValue ?? startDeg;
  const detailEnd = detailVisible[detailVisible.length - 1]?.xValue ?? endDeg;

  const leftBase = baseVisible.filter((entry) => entry.xValue < detailStart);
  const rightBase = baseVisible.filter((entry) => entry.xValue > detailEnd);
  const rays: PanoramaComposedRay[] = [
    ...leftBase.map((entry) => ({ ...entry, source: "base" as const })),
    ...detailVisible.map((entry) => ({ ...entry, source: "detail" as const })),
    ...rightBase.map((entry) => ({ ...entry, source: "base" as const })),
  ];

  const segments: PanoramaCoverageSegment[] = [];
  if (leftBase.length) segments.push({ source: "base", startDeg, endDeg: detailStart });
  segments.push({ source: "detail", startDeg: detailStart, endDeg: detailEnd });
  if (rightBase.length) segments.push({ source: "base", startDeg: detailEnd, endDeg });

  return { rays, segments };
};

