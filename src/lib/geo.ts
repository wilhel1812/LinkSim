import type { Coordinates } from "../types/radio";

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

export const haversineDistanceKm = (a: Coordinates, b: Coordinates): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return (EARTH_RADIUS_M * c) / 1000;
};

export const interpolateCoordinate = (
  a: Coordinates,
  b: Coordinates,
  t: number,
): Coordinates => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t,
});
