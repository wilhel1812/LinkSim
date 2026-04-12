import { mod360 } from "./panoramaView";

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const scrollLeftForCenter = (centerAzimuthDeg: number, cycleWidthPx: number, viewportWidthPx: number): number =>
  cycleWidthPx + (mod360(centerAzimuthDeg) / 360) * cycleWidthPx - viewportWidthPx / 2;

export const centerForScrollLeft = (scrollLeftPx: number, cycleWidthPx: number, viewportWidthPx: number): number =>
  mod360(((scrollLeftPx + viewportWidthPx / 2 - cycleWidthPx) / Math.max(1, cycleWidthPx)) * 360);

export const normalizeScrollLeftToMiddleCycle = (scrollLeftPx: number, cycleWidthPx: number): number => {
  if (cycleWidthPx <= 0) return scrollLeftPx;
  if (scrollLeftPx < cycleWidthPx * 0.5) return scrollLeftPx + cycleWidthPx;
  if (scrollLeftPx > cycleWidthPx * 1.5) return scrollLeftPx - cycleWidthPx;
  return scrollLeftPx;
};

export const centerForScaledWindow = (
  oldCenterDeg: number,
  oldSpanDeg: number,
  newSpanDeg: number,
  focalNorm: number,
): number => {
  const focal = oldCenterDeg + (clamp(focalNorm, 0, 1) - 0.5) * oldSpanDeg;
  return mod360(focal - (clamp(focalNorm, 0, 1) - 0.5) * newSpanDeg);
};

