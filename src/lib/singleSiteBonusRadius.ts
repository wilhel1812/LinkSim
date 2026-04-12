import type { Site, SrtmTile } from "../types/radio";

const EARTH_RADIUS_KM = 6_371;

export type SingleSiteBonusRadiusOptions = {
  baseRadiusKm?: number;
  maxRadiusKm?: number;
  azimuthStepDeg?: number;
  radialStepKm?: number;
};

const toRadians = (deg: number): number => (deg * Math.PI) / 180;
const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

const tileKeyForCoordinate = (lat: number, lon: number): string => {
  const latBase = Math.floor(Math.abs(lat));
  const lonBase = Math.floor(Math.abs(lon));
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${ns}${String(latBase).padStart(2, "0")}${ew}${String(lonBase).padStart(3, "0")}`;
};

const destinationForDistanceKm = (
  origin: { lat: number; lon: number },
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lon: number } => {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRadians(bearingDeg);
  const phi1 = toRadians(origin.lat);
  const lambda1 = toRadians(origin.lon);

  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: toDegrees(phi2),
    lon: ((toDegrees(lambda2) + 540) % 360) - 180,
  };
};

const loadedThirtyMeterTileKeys = (tiles: ReadonlyArray<SrtmTile>): Set<string> =>
  new Set(tiles.filter((tile) => tile.sourceId === "copernicus30").map((tile) => tile.key));

export const resolveSingleSiteBonusRadiusKm = (
  site: Pick<Site, "position"> | null,
  tiles: ReadonlyArray<SrtmTile>,
  options?: SingleSiteBonusRadiusOptions,
): number => {
  const baseRadiusKm = Math.max(1, options?.baseRadiusKm ?? 20);
  const maxRadiusKm = Math.max(baseRadiusKm, options?.maxRadiusKm ?? 100);
  const azimuthStepDeg = Math.max(1, Math.min(45, options?.azimuthStepDeg ?? 5));
  const radialStepKm = Math.max(0.5, Math.min(5, options?.radialStepKm ?? 1));

  if (!site) return baseRadiusKm;

  const tileKeys = loadedThirtyMeterTileKeys(tiles);
  if (!tileKeys.size) return baseRadiusKm;

  const centerKey = tileKeyForCoordinate(site.position.lat, site.position.lon);
  if (!tileKeys.has(centerKey)) return baseRadiusKm;

  let minContinuousRadiusKm = maxRadiusKm;
  for (let azimuth = 0; azimuth < 360; azimuth += azimuthStepDeg) {
    let radialCoverageKm = 0;
    for (let distanceKm = radialStepKm; distanceKm <= maxRadiusKm; distanceKm += radialStepKm) {
      const point = destinationForDistanceKm(site.position, azimuth, distanceKm);
      const key = tileKeyForCoordinate(point.lat, point.lon);
      if (!tileKeys.has(key)) break;
      radialCoverageKm = distanceKm;
    }
    minContinuousRadiusKm = Math.min(minContinuousRadiusKm, radialCoverageKm);
    if (minContinuousRadiusKm <= baseRadiusKm) return baseRadiusKm;
  }

  return Math.max(baseRadiusKm, Math.min(maxRadiusKm, Math.floor(minContinuousRadiusKm)));
};

