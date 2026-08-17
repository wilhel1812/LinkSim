import { simulationAreaBoundsForSites } from "./simulationArea";
import {
  longitudeBoundsForCoordinates,
  tilesForBounds,
  unwrapLongitudeToInterval,
} from "./terrainTiles";
import type { Site, SrtmTile } from "../types/radio";

export type SimulationOverlayRadiusOption = "20" | "50" | "100" | "200";

export type BufferedSelectionArea = {
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  contains: (lat: number, lon: number) => boolean;
};

const SHARED_OPTIONS: SimulationOverlayRadiusOption[] = ["20", "50", "100", "200"];

export const optionsForSelectionCount = (selectionCount: number): SimulationOverlayRadiusOption[] =>
  selectionCount >= 0 ? SHARED_OPTIONS : SHARED_OPTIONS;

export const defaultOptionForSelectionCount = (selectionCount: number): SimulationOverlayRadiusOption =>
  selectionCount === 1 ? "50" : "20";

export const normalizeOverlayRadiusOptionForSelectionCount = (
  selectionCount: number,
  option: unknown,
): SimulationOverlayRadiusOption => {
  const candidate = typeof option === "string" ? (option as SimulationOverlayRadiusOption) : null;
  const allowed = optionsForSelectionCount(selectionCount);
  if (candidate && allowed.includes(candidate)) return candidate;
  return defaultOptionForSelectionCount(selectionCount);
};

export const resolveOverlayRadiusOptionForSelectionTransition = (params: {
  previousSelectionCount: number;
  selectionCount: number;
  option: unknown;
}): SimulationOverlayRadiusOption => {
  const normalized = normalizeOverlayRadiusOptionForSelectionCount(params.selectionCount, params.option);
  const previousWasSingle = params.previousSelectionCount === 1;
  const currentIsSingle = params.selectionCount === 1;
  if (previousWasSingle !== currentIsSingle) {
    return defaultOptionForSelectionCount(params.selectionCount);
  }
  return normalized;
};

export const isOverlayRadiusOption = (value: unknown): value is SimulationOverlayRadiusOption =>
  typeof value === "string" &&
  (["20", "50", "100", "200"] as const).includes(value as SimulationOverlayRadiusOption);

export const resolveTargetOverlayRadiusKm = (
  selectionCount: number,
  option: SimulationOverlayRadiusOption,
): number =>
  selectionCount >= 0 && (option === "20" || option === "50" || option === "100" || option === "200")
    ? Number(option)
    : 20;

export const resolveRequiredOverlayTerrainTileKeys = (
  sites: Pick<Site, "position">[],
  targetRadiusKm: number,
): string[] => {
  const bounds = simulationAreaBoundsForSites(sites, { overlayRadiusKm: targetRadiusKm });
  return bounds ? tilesForBounds(bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon) : [];
};

export const resolveMissingOverlayTerrainTileKeys = (
  sites: Pick<Site, "position">[],
  targetRadiusKm: number,
  srtmTiles: ReadonlyArray<SrtmTile>,
): string[] => {
  const loaded30m = new Set(
    srtmTiles.filter((tile) => tile.sourceId === "copernicus30").map((tile) => tile.key),
  );
  return resolveRequiredOverlayTerrainTileKeys(sites, targetRadiusKm).filter(
    (key) => !loaded30m.has(key),
  );
};

const distancePointToSegmentKm = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
};

const convexHull = (points: { x: number; y: number }[]): { x: number; y: number }[] => {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: { x: number; y: number }[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
};

const pointInPolygon = (x: number, y: number, polygon: { x: number; y: number }[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i];
    const { x: xj, y: yj } = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
};

export const buildBufferedSelectionArea = (
  sites: Pick<Site, "position">[],
  radiusKm: number,
): BufferedSelectionArea | null => {
  if (!sites.length) return null;
  const centerLat = sites.reduce((sum, site) => sum + site.position.lat, 0) / sites.length;
  const kmPerLat = 111.32;
  const kmPerLon = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)) * 111.32;
  const latDelta = Math.max(0.01, radiusKm / kmPerLat);
  const lonDelta = Math.max(0.01, radiusKm / kmPerLon);
  const longitudeBounds = longitudeBoundsForCoordinates(
    sites.map((site) => site.position.lon),
    lonDelta,
  );
  const projected = sites.map((site) => {
    const lon = unwrapLongitudeToInterval(site.position.lon, longitudeBounds);
    return { x: lon * kmPerLon, y: site.position.lat * kmPerLat };
  });
  const hull = convexHull(projected);
  const minLat = Math.min(...sites.map((site) => site.position.lat));
  const maxLat = Math.max(...sites.map((site) => site.position.lat));
  const contains = (lat: number, lon: number): boolean => {
    const x = unwrapLongitudeToInterval(lon, longitudeBounds) * kmPerLon;
    const y = lat * kmPerLat;
    if (hull.length <= 2) {
      const a = hull[0];
      const b = hull[1] ?? hull[0];
      return distancePointToSegmentKm(x, y, a.x, a.y, b.x, b.y) <= radiusKm;
    }
    if (pointInPolygon(x, y, hull)) return true;
    return hull.some((point, index) =>
      distancePointToSegmentKm(x, y, point.x, point.y, hull[(index + 1) % hull.length].x, hull[(index + 1) % hull.length].y) <= radiusKm,
    );
  };
  return {
    bounds: {
      minLat: minLat - latDelta,
      maxLat: maxLat + latDelta,
      minLon: longitudeBounds.unwrappedMinLon,
      maxLon: longitudeBounds.unwrappedMaxLon,
    },
    contains,
  };
};
