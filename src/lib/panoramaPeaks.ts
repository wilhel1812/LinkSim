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
  source: "local-index" | "overpass-tile";
};

export type PanoramaPeakTileMeta = {
  tileId: string;
  version: string;
  fetchedAt: number;
  ttlMs: number;
  bounds: { south: number; west: number; north: number; east: number };
  source: "overpass";
};

export type PanoramaPeakTileEntry = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  source: "overpass-tile";
};

type PeakIndex = Map<string, OpenPeakMapIndexEntry[]>;
type TilePayload = { meta: PanoramaPeakTileMeta; entries: PanoramaPeakTileEntry[] };

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TILE_DEG = 0.5;
const TILE_CACHE_VERSION = "v2";
const TILE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CACHE_NAME = "panorama-peak-tiles-v2";
const CACHE_PATH_PREFIX = "/__panorama_peak_tiles_v2__/";
const MAX_TILE_FETCH = 96;

const memoryTileCache = new Map<string, TilePayload>();
const pendingTileFetches = new Map<string, Promise<TilePayload>>();

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const bucketLat = (lat: number): number => Math.floor(lat);
const bucketLon = (lon: number): number => Math.floor(lon);
const bucketKey = (latBucket: number, lonBucket: number): string => `${latBucket}:${lonBucket}`;
const tileIndex = (value: number): number => Math.floor(value / TILE_DEG);

const tileBoundsFromKey = (key: string): { south: number; west: number; north: number; east: number } => {
  const [latToken, lonToken] = key.split(":");
  const lat = Number(latToken);
  const lon = Number(lonToken);
  const south = lat * TILE_DEG;
  const west = lon * TILE_DEG;
  return { south, west, north: south + TILE_DEG, east: west + TILE_DEG };
};

const PEAK_INDEX: PeakIndex = (() => {
  const next: PeakIndex = new Map();
  for (const [key, entries] of Object.entries(OPEN_PEAK_MAP_INDEX_BUCKETS)) next.set(key, entries);
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

const resolveTileKeysForRadius = (origin: { lat: number; lon: number }, maxDistanceKm: number): string[] => {
  const latRadiusDeg = clamp(maxDistanceKm / 111, 0.1, 12);
  const lonScale = Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180));
  const lonRadiusDeg = clamp(maxDistanceKm / (111 * lonScale), 0.1, 18);
  const minLatTile = tileIndex(origin.lat - latRadiusDeg);
  const maxLatTile = tileIndex(origin.lat + latRadiusDeg);
  const minLonTile = tileIndex(origin.lon - lonRadiusDeg);
  const maxLonTile = tileIndex(origin.lon + lonRadiusDeg);
  const keys: string[] = [];
  for (let latTile = minLatTile; latTile <= maxLatTile; latTile += 1) {
    for (let lonTile = minLonTile; lonTile <= maxLonTile; lonTile += 1) {
      keys.push(`${latTile}:${lonTile}`);
      if (keys.length >= MAX_TILE_FETCH) return keys;
    }
  }
  return keys;
};

const queryLocalIndex = (params: {
  origin: { lat: number; lon: number };
  centerDeg: number;
  startDeg: number;
  endDeg: number;
  maxDistanceKm: number;
  limit: number;
}): PanoramaPeakCandidate[] => {
  const { origin, centerDeg, startDeg, endDeg, maxDistanceKm, limit } = params;
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
          source: "local-index",
        });
      }
    }
  }
  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return matches.slice(0, limit);
};

const cacheRequestForTile = (tileId: string): Request => new Request(`${CACHE_PATH_PREFIX}${encodeURIComponent(tileId)}.json`);

const parseOverpassPeakResponse = (payload: unknown, tileId: string, bounds: PanoramaPeakTileMeta["bounds"]): TilePayload => {
  const elements = Array.isArray((payload as { elements?: unknown[] })?.elements) ? (payload as { elements: unknown[] }).elements : [];
  const entries: PanoramaPeakTileEntry[] = [];
  for (const item of elements) {
    const element = item as {
      id?: number | string;
      type?: string;
      lat?: number;
      lon?: number;
      center?: { lat?: number; lon?: number };
      tags?: Record<string, unknown>;
    };
    const tags = element.tags ?? {};
    const name = String(tags.name ?? "").trim();
    if (!name) continue;
    const lat = typeof element.lat === "number" ? element.lat : typeof element.center?.lat === "number" ? element.center.lat : null;
    const lon = typeof element.lon === "number" ? element.lon : typeof element.center?.lon === "number" ? element.center.lon : null;
    if (lat === null || lon === null) continue;
    const rawEle = String(tags.ele ?? "").trim();
    const eleNumber = Number(rawEle.replace(/[^0-9.+-]/g, ""));
    entries.push({
      id: `${String(element.type ?? "node")}:${String(element.id ?? `${lat.toFixed(6)}:${lon.toFixed(6)}`)}`,
      name,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      elevationM: Number.isFinite(eleNumber) ? Math.round(eleNumber) : null,
      source: "overpass-tile",
    });
  }
  const unique = new Map<string, PanoramaPeakTileEntry>();
  for (const entry of entries) unique.set(`${entry.name.toLowerCase()}|${entry.lat.toFixed(5)}|${entry.lon.toFixed(5)}`, entry);
  return {
    meta: {
      tileId,
      version: TILE_CACHE_VERSION,
      fetchedAt: Date.now(),
      ttlMs: TILE_TTL_MS,
      bounds,
      source: "overpass",
    },
    entries: [...unique.values()],
  };
};

