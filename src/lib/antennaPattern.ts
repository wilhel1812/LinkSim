import { haversineDistanceKm, initialBearingDeg } from "./geo";
import type { Coordinates, Site } from "../types/radio";

export type AntennaPatternSettings = Pick<
  Site,
  | "antennaMode"
  | "antennaAzimuthDeg"
  | "antennaTiltDeg"
  | "antennaHorizontalBeamwidthDeg"
  | "antennaVerticalBeamwidthDeg"
  | "antennaMaxAttenuationDb"
>;

export const DEFAULT_DIRECTIONAL_ANTENNA = {
  azimuthDeg: 0,
  tiltDeg: 0,
  horizontalBeamwidthDeg: 60,
  verticalBeamwidthDeg: 30,
  maxAttenuationDb: 25,
} as const;

export type ResolvedAntennaPattern =
  | { mode: "omnidirectional" }
  | {
      mode: "directional";
      azimuthDeg: number;
      tiltDeg: number;
      horizontalBeamwidthDeg: number;
      verticalBeamwidthDeg: number;
      maxAttenuationDb: number;
    };

export type AntennaDirection = {
  azimuthDeg: number;
  elevationDeg: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finiteOr = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? value as number : fallback;
const normalizeDegrees = (value: number): number => ((value % 360) + 360) % 360;

export const shortestAngularOffsetDeg = (fromDeg: number, toDeg: number): number =>
  ((normalizeDegrees(toDeg) - normalizeDegrees(fromDeg) + 540) % 360) - 180;

export const resolveSiteAntennaPattern = (site: AntennaPatternSettings): ResolvedAntennaPattern => {
  if (site.antennaMode !== "directional") return { mode: "omnidirectional" };
  return {
    mode: "directional",
    azimuthDeg: normalizeDegrees(finiteOr(site.antennaAzimuthDeg, DEFAULT_DIRECTIONAL_ANTENNA.azimuthDeg)),
    tiltDeg: clamp(finiteOr(site.antennaTiltDeg, DEFAULT_DIRECTIONAL_ANTENNA.tiltDeg), -90, 90),
    horizontalBeamwidthDeg: clamp(
      finiteOr(site.antennaHorizontalBeamwidthDeg, DEFAULT_DIRECTIONAL_ANTENNA.horizontalBeamwidthDeg),
      1,
      180,
    ),
    verticalBeamwidthDeg: clamp(
      finiteOr(site.antennaVerticalBeamwidthDeg, DEFAULT_DIRECTIONAL_ANTENNA.verticalBeamwidthDeg),
      1,
      180,
    ),
    maxAttenuationDb: clamp(
      finiteOr(site.antennaMaxAttenuationDb, DEFAULT_DIRECTIONAL_ANTENNA.maxAttenuationDb),
      0,
      60,
    ),
  };
};

export const antennaPatternSignature = (site: AntennaPatternSettings): string => {
  const pattern = resolveSiteAntennaPattern(site);
  if (pattern.mode === "omnidirectional") return pattern.mode;
  return [
    pattern.mode,
    pattern.azimuthDeg,
    pattern.tiltDeg,
    pattern.horizontalBeamwidthDeg,
    pattern.verticalBeamwidthDeg,
    pattern.maxAttenuationDb,
  ].join(":");
};

export const antennaAttenuationDb = (site: AntennaPatternSettings, direction: AntennaDirection): number => {
  const pattern = resolveSiteAntennaPattern(site);
  if (pattern.mode === "omnidirectional") return 0;
  const horizontalOffset = shortestAngularOffsetDeg(pattern.azimuthDeg, direction.azimuthDeg);
  const verticalOffset = direction.elevationDeg - pattern.tiltDeg;
  const horizontal = 12 * (horizontalOffset / pattern.horizontalBeamwidthDeg) ** 2;
  const vertical = 12 * (verticalOffset / pattern.verticalBeamwidthDeg) ** 2;
  return Math.min(pattern.maxAttenuationDb, horizontal + vertical);
};

export const effectiveDirectionalGainDbi = (
  peakGainDbi: number,
  site: Site,
  direction: AntennaDirection,
): number => peakGainDbi - antennaAttenuationDb(site, direction);

export const orientationBetweenPoints = (
  from: Coordinates,
  fromAntennaAbsM: number,
  to: Coordinates,
  toAntennaAbsM: number,
): AntennaDirection => {
  const earthRadiusM = 6_371_000;
  const centralAngle = (haversineDistanceKm(from, to) * 1000) / earthRadiusM;
  const fromRadius = earthRadiusM + fromAntennaAbsM;
  const toRadius = earthRadiusM + toAntennaAbsM;
  const horizontalM = toRadius * Math.sin(centralAngle);
  const verticalM = toRadius * Math.cos(centralAngle) - fromRadius;
  return {
    azimuthDeg: initialBearingDeg(from, to),
    elevationDeg: (Math.atan2(verticalM, Math.max(0.001, horizontalM)) * 180) / Math.PI,
  };
};

export const orientationTowardSite = (fromSite: Site, toSite: Site): AntennaDirection =>
  orientationBetweenPoints(
    fromSite.position,
    fromSite.groundElevationM + fromSite.antennaHeightM,
    toSite.position,
    toSite.groundElevationM + toSite.antennaHeightM,
  );

export const effectiveGainTowardSiteDbi = (peakGainDbi: number, fromSite: Site, toSite: Site): number =>
  effectiveDirectionalGainDbi(peakGainDbi, fromSite, orientationTowardSite(fromSite, toSite));

export const resolveTrackedSiteOrientation = (site: Site, sites: Site[]): Site => {
  if (site.antennaMode !== "directional" || !site.antennaTargetSiteId) return site;
  const target = sites.find((candidate) => candidate.id === site.antennaTargetSiteId && candidate.id !== site.id);
  if (!target) return { ...site, antennaTargetSiteId: undefined };
  const orientation = orientationTowardSite(site, target);
  return { ...site, antennaAzimuthDeg: orientation.azimuthDeg, antennaTiltDeg: orientation.elevationDeg };
};

export const resolveTrackedSiteOrientations = (sites: Site[]): Site[] =>
  sites.map((site) => resolveTrackedSiteOrientation(site, sites));
