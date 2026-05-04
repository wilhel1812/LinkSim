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

export type CopernicusTileProgress = {
  dataset: CopernicusDataset;
  tileKey: string;
  bytes: number;
  completedTiles: number;
  totalTiles: number;
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
const FETCH_TIMEOUT_MS = 20000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

const TILELIST_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 800,
  maxDelayMs: 15_000,
};

const TILE_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 3_000,
};

type ParsedCopernicusTilePayload = {
  key: string;
  dataset: CopernicusDataset;
  path: string;
  latStart: number;
  lonStart: number;
  width: number;
  height: number;
  elevations: Int16Array;
};

type TileParserRequestMessage = {
  id: number;
  key: string;
  dataset: CopernicusDataset;
  path: string;
  buffer: ArrayBuffer;
};

type TileParserResponseMessage =
  | {
      id: number;
      ok: true;
      payload: ParsedCopernicusTilePayload;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

let parserWorkerInstance: Worker | null = null;
let parserRequestId = 0;
const parserPending = new Map<
  number,
  {
    resolve: (payload: ParsedCopernicusTilePayload) => void;
    reject: (error: Error) => void;
  }
>();

const getParserWorker = (): Worker | null => {
  if (typeof Worker === "undefined") return null;
  if (parserWorkerInstance) return parserWorkerInstance;
  const worker = new Worker(new URL("../workers/copernicusTileParser.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<TileParserResponseMessage>) => {
    const data = event.data;
    const pending = parserPending.get(data.id);
    if (!pending) return;
    parserPending.delete(data.id);
    if (data.ok) {
      pending.resolve(data.payload);
      return;
    }
    pending.reject(new Error(data.error));
  };
  worker.onerror = () => {
    for (const [, pending] of parserPending.entries()) {
      pending.reject(new Error("Copernicus tile parser worker failed"));
    }
    parserPending.clear();
  };
  parserWorkerInstance = worker;
  return worker;
};

const parseCopernicusTileOnWorker = (
  key: string,
  dataset: CopernicusDataset,
  path: string,
  buffer: ArrayBuffer,
): Promise<ParsedCopernicusTilePayload> => {
  const worker = getParserWorker();
  if (!worker) {
    return Promise.reject(new Error("Worker unavailable"));
  }
  const id = ++parserRequestId;
  return new Promise<ParsedCopernicusTilePayload>((resolve, reject) => {
    parserPending.set(id, { resolve, reject });
    const message: TileParserRequestMessage = { id, key, dataset, path, buffer };
    worker.postMessage(message, [buffer]);
  });
};

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

export const resolveRetryDelayMs = (
  policy: RetryPolicy,
  attempt: number,
  response: Response | null,
): number => {
  const retryAfterMs = parseRetryAfterMs(response?.headers.get("retry-after") ?? null);
  const exponentialMs = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const preferred = retryAfterMs ?? exponentialMs;
  return Math.min(policy.maxDelayMs, Math.max(policy.baseDelayMs, preferred));
};

const fetchWithRetry = async (url: string, policy: RetryPolicy): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxRetries; attempt += 1) {
    try {
      const response = await requestWithTimeout(url);
      if (!response.ok) {
        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= policy.maxRetries) {
          throw new Error(`HTTP ${response.status}`);
        }
        const delayMs = resolveRetryDelayMs(policy, attempt, response);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < policy.maxRetries) {
        const delayMs = resolveRetryDelayMs(policy, attempt, null);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
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
  const response = await fetchWithRetry(`/copernicus/${pathPrefix}/tileList.txt`, TILELIST_RETRY_POLICY);
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

const parseCopernicusTileInMain = async (
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
    latStart: Math.round(minLat),
    lonStart: Math.round(minLon),
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

const toSrtmTile = (payload: ParsedCopernicusTilePayload): SrtmTile => ({
  key: payload.key,
  latStart: payload.latStart,
  lonStart: payload.lonStart,
  size: Math.max(payload.width, payload.height),
  width: payload.width,
  height: payload.height,
  arcSecondSpacing: payload.dataset === "copernicus30" ? 1 : 3,
  elevations: payload.elevations,
  sourceKind: "auto-fetch",
  sourceId: payload.dataset,
  sourceLabel: `Copernicus ${payload.dataset === "copernicus30" ? "GLO-30" : "GLO-90"}`,
  sourceDetail: payload.path,
});

const parseCopernicusTile = async (
  tileKey: string,
  dataset: CopernicusDataset,
  path: string,
  buffer: ArrayBuffer,
): Promise<SrtmTile> => {
  try {
    const payload = await parseCopernicusTileOnWorker(tileKey, dataset, path, buffer);
    return toSrtmTile(payload);
  } catch {
    return parseCopernicusTileInMain(tileKey, dataset, path, buffer);
  }
};

const getCachedOrFetchTile = async (
  pathPrefix: "30m" | "90m",
  path: string,
  tileKey: string,
): Promise<{ buffer: ArrayBuffer; fromCache: boolean; byteLength: number }> => {
  const dataset: CopernicusDataset = pathPrefix === "30m" ? "copernicus30" : "copernicus90";
  const cache = await caches.open(CACHE_NAME);
  const proxiedUrl = `/copernicus/${pathPrefix}/${path}`;
  const localIndex = readTileIndex(dataset);
  if (localIndex.has(tileKey)) {
    const cached = await cache.match(proxiedUrl);
    if (cached) {
      const buffer = await cached.arrayBuffer();
      return { buffer, fromCache: true, byteLength: buffer.byteLength };
    }
  }
  const response = await fetchWithRetry(proxiedUrl, TILE_RETRY_POLICY);
  const contentLength = Number(response.headers.get("content-length") ?? "");
  await cache.put(proxiedUrl, response.clone());
  const buffer = await response.arrayBuffer();
  return {
    buffer,
    fromCache: false,
    byteLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : buffer.byteLength,
  };
};

const loadTileBatch = async (
  keys: string[],
  dataset: CopernicusDataset,
  pathPrefix: "30m" | "90m",
  fallbackDataset?: "copernicus90",
  onTileProgress?: (progress: CopernicusTileProgress) => void,
): Promise<{
  tiles: SrtmTile[];
  failedTiles: string[];
  fetchedTiles: string[];
  cacheHits: string[];
  fallbackTiles: string[];
}> => {
  const tileList = await loadTileList(dataset);
  const fetchedTiles: string[] = [];
  const cacheHits: string[] = [];
  const failedTiles = new Set<string>();
  const fallbackTiles: string[] = [];
  const parsedTiles: SrtmTile[] = [];
  let completedTiles = 0;
  const totalTiles = keys.length;

  const reportProgress = (tileKey: string, bytes: number, progressDataset: CopernicusDataset) => {
    completedTiles += 1;
    onTileProgress?.({
      dataset: progressDataset,
      tileKey,
      bytes,
      completedTiles,
      totalTiles,
    });
  };

  for (const key of keys) {
    const item = tileList[key];
    if (!item) {
      failedTiles.add(key);
      reportProgress(key, 0, dataset);
      continue;
    }
    try {
      const { buffer, fromCache, byteLength } = await getCachedOrFetchTile(pathPrefix, item.path, key);
      if (fromCache) cacheHits.push(key);
      else fetchedTiles.push(key);
      parsedTiles.push(await parseCopernicusTile(key, dataset, item.path, buffer));
      reportProgress(key, byteLength, dataset);
    } catch {
      failedTiles.add(key);
      reportProgress(key, 0, dataset);
    }
  }

  if (fallbackDataset && failedTiles.size > 0) {
    const fallbackList = await loadTileList(fallbackDataset);
    for (const key of Array.from(failedTiles)) {
      const item = fallbackList[key];
      if (!item) continue;
      try {
        const { buffer, fromCache, byteLength } = await getCachedOrFetchTile(DATASET_PATH[fallbackDataset], item.path, key);
        if (fromCache) cacheHits.push(key);
        else fetchedTiles.push(key);
        parsedTiles.push(await parseCopernicusTile(key, fallbackDataset, item.path, buffer));
        fallbackTiles.push(key);
        failedTiles.delete(key);
        reportProgress(key, byteLength, fallbackDataset);
      } catch {
        // keep failed
        reportProgress(key, 0, fallbackDataset);
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

export type CopernicusPhasedLoadResult = {
  priority: CopernicusLoadResult;
  remaining: CopernicusLoadResult;
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

export const loadCopernicusTilesForAreaPhased = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  dataset: CopernicusDataset,
  priorityKeys?: Set<string>,
  options?: { skipRemaining?: boolean; onTileProgress?: (progress: CopernicusTileProgress) => void },
): Promise<CopernicusPhasedLoadResult> => {
  const candidateKeys = tilesForBounds(minLat, maxLat, minLon, maxLon);
  const pathPrefix = DATASET_PATH[dataset];
  const is30m = dataset === "copernicus30";

  let priority: CopernicusLoadResult;
  let remaining: CopernicusLoadResult;

  if (priorityKeys && priorityKeys.size > 0) {
    const priorityKeysList = candidateKeys.filter((k) => priorityKeys.has(k));
    const remainingKeys = candidateKeys.filter((k) => !priorityKeys.has(k));

    priority = await loadTileBatch(
      priorityKeysList,
      dataset,
      pathPrefix,
      is30m ? "copernicus90" : undefined,
      options?.onTileProgress,
    );
    if (options?.skipRemaining) {
      remaining = { tiles: [], failedTiles: [], fetchedTiles: [], cacheHits: [], fallbackTiles: [] };
    } else {
      remaining = await loadTileBatch(
        remainingKeys,
        dataset,
        pathPrefix,
        is30m ? "copernicus90" : undefined,
        options?.onTileProgress,
      );
    }
  } else {
    priority = await loadTileBatch(
      candidateKeys,
      dataset,
      pathPrefix,
      is30m ? "copernicus90" : undefined,
      options?.onTileProgress,
    );
    remaining = { tiles: [], failedTiles: [], fetchedTiles: [], cacheHits: [], fallbackTiles: [] };
  }

  return { priority, remaining };
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
