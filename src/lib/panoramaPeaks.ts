import { haversineDistanceKm } from "./geo";
import { azimuthFromToDeg } from "./panorama";
import { mod360, unwrapAzimuthForWindow } from "./panoramaView";

export type PanoramaPeakKind = "peak" | "volcano";

export type PanoramaPeakCandidate = {
  id: string;
  kind: PanoramaPeakKind;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  azimuthDeg: number;
  distanceKm: number;
  source: "global-tile";
};

export type PanoramaPeakTileEntry = {
  id: string;
  kind: PanoramaPeakKind;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
};

export type PanoramaPeakTileManifest = {
  version: string;
  generatedAt: string;
  tileDeg: number;
  tileUrlTemplate: string;
  ttlSeconds: number;
  source: {
    provider: "osm";
    includeNatural: Array<"peak" | "volcano">;
    namedOnly: true;
  };
  benchmark: {
    norwayNamedCount: number;
    minimumRequired: number;
    pass: boolean;
  };
};

type TilePayload = {
  tileId: string;
  version: string;
  entries: PanoramaPeakTileEntry[];
};

const DEFAULT_MANIFEST_URL = "/peak-tiles/v1/manifest.json";
const MANIFEST_URL = String(import.meta.env.VITE_PEAK_TILES_MANIFEST_URL ?? DEFAULT_MANIFEST_URL).trim() || DEFAULT_MANIFEST_URL;
const CACHE_NAME = "panorama-osm-peak-tiles-v1";
const CACHE_PATH_PREFIX = "/__panorama_osm_peak_tiles__/";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_TILE_FETCH = 160;

const memoryTileCache = new Map<string, { fetchedAt: number; payload: TilePayload }>();
const pendingTileFetches = new Map<string, Promise<TilePayload | null>>();
let manifestPromise: Promise<PanoramaPeakTileManifest> | null = null;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const tileIndex = (value: number, tileDeg: number): number => Math.floor(value / tileDeg);

const buildTileId = (latIndex: number, lonIndex: number): string => `${latIndex}:${lonIndex}`;

const cacheRequestForTile = (manifestVersion: string, tileId: string): Request =>
  new Request(`${CACHE_PATH_PREFIX}${encodeURIComponent(manifestVersion)}-${encodeURIComponent(tileId)}.json`);

const inWindow = (azimuthDeg: number, centerDeg: number, startDeg: number, endDeg: number): boolean => {
  const unwrapped = unwrapAzimuthForWindow(azimuthDeg, centerDeg);
  return unwrapped >= startDeg && unwrapped <= endDeg;
};

const resolveTileKeysForRadius = (origin: { lat: number; lon: number }, maxDistanceKm: number, tileDeg: number): string[] => {
  const latRadiusDeg = clamp(maxDistanceKm / 111, 0.1, 18);
  const lonScale = Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180));
  const lonRadiusDeg = clamp(maxDistanceKm / (111 * lonScale), 0.1, 36);
  const minLatTile = tileIndex(origin.lat - latRadiusDeg, tileDeg);
  const maxLatTile = tileIndex(origin.lat + latRadiusDeg, tileDeg);
  const minLonTile = tileIndex(origin.lon - lonRadiusDeg, tileDeg);
  const maxLonTile = tileIndex(origin.lon + lonRadiusDeg, tileDeg);
  const keys: string[] = [];
  for (let latTile = minLatTile; latTile <= maxLatTile; latTile += 1) {
    for (let lonTile = minLonTile; lonTile <= maxLonTile; lonTile += 1) {
      keys.push(buildTileId(latTile, lonTile));
      if (keys.length >= MAX_TILE_FETCH) return keys;
    }
  }
  return keys;
};

const tileUrl = (manifest: PanoramaPeakTileManifest, tileId: string): string =>
  manifest.tileUrlTemplate.replace("{tileId}", encodeURIComponent(tileId));

