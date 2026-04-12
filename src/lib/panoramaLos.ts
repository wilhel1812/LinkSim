import { earthCurvatureDropM, type PanoramaRaySample } from "./panorama";

const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

export const maxTerrainAngleBeforeDistance = (samples: PanoramaRaySample[], distanceKm: number): number => {
  if (!samples.length || distanceKm <= 0) return Number.NEGATIVE_INFINITY;
  let maxBefore = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample.distanceKm >= distanceKm) break;
    maxBefore = Math.max(maxBefore, sample.angleDeg);
  }
  return maxBefore;
};

export const nearestSampleForDistance = (samples: PanoramaRaySample[], distanceKm: number): PanoramaRaySample | null => {
  if (!samples.length) return null;
  let best = samples[0];
  let bestDist = Math.abs(best.distanceKm - distanceKm);
  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i];
    const dist = Math.abs(sample.distanceKm - distanceKm);
    if (dist < bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
};

export const peakElevationAngleDeg = (params: {
  sourceAbsM: number;
  peakElevationM: number;
  distanceKm: number;
  kFactor: number;
}): number => {
  const { sourceAbsM, peakElevationM, distanceKm, kFactor } = params;
  const distanceM = Math.max(1, distanceKm * 1000);
  const dropM = earthCurvatureDropM(distanceKm, kFactor);
  const relativeM = peakElevationM - sourceAbsM - dropM;
  return toDegrees(Math.atan2(relativeM, distanceM));
};

export const isPeakLosVisible = (params: {
  samples: PanoramaRaySample[];
  distanceKm: number;
  peakElevationM: number | null;
  sourceAbsM: number;
  kFactor: number;
}): boolean => {
  const { samples, distanceKm, peakElevationM, sourceAbsM, kFactor } = params;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || peakElevationM == null) return false;
  const terrainBeforeDeg = maxTerrainAngleBeforeDistance(samples, distanceKm);
  if (!Number.isFinite(terrainBeforeDeg)) return false;
  const targetAngleDeg = peakElevationAngleDeg({
    sourceAbsM,
    peakElevationM,
    distanceKm,
    kFactor,
  });
  return targetAngleDeg > terrainBeforeDeg;
};
