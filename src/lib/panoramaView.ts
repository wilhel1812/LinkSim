export const mod360 = (value: number): number => ((value % 360) + 360) % 360;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const FOV_SCALE_MIN = 1;
export const FOV_SCALE_DEFAULT = 4;
export const FOV_SCALE_MAX = 24;

export const normalizeFovScale = (fovScale: number): number => clamp(fovScale, FOV_SCALE_MIN, FOV_SCALE_MAX);

export const fovScaleToSpanDeg = (fovScale: number): number => 360 / normalizeFovScale(fovScale);

export const cardinalLabelForAzimuth = (azimuthDeg: number): "N" | "E" | "S" | "W" | null => {
  const normalized = mod360(azimuthDeg);
  if (Math.abs(normalized - 0) < 0.0001 || Math.abs(normalized - 360) < 0.0001) return "N";
  if (Math.abs(normalized - 90) < 0.0001) return "E";
  if (Math.abs(normalized - 180) < 0.0001) return "S";
  if (Math.abs(normalized - 270) < 0.0001) return "W";
  return null;
};

export const formatAzimuthTick = (azimuthDeg: number): string => {
  const cardinal = cardinalLabelForAzimuth(azimuthDeg);
  if (cardinal) return cardinal;
  return `${mod360(azimuthDeg).toFixed(0)}°`;
};

export type PanoramaWindow = {
  centerDeg: number;
  spanDeg: number;
  startDeg: number;
  endDeg: number;
};

export const resolvePanoramaWindow = (centerDeg: number, spanDeg = 90): PanoramaWindow => {
  const span = Math.max(10, Math.min(360, spanDeg));
  const center = mod360(centerDeg);
  const startDeg = center - span / 2;
  const endDeg = center + span / 2;
  return { centerDeg: center, spanDeg: span, startDeg, endDeg };
};

export const chartXNormToAzimuthDeg = (xNorm: number): number => clamp(xNorm, 0, 1) * 360;

export const unwrapAzimuthForWindow = (azimuthDeg: number, referenceDeg: number): number => {
  const normalized = mod360(azimuthDeg);
  const candidates = [normalized - 360, normalized, normalized + 360];
  let best = candidates[0];
  let bestDistance = Math.abs(best - referenceDeg);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(candidate - referenceDeg);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};