const getManifest = async (): Promise<PanoramaPeakTileManifest> => {
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Peak tile manifest fetch failed (${response.status})`);
    const manifest = (await response.json()) as PanoramaPeakTileManifest;
    if (!manifest.version || !manifest.tileUrlTemplate || !Number.isFinite(manifest.tileDeg) || manifest.tileDeg <= 0) {
      throw new Error("Invalid peak tile manifest");
    }
    return manifest;
  })();
  return manifestPromise;
};

const readTileFromPersistentCache = async (manifest: PanoramaPeakTileManifest, tileId: string): Promise<TilePayload | null> => {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(cacheRequestForTile(manifest.version, tileId));
  if (!match) return null;
  const payload = (await match.json()) as TilePayload;
  if (!payload || payload.version !== manifest.version || payload.tileId !== tileId || !Array.isArray(payload.entries)) return null;
  return payload;
};

const writeTileToPersistentCache = async (manifest: PanoramaPeakTileManifest, tileId: string, payload: TilePayload): Promise<void> => {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    cacheRequestForTile(manifest.version, tileId),
    new Response(JSON.stringify(payload), { headers: { "content-type": "application/json", "cache-control": "no-store" } }),
  );
};

const fetchTileFromNetwork = async (manifest: PanoramaPeakTileManifest, tileId: string): Promise<TilePayload> => {
  const response = await fetch(tileUrl(manifest, tileId), { cache: "no-store" });
  if (!response.ok) throw new Error(`Peak tile fetch failed (${response.status})`);
  const raw = (await response.json()) as { entries?: PanoramaPeakTileEntry[]; tileId?: string; version?: string };
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const normalized = entries
    .map((entry): PanoramaPeakTileEntry => {
      const kind: PanoramaPeakKind = entry.kind === "volcano" ? "volcano" : "peak";
      return {
        id: String(entry.id ?? "").trim(),
        kind,
        name: String(entry.name ?? "").trim(),
        lat: Number(entry.lat),
        lon: Number(entry.lon),
        elevationM: Number.isFinite(entry.elevationM) ? Number(entry.elevationM) : null,
      };
    })
    .filter((entry) => entry.id && entry.name && Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
  return {
    tileId: tileId,
    version: manifest.version,
    entries: normalized,
  };
};

const loadTile = async (manifest: PanoramaPeakTileManifest, tileId: string, allowNetwork: boolean): Promise<TilePayload | null> => {
  const ttlMs = Math.max(60_000, (manifest.ttlSeconds ?? 0) * 1000 || DEFAULT_TTL_MS);
  const cacheKey = `${manifest.version}|${tileId}`;
  const inMemory = memoryTileCache.get(cacheKey);
  if (inMemory && Date.now() - inMemory.fetchedAt <= ttlMs) return inMemory.payload;

  const pending = pendingTileFetches.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    const cached = await readTileFromPersistentCache(manifest, tileId);
    if (cached) {
      memoryTileCache.set(cacheKey, { fetchedAt: Date.now(), payload: cached });
      return cached;
    }
    if (!allowNetwork) return null;
    const fetched = await fetchTileFromNetwork(manifest, tileId);
    memoryTileCache.set(cacheKey, { fetchedAt: Date.now(), payload: fetched });
    await writeTileToPersistentCache(manifest, tileId, fetched);
    return fetched;
  })();

  pendingTileFetches.set(cacheKey, task);
  try {
    return await task;
  } finally {
    pendingTileFetches.delete(cacheKey);
  }
};

export const clearPanoramaPeakManifestCacheForTests = (): void => {
  manifestPromise = null;
  memoryTileCache.clear();
  pendingTileFetches.clear();
};

export const loadPanoramaPeaks = async (params: {
  origin: { lat: number; lon: number };
  centerDeg: number;
  startDeg: number;
  endDeg: number;
  maxDistanceKm: number;
  limit?: number;
  allowNetwork?: boolean;
}): Promise<PanoramaPeakCandidate[]> => {
  const limit = Math.max(1, Math.min(5000, params.limit ?? 1200));
  const allowNetwork = params.allowNetwork ?? true;
  const manifest = await getManifest();
  const keys = resolveTileKeysForRadius(params.origin, params.maxDistanceKm, manifest.tileDeg);
  const payloads = await Promise.all(keys.map((key) => loadTile(manifest, key, allowNetwork)));
  const entries = payloads.flatMap((payload) => payload?.entries ?? []);
  if (!entries.length) return [];

  const dedupe = new Map<string, PanoramaPeakCandidate>();
  for (const peak of entries) {
    const distanceKm = haversineDistanceKm(params.origin, { lat: peak.lat, lon: peak.lon });
    if (distanceKm <= 0.05 || distanceKm > params.maxDistanceKm) continue;
    const azimuthDeg = mod360(azimuthFromToDeg(params.origin, { lat: peak.lat, lon: peak.lon }));
    if (!inWindow(azimuthDeg, params.centerDeg, params.startDeg, params.endDeg)) continue;
    const key = `${peak.kind}|${peak.name.toLowerCase()}|${peak.lat.toFixed(5)}|${peak.lon.toFixed(5)}`;
    if (dedupe.has(key)) continue;
    dedupe.set(key, {
      id: peak.id,
      kind: peak.kind,
      name: peak.name,
      lat: peak.lat,
      lon: peak.lon,
      elevationM: peak.elevationM,
      azimuthDeg,
      distanceKm,
      source: "global-tile",
    });
  }

  return [...dedupe.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
};