const fetchTileFromNetwork = async (tileId: string): Promise<TilePayload> => {
  const bounds = tileBoundsFromKey(tileId);
  const query = `[out:json][timeout:25];
(
  node["natural"~"^(peak|volcano|saddle)$"]["name"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["natural"~"^(peak|volcano|saddle)$"]["name"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["natural"~"^(peak|volcano|saddle)$"]["name"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out center tags;`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Peak tile fetch failed (${response.status})`);
  const data = (await response.json()) as unknown;
  return parseOverpassPeakResponse(data, tileId, bounds);
};

const readTileFromPersistentCache = async (tileId: string): Promise<TilePayload | null> => {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(cacheRequestForTile(tileId));
  if (!match) return null;
  const payload = (await match.json()) as TilePayload;
  if (!payload?.meta?.fetchedAt || payload.meta.version !== TILE_CACHE_VERSION) return null;
  return payload;
};

const writeTileToPersistentCache = async (tileId: string, payload: TilePayload): Promise<void> => {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    cacheRequestForTile(tileId),
    new Response(JSON.stringify(payload), { headers: { "content-type": "application/json", "cache-control": "no-store" } }),
  );
};

const loadTile = async (tileId: string): Promise<TilePayload> => {
  const inMemory = memoryTileCache.get(tileId);
  if (inMemory && Date.now() - inMemory.meta.fetchedAt <= inMemory.meta.ttlMs) return inMemory;
  const pending = pendingTileFetches.get(tileId);
  if (pending) return pending;
  const task = (async () => {
    const cached = await readTileFromPersistentCache(tileId);
    if (cached && Date.now() - cached.meta.fetchedAt <= cached.meta.ttlMs) {
      memoryTileCache.set(tileId, cached);
      return cached;
    }
    const fetched = await fetchTileFromNetwork(tileId);
    memoryTileCache.set(tileId, fetched);
    await writeTileToPersistentCache(tileId, fetched);
    return fetched;
  })();
  pendingTileFetches.set(tileId, task);
  try {
    return await task;
  } finally {
    pendingTileFetches.delete(tileId);
  }
};

const mergeTileEntriesToCandidates = (params: {
  entries: PanoramaPeakTileEntry[];
  origin: { lat: number; lon: number };
  centerDeg: number;
  startDeg: number;
  endDeg: number;
  maxDistanceKm: number;
  limit: number;
}): PanoramaPeakCandidate[] => {
  const { entries, origin, centerDeg, startDeg, endDeg, maxDistanceKm, limit } = params;
  const candidates: PanoramaPeakCandidate[] = [];
  for (const peak of entries) {
    const distanceKm = haversineDistanceKm(origin, { lat: peak.lat, lon: peak.lon });
    if (distanceKm <= 0.05 || distanceKm > maxDistanceKm) continue;
    const azimuthDeg = mod360(azimuthFromToDeg(origin, { lat: peak.lat, lon: peak.lon }));
    if (!inWindow(azimuthDeg, centerDeg, startDeg, endDeg)) continue;
    candidates.push({
      id: peak.id,
      name: peak.name,
      lat: peak.lat,
      lon: peak.lon,
      elevationM: peak.elevationM,
      azimuthDeg,
      distanceKm,
      source: "overpass-tile",
    });
  }
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  return candidates.slice(0, limit);
};

export const queryPanoramaPeaks = (params: {
  origin: { lat: number; lon: number };
  centerDeg: number;
  startDeg: number;
  endDeg: number;
  maxDistanceKm: number;
  limit?: number;
}): PanoramaPeakCandidate[] =>
  queryLocalIndex({
    ...params,
    limit: Math.max(1, Math.min(2400, params.limit ?? 1200)),
  });

export const loadPanoramaPeaks = async (params: {
  origin: { lat: number; lon: number };
  centerDeg: number;
  startDeg: number;
  endDeg: number;
  maxDistanceKm: number;
  limit?: number;
}): Promise<PanoramaPeakCandidate[]> => {
  const limit = Math.max(1, Math.min(2400, params.limit ?? 1200));
  const tileKeys = resolveTileKeysForRadius(params.origin, params.maxDistanceKm);
  const tilePayloads = await Promise.allSettled(tileKeys.map((key) => loadTile(key)));
  const entries = tilePayloads
    .filter((item): item is PromiseFulfilledResult<TilePayload> => item.status === "fulfilled")
    .flatMap((item) => item.value.entries);
  if (entries.length) {
    const merged = mergeTileEntriesToCandidates({ ...params, entries, limit });
    if (merged.length) return merged;
  }
  // Fallback for transient network failures.
  return queryLocalIndex({ ...params, limit });
};
