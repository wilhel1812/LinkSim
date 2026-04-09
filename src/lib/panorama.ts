import { computeSourceCentricRxMetrics, classifyPassFailState, type PassFailState } from "./passFailState";
import { haversineDistanceKm } from "./geo";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

const EARTH_RADIUS_M = 6_371_000;

export type PanoramaQuality = "drag" | "full";

export type PanoramaNodeCandidate = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  groundElevationM: number;
  antennaHeightM: number;
  rxGainDbi: number;
};

export type PanoramaNodeProjection = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  groundElevationM: number;
  antennaHeightM: number;
  targetElevationM: number;
  azimuthDeg: number;
  distanceKm: number;
  elevationAngleDeg: number;
  terrainBeforeDeg: number;
  angularClearanceDeg: number;
  clearanceMarginM: number;
  visible: boolean;
  state: PassFailState;
};

export type PanoramaRaySample = {
  distanceKm: number;
  lat: number;
  lon: number;
  terrainM: number;
  angleDeg: number;
  clutterAngleDeg: number;
  maxAngleBeforeDeg: number;
};

export type PanoramaRay = {
  azimuthDeg: number;
  maxDistanceKm: number;
  horizonDistanceKm: number;
  horizonLat: number;
  horizonLon: number;
  horizonTerrainM: number;
  horizonAngleDeg: number;
  clutterHorizonDistanceKm: number;
  clutterHorizonAngleDeg: number;
  samples: PanoramaRaySample[];
};

export type PanoramaResult = {
  rays: PanoramaRay[];
  nodes: PanoramaNodeProjection[];
  minAngleDeg: number;
  maxAngleDeg: number;
  radiusPolicyKm: number;
};

export type PanoramaBuildOptions = {
  baseRadiusKm?: number;
  maxRadiusKm?: number;
  azimuthStepDeg?: number;
  radialSamples?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const toRadians = (deg: number): number => (deg * Math.PI) / 180;
const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

export const qualityToSampling = (quality: PanoramaQuality): { azimuthStepDeg: number; radialSamples: number } =>
  quality === "drag"
    ? { azimuthStepDeg: 5, radialSamples: 64 }
    : { azimuthStepDeg: 1, radialSamples: 192 };

export const earthCurvatureDropM = (distanceKm: number, kFactor: number): number => {
  const distanceM = Math.max(0, distanceKm * 1000);
  const effectiveRadiusM = EARTH_RADIUS_M * Math.max(0.5, kFactor);
  return (distanceM * distanceM) / (2 * effectiveRadiusM);
};

export const destinationForDistanceKm = (
  origin: { lat: number; lon: number },
  azimuthDeg: number,
  distanceKm: number,
): { lat: number; lon: number } => {
  const delta = (distanceKm * 1000) / EARTH_RADIUS_M;
  const theta = toRadians(azimuthDeg);
  const phi1 = toRadians(origin.lat);
  const lambda1 = toRadians(origin.lon);

  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(clamp(sinPhi2, -1, 1));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: toDegrees(phi2),
    lon: ((toDegrees(lambda2) + 540) % 360) - 180,
  };
};

export const azimuthFromToDeg = (from: { lat: number; lon: number }, to: { lat: number; lon: number }): number => {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const dLambda = toRadians(to.lon - from.lon);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
};

const resolveRayMaxDistanceKm = (
  origin: { lat: number; lon: number },
  azimuthDeg: number,
  baseRadiusKm: number,
  maxRadiusKm: number,
  terrainSampler: (lat: number, lon: number) => number | null,
): number => {
  let maxReach = Math.max(1, baseRadiusKm);
  for (let distanceKm = Math.ceil(baseRadiusKm); distanceKm <= maxRadiusKm; distanceKm += 1) {
    const point = destinationForDistanceKm(origin, azimuthDeg, distanceKm);
    if (terrainSampler(point.lat, point.lon) === null) break;
    maxReach = distanceKm;
  }
  return maxReach;
};

