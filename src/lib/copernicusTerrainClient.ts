import { fromArrayBuffer } from "geotiff";
import type { SrtmTile } from "../types/radio";
import { tilesForBounds } from "./terrainTiles";
import type { TerrainDataset } from "./terrainDataset";

export type CopernicusDataset = Extract<TerrainDataset, "copernicus30" | "copernicus90">;

export type CopernicusLoadResult = {
  tiles: SrtmTile[];
  failedTiles: string[];
  fetchedTiles: string[];
  cacheHits: string[];
  fallbackTiles: string[];
};

type CopernicusRecommendation = {
  dataset: CopernicusDataset;
  completeness: number;
  expectedTiles: number;
  availableTiles: number;
  byDataset: Record<CopernicusDataset, { availableTiles: number; completeness: number }>;
};

const DATASET_PATH: Record<CopernicusDataset, "30m" | "90m"> = {
  copernicus30: "30m",
  copernicus90: "90m",
};

const CACHE_NAME = "linksim-copernicus-cog-v1";
const TILELIST_CACHE_KEY = "linksim-copernicus-tilelist-v1";
const TILE_INDEX_CACHE_KEY = "linksim-copernicus-tile-index-v1";
const TILELIST_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 90000;
const MAX_RETRIES = 5;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const parseCopernicusKey = (entry: string): string | null => {
  const match = entry.match(/Copernicus_DSM_COG_\d+_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}${match[3].toUpperCase()}${match[4]}`;
};

const tilePathForEntry = (entry: string): string => `${entry}/${entry}.tif`;

const requestWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const parseRetryAfterMs = (value: string | null): number | null => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds * 1000);
  const parsedDate = Date.parse(value);
  if (!Number.isFinite(parsedDate)) return null;
  const delta = parsedDate - Date.now();
  return delta > 0 ? delta : null;
};

const fetchWithRetry = async (url: string): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await requestWithTimeout(url);
      if (!response.ok) {
        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_RETRIES) {
          throw new Error(`HTTP ${response.status}`);
        }
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const delayMs = retryAfterMs ?? 1000 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(90000, delayMs)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const loadTileList = async (
  dataset: CopernicusDataset,
): Promise<Record<string, { entry: string; path: string }>> => {
  const cacheKey = dataset;
  try {
    const raw = localStorage.getItem(TILELIST_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<
        string,
        { fetchedAtMs: number; entries: Record<string, { entry: string; path: string }> }
      >;
      const cached = parsed[cacheKey];
      if (cached && Date.now() - cached.fetchedAtMs < TILELIST_TTL_MS) {
        return cached.entries;
      }
    }
  } catch {
    // Ignore corrupt cache and refetch.
  }

  const pathPrefix = DATASET_PATH[dataset];
  const response = await fetchWithRetry(`/copernicus/${pathPrefix}/tileList.txt`);
  const text = await response.text();
  const entries: Record<string, { entry: string; path: string }> = {};
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry) continue;
    const key = parseCopernicusKey(entry);
    if (!key) continue;
    entries[key] = { entry, path: tilePathForEntry(entry) };
  }

  try {
    const raw = localStorage.getItem(TILELIST_CACHE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<
          string,
          { fetchedAtMs: number; entries: Record<string, { entry: string; path: string }> }
        >)
      : {};
    parsed[cacheKey] = { fetchedAtMs: Date.now(), entries };
    localStorage.setItem(TILELIST_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // Best effort only.
  }

  return entries;
};

const readTileIndex = (dataset: CopernicusDataset): Set<string> => {
  try {
    const raw = localStorage.getItem(TILE_INDEX_CACHE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, { fetchedAtMs: number; keys: string[] }>;
    const entry = parsed[dataset];
    if (!entry) return new Set();
    return new Set(entry.keys);
  } catch {
    return new Set();
  }
};

const writeTileIndex = (dataset: CopernicusDataset, keys: string[]): void => {
  try {
    const raw = localStorage.getItem(TILE_INDEX_CACHE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<string, { fetchedAtMs: number; keys: string[] }>)
      : {};
    parsed[dataset] = { fetchedAtMs: Date.now(), keys };
    localStorage.setItem(TILE_INDEX_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // Best effort.
  }
};

const parseCopernicusTile = async (
  tileKey: string,
  dataset: CopernicusDataset,
  path: string,
  buffer: ArrayBuffer,
): Promise<SrtmTile> => {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [minLon, minLat] = image.getBoundingBox();
  const nodata = image.getGDALNoData();
  const raster = await image.readRasters({ interleave: true, samples: [0] });
  const out = new Int16Array(width * height);
  const nodataNumeric = nodata === null ? NaN : Number(nodata);
  for (let i = 0; i < out.length; i += 1) {
    const value = Number((raster as ArrayLike<number>)[i]);
    if (!Number.isFinite(value) || (Number.isFinite(nodataNumeric) && Math.abs(value - nodataNumeric) <= 0.01)) {
      out[i] = -32768;
      continue;
    }
    out[i] = Math.max(-32767, Math.min(32767, Math.round(value)));
  }
  return {
    key: tileKey,
    latStart: Math.floor(minLat),
    lonStart: Math.floor(minLon),
    size: Math.max(width, height),
    width,
    height,
    arcSecondSpacing: dataset === "copernicus30" ? 1 : 3,
    elevations: out,
    sourceKind: "auto-fetch",
    sourceId: dataset,
    sourceLabel: `Copernicus ${dataset === "copernicus30" ? "GLO-30" : "GLO-90"}`,
    sourceDetail: path,
  };
};

const getCachedOrFetchTile = async (
  pathPrefix: "30m" | "90m",
  path: string,
  tileKey: string,
): Promise<{ buffer: ArrayBuffer; fromCache: boolean }> => {
  const dataset: CopernicusDataset = pathPrefix === "30m" ? "copernicus30" : "copernicus90";
  const cache = await caches.open(CACHE_NAME);
  const proxiedUrl = `/copernicus/${pathPrefix}/${path}`;
  const localIndex = readTileIndex(dataset);
  if (localIndex.has(tileKey)) {
    const cached = await cache.match(proxiedUrl);
    if (cached) return { buffer: await cached.arrayBuffer(), fromCache: true };
  }
  const response = await fetchWithRetry(proxiedUrl);
  await cache.put(proxiedUrl, response.clone());
  return { buffer: await response.arrayBuffer(), fromCache: false };
};

export const loadCopernicusTilesForArea = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  dataset: CopernicusDataset,
): Promise<CopernicusLoadResult> => {
  const tileList = await loadTileList(dataset);
  const candidateKeys = tilesForBounds(minLat, maxLat, minLon, maxLon);
  const pathPrefix = DATASET_PATH[dataset];
  const fetchedTiles: string[] = [];
  const cacheHits: string[] = [];
  const failedTiles = new Set<string>();
  const fallbackTiles: string[] = [];
  const parsedTiles: SrtmTile[] = [];

  for (const key of candidateKeys) {
    const item = tileList[key];
    if (!item) {
      failedTiles.add(key);
      continue;
    }
    try {
      const { buffer, fromCache } = await getCachedOrFetchTile(pathPrefix, item.path, key);
      if (fromCache) cacheHits.push(key);
      else fetchedTiles.push(key);
      parsedTiles.push(await parseCopernicusTile(key, dataset, item.path, buffer));
    } catch {
      failedTiles.add(key);
    }
  }

  // Automatic fallback: if 30m fetch fails for some tiles, try 90m for those same tile keys.
  if (dataset === "copernicus30" && failedTiles.size > 0) {
    const fallbackList = await loadTileList("copernicus90");
    for (const key of Array.from(failedTiles)) {
      const item = fallbackList[key];
      if (!item) continue;
      try {
        const { buffer, fromCache } = await getCachedOrFetchTile(DATASET_PATH.copernicus90, item.path, key);
        if (fromCache) cacheHits.push(key);
        else fetchedTiles.push(key);
        parsedTiles.push(await parseCopernicusTile(key, "copernicus90", item.path, buffer));
        fallbackTiles.push(key);
        failedTiles.delete(key);
      } catch {
        // keep failed
      }
    }
  }

  const allLoadedKeys = [...cacheHits, ...fetchedTiles];
  if (allLoadedKeys.length > 0) {
    const existingIndex = readTileIndex(dataset);
    const merged = new Set([...existingIndex, ...allLoadedKeys]);
    writeTileIndex(dataset, Array.from(merged));
  }

  return { tiles: parsedTiles, failedTiles: Array.from(failedTiles), fetchedTiles, cacheHits, fallbackTiles };
};

export const clearCopernicusCache = async (): Promise<void> => {
  await caches.delete(CACHE_NAME);
  localStorage.removeItem(TILELIST_CACHE_KEY);
  localStorage.removeItem(TILE_INDEX_CACHE_KEY);
};

export const recommendCopernicusDatasetForArea = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  datasets?: readonly CopernicusDataset[],
): Promise<CopernicusRecommendation> => {
  const expected = Math.max(1, tilesForBounds(minLat, maxLat, minLon, maxLon).length);
  const keys = new Set(tilesForBounds(minLat, maxLat, minLon, maxLon));
  const toCheck = datasets ?? (["copernicus30", "copernicus90"] as CopernicusDataset[]);
  const stats: Array<{ dataset: CopernicusDataset; availableTiles: number; completeness: number }> = [];
  for (const dataset of toCheck) {
    try {
      const list = await loadTileList(dataset);
      let available = 0;
      for (const key of keys) if (list[key]) available += 1;
      stats.push({
        dataset,
        availableTiles: available,
        completeness: available / expected,
      });
    } catch {
      stats.push({ dataset, availableTiles: 0, completeness: 0 });
    }
  }
  const sorted = [...stats].sort((a, b) => {
    if (b.completeness !== a.completeness) return b.completeness - a.completeness;
    return a.dataset === "copernicus30" ? -1 : 1;
  });
  const best = sorted[0];
  return {
    dataset: best.dataset,
    completeness: best.completeness,
    expectedTiles: expected,
    availableTiles: best.availableTiles,
    byDataset: {
      copernicus30: {
        availableTiles: stats.find((entry) => entry.dataset === "copernicus30")?.availableTiles ?? 0,
        completeness: stats.find((entry) => entry.dataset === "copernicus30")?.completeness ?? 0,
      },
      copernicus90: {
        availableTiles: stats.find((entry) => entry.dataset === "copernicus90")?.availableTiles ?? 0,
        completeness: stats.find((entry) => entry.dataset === "copernicus90")?.completeness ?? 0,
      },
    },
  };
};
