import { haversineDistanceKm, interpolateCoordinate } from "./geo";
import type { Coordinates, Polarization } from "../types/radio";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const EARTH_RADIUS_M = 6_371_000;

export const atmosphericBendingNUnitsToKFactor = (nUnits: number): number => {
  const n = clamp(nUnits, 250, 400);
  return clamp(1 + (n - 250) / 153, 1, 2);
};

const firstFresnelRadiusM = (distanceKm: number, frequencyMHz: number, t: number): number => {
  const dTotalM = distanceKm * 1000;
  const d1 = dTotalM * t;
  const d2 = dTotalM - d1;
  const wavelengthM = 300 / frequencyMHz;
  return Math.sqrt((wavelengthM * d1 * d2) / dTotalM);
};

const knifeEdgeLossDb = (v: number): number => {
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
};

const stddev = (values: number[]): number => {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
};

const earthBulgeM = (distanceM: number, xM: number, kFactor: number): number => {
  const effectiveRadius = EARTH_RADIUS_M * Math.max(1, kFactor);
  return (xM * (distanceM - xM)) / (2 * effectiveRadius);
};

type TerrainSampler = (coordinates: Coordinates) => number | null;

type TerrainLossInput = {
  from: Coordinates;
  to: Coordinates;
  fromAntennaAbsM: number;
  toAntennaAbsM: number;
  frequencyMHz: number;
  terrainSampler: TerrainSampler;
  samples?: number;
  kFactor?: number;
  clutterHeightM?: number;
  polarization?: Polarization;
};

type TerrainLosInput = {
  from: Coordinates;
  to: Coordinates;
  fromAntennaAbsM: number;
  toAntennaAbsM: number;
  terrainSampler: TerrainSampler;
  samples?: number;
  kFactor?: number;
  clutterHeightM?: number;
};

export const estimateTerrainExcessLossDb = ({
  from,
  to,
  fromAntennaAbsM,
  toAntennaAbsM,
  frequencyMHz,
  terrainSampler,
  samples = 24,
  kFactor = 4 / 3,
  clutterHeightM = 0,
  polarization = "Vertical",
}: TerrainLossInput): number => {
  const sampleCount = Math.max(16, Math.round(samples));
  const distanceKm = Math.max(0.001, haversineDistanceKm(from, to));
  const distanceM = distanceKm * 1000;
  const wavelengthM = 300 / Math.max(1, frequencyMHz);

  const trace: { distanceM: number; terrainM: number }[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
    const p = interpolateCoordinate(from, to, t);
    const terrain = terrainSampler(p);
    if (terrain === null) continue;
    trace.push({
      distanceM: distanceM * t,
      terrainM: terrain,
    });
  }

  if (trace.length < 3) return 0;

  const terrainStd = stddev(trace.map((point) => point.terrainM));
  const terrainAt = (index: number): number => trace[index]?.terrainM ?? 0;
  const distanceAt = (index: number): number => trace[index]?.distanceM ?? 0;

  const segmentLoss = (
    startIndex: number,
    endIndex: number,
    startHeightM: number,
    endHeightM: number,
    depth: number,
  ): number => {
    if (endIndex - startIndex < 2) return 0;
    const segmentDistanceM = Math.max(1, distanceAt(endIndex) - distanceAt(startIndex));
    let maxV = Number.NEGATIVE_INFINITY;
    let maxIndex = -1;
    let maxObstacleM = 0;
    let maxClearanceM = Number.NEGATIVE_INFINITY;

    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const d1 = distanceAt(i) - distanceAt(startIndex);
      const d2 = distanceAt(endIndex) - distanceAt(i);
      if (d1 <= 0 || d2 <= 0) continue;
      const t = d1 / segmentDistanceM;
      const losM = startHeightM + (endHeightM - startHeightM) * t;
      const bulgeM = earthBulgeM(segmentDistanceM, d1, kFactor);
      const clutterBoost = Math.max(0, clutterHeightM) * 0.55;
      const obstacleM = terrainAt(i) + bulgeM + clutterBoost;
      const clearanceM = obstacleM - losM;
      const fresnelM = Math.max(0.5, Math.sqrt((wavelengthM * d1 * d2) / segmentDistanceM));
      const v = clearanceM / fresnelM;
      if (v > maxV) {
        maxV = v;
        maxIndex = i;
        maxObstacleM = obstacleM;
        maxClearanceM = clearanceM;
      }
    }

    if (maxIndex < 0 || maxV <= -0.78) return 0;
    const directLoss = knifeEdgeLossDb(maxV) + (polarization === "Horizontal" ? 0.5 : 0);
    if (maxClearanceM <= 0) {
      // Fresnel intrusion without geometric LOS blockage: keep this mild and non-recursive.
      return directLoss * 0.32;
    }
    if (depth >= 4) return directLoss;
    const left = segmentLoss(startIndex, maxIndex, startHeightM, maxObstacleM, depth + 1);
    const right = segmentLoss(maxIndex, endIndex, maxObstacleM, endHeightM, depth + 1);
    return directLoss + left + right;
  };

  const diffractionLoss = segmentLoss(0, trace.length - 1, fromAntennaAbsM, toAntennaAbsM, 0);
  // Residual clutter penalty for irregular terrain that is not directly blocking Fresnel.
  const roughnessLoss = clamp((terrainStd - 20) * 0.12, 0, 8);
  const clutterLoss = clamp(clutterHeightM * 0.22, 0, 12);

  const baselineFresnelM = firstFresnelRadiusM(distanceKm, frequencyMHz, 0.5);
  if (!Number.isFinite(diffractionLoss) || !Number.isFinite(baselineFresnelM)) {
    return 0;
  }

  return clamp(diffractionLoss + roughnessLoss + clutterLoss, 0, 90);
};

export const isTerrainLineObstructed = ({
  from,
  to,
  fromAntennaAbsM,
  toAntennaAbsM,
  terrainSampler,
  samples = 24,
  kFactor = 4 / 3,
  clutterHeightM = 0,
}: TerrainLosInput): boolean => {
  const sampleCount = Math.max(12, Math.round(samples));
  const distanceKm = Math.max(0.001, haversineDistanceKm(from, to));
  const distanceM = distanceKm * 1000;
  const clutterBoost = Math.max(0, clutterHeightM) * 0.55;

  for (let i = 1; i < sampleCount - 1; i += 1) {
    const t = i / (sampleCount - 1);
    const p = interpolateCoordinate(from, to, t);
    const terrain = terrainSampler(p);
    if (terrain === null) continue;
    const d1 = distanceM * t;
    const losM = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * t;
    const bulgeM = earthBulgeM(distanceM, d1, kFactor);
    const obstacleM = terrain + bulgeM + clutterBoost;
    if (obstacleM > losM) return true;
  }
  return false;
};