const lookupMaxAngleBefore = (samples: PanoramaRaySample[], distanceKm: number): number => {
  if (!samples.length) return -90;
  let maxBefore = -90;
  for (const sample of samples) {
    if (sample.distanceKm >= distanceKm) break;
    maxBefore = Math.max(maxBefore, sample.maxAngleBeforeDeg);
  }
  return maxBefore;
};

const clearanceMarginMeters = (
  elevationAngleDeg: number,
  terrainBeforeDeg: number,
  distanceKm: number,
): number => {
  const distanceM = Math.max(1, distanceKm * 1000);
  const deltaRad = toRadians(elevationAngleDeg - terrainBeforeDeg);
  return Math.tan(deltaRad) * distanceM;
};

export const buildPanorama = (params: {
  selectedSite: Site;
  effectiveLink: Link;
  propagationEnvironment: PropagationEnvironment;
  rxSensitivityTargetDbm: number;
  environmentLossDb: number;
  quality: PanoramaQuality;
  terrainSampler: (lat: number, lon: number) => number | null;
  nodeCandidates: PanoramaNodeCandidate[];
  options?: PanoramaBuildOptions;
}): PanoramaResult => {
  const { selectedSite, effectiveLink, propagationEnvironment, rxSensitivityTargetDbm, environmentLossDb, quality, terrainSampler, nodeCandidates } =
    params;
  const defaults = qualityToSampling(quality);
  const baseRadiusKm = Math.max(1, params.options?.baseRadiusKm ?? 50);
  const maxRadiusKm = Math.max(baseRadiusKm, params.options?.maxRadiusKm ?? 200);
  const azimuthStepDeg = clamp(params.options?.azimuthStepDeg ?? defaults.azimuthStepDeg, 1, 45);
  const radialSamples = Math.max(12, Math.round(params.options?.radialSamples ?? defaults.radialSamples));
  const clutterHeightM = Math.max(0, propagationEnvironment.clutterHeightM);

  const kFactor = Math.max(0.5, 1 + (propagationEnvironment.atmosphericBendingNUnits - 250) / 153);
  const sourceAbsM = selectedSite.groundElevationM + selectedSite.antennaHeightM;

  const rays: PanoramaRay[] = [];
  let minAngleDeg = Number.POSITIVE_INFINITY;
  let maxAngleDeg = Number.NEGATIVE_INFINITY;

  for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += azimuthStepDeg) {
    const maxDistanceKm = resolveRayMaxDistanceKm(selectedSite.position, azimuthDeg, baseRadiusKm, maxRadiusKm, terrainSampler);
    const samples: PanoramaRaySample[] = [];
    let maxAngleSoFar = -90;
    let maxClutterAngleSoFar = -90;
    let horizonAngleDeg = -90;
    let horizonDistanceKm = 0;
    let horizonLat = selectedSite.position.lat;
    let horizonLon = selectedSite.position.lon;
    let horizonTerrainM = selectedSite.groundElevationM;
    let clutterHorizonAngleDeg = -90;
    let clutterHorizonDistanceKm = 0;

    for (let i = 1; i <= radialSamples; i += 1) {
      const distanceKm = (maxDistanceKm * i) / radialSamples;
      const point = destinationForDistanceKm(selectedSite.position, azimuthDeg, distanceKm);
      const terrainM = terrainSampler(point.lat, point.lon);
      if (terrainM === null) break;
      const dropM = earthCurvatureDropM(distanceKm, kFactor);
      const distanceM = Math.max(1, distanceKm * 1000);
      const relativeTerrainM = terrainM - sourceAbsM - dropM;
      const relativeClutterM = terrainM + clutterHeightM - sourceAbsM - dropM;
      const angleDeg = toDegrees(Math.atan2(relativeTerrainM, distanceM));
      const clutterAngleDeg = toDegrees(Math.atan2(relativeClutterM, distanceM));

      const maxAngleBeforeDeg = maxAngleSoFar;
      maxAngleSoFar = Math.max(maxAngleSoFar, angleDeg);
      if (maxAngleSoFar === angleDeg) {
        horizonAngleDeg = angleDeg;
        horizonDistanceKm = distanceKm;
        horizonLat = point.lat;
        horizonLon = point.lon;
        horizonTerrainM = terrainM;
      }
      maxClutterAngleSoFar = Math.max(maxClutterAngleSoFar, clutterAngleDeg);
      if (maxClutterAngleSoFar === clutterAngleDeg) {
        clutterHorizonAngleDeg = clutterAngleDeg;
        clutterHorizonDistanceKm = distanceKm;
      }
      samples.push({
        distanceKm,
        lat: point.lat,
        lon: point.lon,
        terrainM,
        angleDeg,
        clutterAngleDeg,
        maxAngleBeforeDeg,
      });
      minAngleDeg = Math.min(minAngleDeg, angleDeg);
      maxAngleDeg = Math.max(maxAngleDeg, angleDeg);
    }

    rays.push({
      azimuthDeg,
      maxDistanceKm,
      horizonDistanceKm,
      horizonLat,
      horizonLon,
      horizonTerrainM,
      horizonAngleDeg,
      clutterHorizonDistanceKm,
      clutterHorizonAngleDeg,
      samples,
    });
  }

  const azimuthCount = rays.length;
  const nodes: PanoramaNodeProjection[] = nodeCandidates
    .filter((candidate) => candidate.id !== selectedSite.id)
    .map((candidate) => {
      const azimuthDeg = azimuthFromToDeg(selectedSite.position, { lat: candidate.lat, lon: candidate.lon });
      const distanceKm = Math.max(0.001, haversineDistanceKm(selectedSite.position, { lat: candidate.lat, lon: candidate.lon }));
      const dropM = earthCurvatureDropM(distanceKm, kFactor);
      const candidateAbs = candidate.groundElevationM + candidate.antennaHeightM;
      const elevationAngleDeg = toDegrees(Math.atan2(candidateAbs - sourceAbsM - dropM, Math.max(1, distanceKm * 1000)));

      const rayIndex = Math.round(azimuthDeg / azimuthStepDeg) % Math.max(1, azimuthCount);
      const ray = rays[rayIndex] ?? rays[0];
      const terrainBeforeDeg = ray ? lookupMaxAngleBefore(ray.samples, distanceKm) : -90;
      const visible = elevationAngleDeg > terrainBeforeDeg;
      const angularClearanceDeg = elevationAngleDeg - terrainBeforeDeg;
      const clearanceMarginM = clearanceMarginMeters(elevationAngleDeg, terrainBeforeDeg, distanceKm);

      const metrics = computeSourceCentricRxMetrics(
        candidate.lat,
        candidate.lon,
        selectedSite,
        effectiveLink,
        candidate.antennaHeightM,
        candidate.rxGainDbi,
        terrainSampler,
        quality === "drag" ? 16 : 24,
        propagationEnvironment,
      );
      const pass = metrics.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
      const state = classifyPassFailState(pass, metrics.terrainObstructed);

      minAngleDeg = Math.min(minAngleDeg, elevationAngleDeg);
      maxAngleDeg = Math.max(maxAngleDeg, elevationAngleDeg);

      return {
        id: candidate.id,
        name: candidate.name,
        lat: candidate.lat,
        lon: candidate.lon,
        groundElevationM: candidate.groundElevationM,
        antennaHeightM: candidate.antennaHeightM,
        targetElevationM: candidateAbs,
        azimuthDeg,
        distanceKm,
        elevationAngleDeg,
        terrainBeforeDeg,
        angularClearanceDeg,
        clearanceMarginM,
        visible,
        state,
      };
    });

  if (!Number.isFinite(minAngleDeg) || !Number.isFinite(maxAngleDeg)) {
    minAngleDeg = -5;
    maxAngleDeg = 5;
  }
  if (maxAngleDeg - minAngleDeg < 4) {
    const mid = (maxAngleDeg + minAngleDeg) / 2;
    minAngleDeg = mid - 2;
    maxAngleDeg = mid + 2;
  }

  return {
    rays,
    nodes,
    minAngleDeg,
    maxAngleDeg,
    radiusPolicyKm: baseRadiusKm,
  };
};
