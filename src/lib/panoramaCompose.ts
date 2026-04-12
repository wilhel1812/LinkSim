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
  detailPanoramas: PanoramaResult[];
  centerDeg: number;
  startDeg: number;
  endDeg: number;
}): { rays: PanoramaComposedRay[]; segments: PanoramaCoverageSegment[] } => {
  const { basePanorama, detailPanoramas, centerDeg, startDeg, endDeg } = params;
  const baseVisible = basePanorama ? mapVisible(basePanorama.rays, centerDeg, startDeg, endDeg) : [];
  const detailVisibleByPanorama = detailPanoramas
    .map((panorama) => mapVisible(panorama.rays, centerDeg, startDeg, endDeg))
    .filter((entries) => entries.length > 0);
  const detailVisible = detailVisibleByPanorama.flat().sort((a, b) => a.xValue - b.xValue);

  const dedupedDetailVisible = detailVisible.filter((entry, index, all) => {
    const prev = all[index - 1];
    if (!prev) return true;
    return Math.abs(prev.xValue - entry.xValue) > 0.0001;
  });

  if (!dedupedDetailVisible.length) {
    return {
      rays: baseVisible.map((entry) => ({ ...entry, source: "base" as const })),
      segments: baseVisible.length ? [{ source: "base", startDeg, endDeg }] : [],
    };
  }

  if (!baseVisible.length) {
    const start = dedupedDetailVisible[0]?.xValue ?? startDeg;
    const end = dedupedDetailVisible[dedupedDetailVisible.length - 1]?.xValue ?? endDeg;
    return {
      rays: dedupedDetailVisible.map((entry) => ({ ...entry, source: "detail" as const })),
      segments: [{ source: "detail", startDeg: start, endDeg: end }],
    };
  }

  const detailSpans = detailVisibleByPanorama
    .map((entries) => ({
      startDeg: entries[0]?.xValue ?? startDeg,
      endDeg: entries[entries.length - 1]?.xValue ?? endDeg,
    }))
    .sort((a, b) => a.startDeg - b.startDeg);
  const mergedDetailSpans: Array<{ startDeg: number; endDeg: number }> = [];
  for (const span of detailSpans) {
    const last = mergedDetailSpans[mergedDetailSpans.length - 1];
    if (!last || span.startDeg > last.endDeg + 0.0001) {
      mergedDetailSpans.push({ startDeg: span.startDeg, endDeg: span.endDeg });
    } else {
      last.endDeg = Math.max(last.endDeg, span.endDeg);
    }
  }

  const rays: PanoramaComposedRay[] = [];
  const segments: PanoramaCoverageSegment[] = [];
  let cursor = startDeg;
  for (const span of mergedDetailSpans) {
    const spanStart = Math.max(startDeg, span.startDeg);
    const spanEnd = Math.min(endDeg, span.endDeg);
    if (spanEnd <= spanStart) continue;
    if (cursor < spanStart) {
      const baseSlice = baseVisible.filter((entry) => entry.xValue >= cursor && entry.xValue <= spanStart);
      rays.push(...baseSlice.map((entry) => ({ ...entry, source: "base" as const })));
      if (baseSlice.length) segments.push({ source: "base", startDeg: cursor, endDeg: spanStart });
    }
    const detailSlice = dedupedDetailVisible.filter((entry) => entry.xValue >= spanStart && entry.xValue <= spanEnd);
    rays.push(...detailSlice.map((entry) => ({ ...entry, source: "detail" as const })));
    if (detailSlice.length) segments.push({ source: "detail", startDeg: spanStart, endDeg: spanEnd });
    cursor = Math.max(cursor, spanEnd);
  }
  if (cursor < endDeg) {
    const baseSlice = baseVisible.filter((entry) => entry.xValue >= cursor && entry.xValue <= endDeg);
    rays.push(...baseSlice.map((entry) => ({ ...entry, source: "base" as const })));
    if (baseSlice.length) segments.push({ source: "base", startDeg: cursor, endDeg });
  }

  rays.sort((a, b) => a.xValue - b.xValue);

  return { rays, segments };
};
