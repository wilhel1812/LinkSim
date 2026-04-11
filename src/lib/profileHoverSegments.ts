import type { ProfilePoint } from "../types/radio";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const firstFresnelRadiusM = (distanceKm: number, frequencyMHz: number, t: number): number => {
  const dTotalM = Math.max(1, distanceKm * 1000);
  const d1 = dTotalM * t;
  const d2 = dTotalM - d1;
  const wavelengthM = 300 / Math.max(1, frequencyMHz);
  return Math.sqrt((wavelengthM * d1 * d2) / dTotalM);
};

export type HoverProfileSegmentPoint = {
  distanceKm: number;
  losM: number;
  fresnelTopM: number;
  fresnelBottomM: number;
};

export type HoverProfileSegment = {
  id: "from-to-cursor" | "to-to-cursor";
  points: HoverProfileSegmentPoint[];
};

const buildSegment = (
  segmentPoints: ProfilePoint[],
  sourceAntennaAbsM: number,
  targetAntennaAbsM: number,
  frequencyMHz: number,
): HoverProfileSegmentPoint[] => {
  if (segmentPoints.length < 2) return [];
  const sourceDistanceKm = segmentPoints[0]?.distanceKm ?? 0;
  const targetDistanceKm = segmentPoints[segmentPoints.length - 1]?.distanceKm ?? sourceDistanceKm;
  const totalDistanceKm = Math.max(0.001, targetDistanceKm - sourceDistanceKm);

  return segmentPoints.map((point) => {
    const segmentDistanceKm = Math.max(0, point.distanceKm - sourceDistanceKm);
    const t = clamp(segmentDistanceKm / totalDistanceKm, 0, 1);
    const losM = sourceAntennaAbsM + (targetAntennaAbsM - sourceAntennaAbsM) * t;
    const fresnelRadiusM = firstFresnelRadiusM(totalDistanceKm, frequencyMHz, t);
    return {
      distanceKm: point.distanceKm,
      losM,
      fresnelTopM: losM + fresnelRadiusM,
      fresnelBottomM: losM - fresnelRadiusM,
    };
  });
};

export const buildHoverProfileSegments = (
  profile: ProfilePoint[],
  cursorIndex: number,
  fromAntennaHeightM: number,
  toAntennaHeightM: number,
  frequencyMHz: number,
): HoverProfileSegment[] => {
  if (profile.length < 2) return [];
  const clampedCursorIndex = Math.max(0, Math.min(profile.length - 1, Math.floor(cursorIndex)));
  const cursorPoint = profile[clampedCursorIndex] ?? profile[profile.length - 1];
  if (!cursorPoint) return [];

  const fromStart = profile[0];
  const toStart = profile[profile.length - 1];
  const isFullPath = clampedCursorIndex >= profile.length - 1;
  const fromSegmentPoints = profile.slice(0, clampedCursorIndex + 1);
  const toSegmentPoints = profile.slice(clampedCursorIndex);

  const fromSegment = buildSegment(
    fromSegmentPoints,
    fromStart.terrainM + fromAntennaHeightM,
    isFullPath ? toStart.terrainM + toAntennaHeightM : cursorPoint.terrainM + 2,
    frequencyMHz,
  );
  const toSegment = buildSegment(
    toSegmentPoints,
    isFullPath ? fromStart.terrainM + fromAntennaHeightM : cursorPoint.terrainM + 2,
    toStart.terrainM + toAntennaHeightM,
    frequencyMHz,
  );

  const segments: HoverProfileSegment[] = [];
  if (fromSegment.length >= 2) {
    segments.push({ id: "from-to-cursor", points: fromSegment });
  }
  if (toSegment.length >= 2) {
    segments.push({ id: "to-to-cursor", points: toSegment });
  }
  return segments;
};
