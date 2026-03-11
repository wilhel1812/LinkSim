import { haversineDistanceKm, interpolateCoordinate } from "./geo";
import type { Coordinates } from "../types/radio";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

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

type TerrainSampler = (coordinates: Coordinates) => number | null;

type TerrainLossInput = {
  from: Coordinates;
  to: Coordinates;
  fromAntennaAbsM: number;
  toAntennaAbsM: number;
  frequencyMHz: number;
  terrainSampler: TerrainSampler;
  samples?: number;
};

export const estimateTerrainExcessLossDb = ({
  from,
  to,
  fromAntennaAbsM,
  toAntennaAbsM,
  frequencyMHz,
  terrainSampler,
  samples = 24,
}: TerrainLossInput): number => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(from, to));

  let maxV = Number.NEGATIVE_INFINITY;
  const terrainTrace: number[] = [];

  for (let i = 1; i < samples - 1; i += 1) {
    const t = i / (samples - 1);
    const p = interpolateCoordinate(from, to, t);
    const terrain = terrainSampler(p);
    if (terrain === null) continue;

    terrainTrace.push(terrain);
    const los = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * t;
    const fresnel = Math.max(0.5, firstFresnelRadiusM(distanceKm, frequencyMHz, t));
    const v = (terrain - los) / fresnel;
    maxV = Math.max(maxV, v);
  }

  if (!Number.isFinite(maxV)) return 0;

  const diffractionLoss = knifeEdgeLossDb(maxV);
  const roughnessStdM = stddev(terrainTrace);
  const roughnessLoss = clamp((roughnessStdM - 15) * 0.18, 0, 10);

  return clamp(diffractionLoss + roughnessLoss, 0, 35);
};
