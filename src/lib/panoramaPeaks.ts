import { haversineDistanceKm } from "./geo";
import { azimuthFromToDeg } from "./panorama";
import { mod360, unwrapAzimuthForWindow } from "./panoramaView";
import { OPEN_PEAK_MAP_INDEX_BUCKETS, OPEN_PEAK_MAP_INDEX_META, type OpenPeakMapIndexEntry } from "../data/openPeakMapIndex";

export type PanoramaPeakCandidate = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  azimuthDeg: number;
  distanceKm: number;
};

type PeakIndex = Map<string, OpenPeakMapIndexEntry[]>;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const bucketLat = (lat: number): number => Math.floor(lat);
const bucketLon = (lon: number): number => Math.floor(lon);
const bucketKey = (latBucket: number, lonBucket: number): string => `${latBucket}:${lonBucket}`;

const PEAK_INDEX: PeakIndex = (() => {
  const next: PeakIndex = new Map();
  for (const [key, entries] of Object.entries(OPEN_PEAK_MAP_INDEX_BUCKETS)) {
    next.set(key, entries);
  }
  return next;
})();

export const OPEN_PEAK_MAP_STATS = {
  features: OPEN_PEAK_MAP_INDEX_META.featureCount,
  buckets: OPEN_PEAK_MAP_INDEX_META.bucketCount,
  sourceSha256: OPEN_PEAK_MAP_INDEX_META.sourceSha256,
} as const;

const inWindow = (azimuthDeg: number, centerDeg: number, startDeg: number, endDeg: number): boolean => {
  const unwrapped = unwrapAzimuthForWindow(azimuthDeg, centerDeg);
  return unwrapped >= startDeg && unwrapped <= endDeg;
};

export const queryPanoramaPeaks = (params: {
  origin: { lat: number; lon: number };
  centerDeg: number;
  startDeg: number;
  endDeg: number;
  maxDistanceKm: number;
  limit?: number;
}): PanoramaPeakCandidate[] => {
  const { origin, centerDeg, startDeg, endDeg, maxDistanceKm } = params;
  const limit = Math.max(1, Math.min(2400, params.limit ?? 1200));

  const latRadiusDeg = clamp(maxDistanceKm / 111, 0.1, 12);
  const lonScale = Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180));
  const lonRadiusDeg = clamp(maxDistanceKm / (111 * lonScale), 0.1, 18);
  const minLat = bucketLat(origin.lat - latRadiusDeg);
  const maxLat = bucketLat(origin.lat + latRadiusDeg);
  const minLon = bucketLon(origin.lon - lonRadiusDeg);
  const maxLon = bucketLon(origin.lon + lonRadiusDeg);

  const matches: PanoramaPeakCandidate[] = [];
  for (let latBucket = minLat; latBucket <= maxLat; latBucket += 1) {
    for (let lonBucket = minLon; lonBucket <= maxLon; lonBucket += 1) {
      const bucket = PEAK_INDEX.get(bucketKey(latBucket, lonBucket));
      if (!bucket?.length) continue;
      for (const peak of bucket) {
        const distanceKm = haversineDistanceKm(origin, { lat: peak.lat, lon: peak.lon });
        if (distanceKm <= 0.05 || distanceKm > maxDistanceKm) continue;
        const azimuthDeg = mod360(azimuthFromToDeg(origin, { lat: peak.lat, lon: peak.lon }));
        if (!inWindow(azimuthDeg, centerDeg, startDeg, endDeg)) continue;
        matches.push({
          id: peak.id,
          name: peak.name,
          lat: peak.lat,
          lon: peak.lon,
          elevationM: Number.isFinite(peak.elevationM) ? peak.elevationM : null,
          azimuthDeg,
          distanceKm,
        });
      }
    }
  }

  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return matches.slice(0, limit);
};
