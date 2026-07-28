import { fromArrayBuffer } from "geotiff";
import type { SrtmTile } from "../types/radio";

export type CopernicusTileProgress = {
  dataset: "copernicus30";
  tileKey: string;
  bytes: number;
  completedTiles: number;
  totalTiles: number;
};

export type CopernicusLoadResult = {
  tiles: SrtmTile[];
  failedTiles: string[];
  fetchedTiles: string[];
  cacheHits: string[];
};

export type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

type ParsedCopernicusTilePayload = {
  key: string;
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
  dataset: "copernicus30";
  path: string;
  buffer: ArrayBuffer;
};

type TileParserResponseMessage =
  | { id: number; ok: true; payload: ParsedCopernicusTilePayload }
  | { id: number; ok: false; error: string };

const CACHE_NAME = "linksim-copernicus-cog-v1";
const RESPONSE_START_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const TILE_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  baseDelayMs: 500,
  maxDelayMs: 3_000,
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

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new DOMException("Terrain loading stopped", "AbortError");

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal);
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

const raceWithAbort = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
};

const getParserWorker = (): Worker | null => {
  if (typeof Worker === "undefined") return null;
  if (parserWorkerInstance) return parserWorkerInstance;
  const worker = new Worker(new URL("../workers/copernicusTileParser.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<TileParserResponseMessage>) => {
    const data = event.data;
    const pending = parserPending.get(data.id);
    if (!pending) return;
    parserPending.delete(data.id);
    if (data.ok) pending.resolve(data.payload);
    else pending.reject(new Error(data.error));
  };
  worker.onerror = () => {
    for (const pending of parserPending.values()) {
      pending.reject(new Error("Copernicus tile parser worker failed"));
    }
    parserPending.clear();
  };
  parserWorkerInstance = worker;
  return worker;
};

const parseCopernicusTileOnWorker = (
  key: string,
  path: string,
  buffer: ArrayBuffer,
): Promise<ParsedCopernicusTilePayload> => {
  const worker = getParserWorker();
  if (!worker) return Promise.reject(new Error("Worker unavailable"));
  const id = ++parserRequestId;
  return new Promise((resolve, reject) => {
    parserPending.set(id, { resolve, reject });
    const message: TileParserRequestMessage = { id, key, dataset: "copernicus30", path, buffer };
    worker.postMessage(message, [buffer]);
  });
};

export const copernicus30PathForTileKey = (tileKey: string): string => {
  const match = /^([NS])(\d{2})([EW])(\d{3})$/.exec(tileKey);
  if (!match) throw new Error(`Invalid terrain tile key: ${tileKey}`);
  const [, ns, lat, ew, lon] = match;
  const objectName = `Copernicus_DSM_COG_10_${ns}${lat}_00_${ew}${lon}_00_DEM`;
  return `/copernicus/30m/${objectName}/${objectName}.tif`;
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
  return Math.min(policy.maxDelayMs, Math.max(policy.baseDelayMs, retryAfterMs ?? exponentialMs));
};

const waitForRetry = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  raceWithAbort(new Promise((resolve) => setTimeout(resolve, delayMs)), signal);

type TileResponse = {
  response: Response;
  buffer: ArrayBuffer | null;
};

class PermanentTileError extends Error {}

const requestTile = async (url: string, signal?: AbortSignal): Promise<TileResponse> => {
  throwIfAborted(signal);
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Terrain request timed out", "TimeoutError")),
    RESPONSE_START_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { response, buffer: null };
    const buffer = await response.arrayBuffer();
    throwIfAborted(signal);
    return { response, buffer };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
};

const fetchTileBuffer = async (
  url: string,
  signal?: AbortSignal,
): Promise<{ buffer: ArrayBuffer; response: Response }> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TILE_RETRY_POLICY.maxRetries; attempt += 1) {
    throwIfAborted(signal);
    let response: Response | null = null;
    try {
      const requested = await requestTile(url, signal);
      response = requested.response;
      if (response.ok && requested.buffer) return { buffer: requested.buffer, response };
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw new PermanentTileError(`HTTP ${response.status}`);
      }
      if (attempt >= TILE_RETRY_POLICY.maxRetries) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      if (error instanceof PermanentTileError) throw error;
      lastError = error;
      if (attempt >= TILE_RETRY_POLICY.maxRetries) throw error;
    }
    await waitForRetry(resolveRetryDelayMs(TILE_RETRY_POLICY, attempt + 1, response), signal);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const parseCopernicusTileInMain = async (
  tileKey: string,
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
  for (let index = 0; index < out.length; index += 1) {
    const value = Number((raster as ArrayLike<number>)[index]);
    out[index] =
      !Number.isFinite(value) || (Number.isFinite(nodataNumeric) && Math.abs(value - nodataNumeric) <= 0.01)
        ? -32768
        : Math.max(-32767, Math.min(32767, Math.round(value)));
  }
  return {
    key: tileKey,
    latStart: Math.round(minLat),
    lonStart: Math.round(minLon),
    size: Math.max(width, height),
    width,
    height,
    arcSecondSpacing: 1,
    elevations: out,
    sourceKind: "auto-fetch",
    sourceId: "copernicus30",
    sourceLabel: "Copernicus GLO-30",
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
  arcSecondSpacing: 1,
  elevations: payload.elevations,
  sourceKind: "auto-fetch",
  sourceId: "copernicus30",
  sourceLabel: "Copernicus GLO-30",
  sourceDetail: payload.path,
});

const parseCopernicusTile = async (
  tileKey: string,
  path: string,
  buffer: ArrayBuffer,
  signal?: AbortSignal,
): Promise<SrtmTile> => {
  throwIfAborted(signal);
  try {
    const payload = await raceWithAbort(parseCopernicusTileOnWorker(tileKey, path, buffer), signal);
    return toSrtmTile(payload);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    return raceWithAbort(parseCopernicusTileInMain(tileKey, path, buffer), signal);
  }
};

const loadTile = async (
  tileKey: string,
  signal?: AbortSignal,
): Promise<{ tile: SrtmTile; fromCache: boolean; bytes: number }> => {
  const path = copernicus30PathForTileKey(tileKey);
  const cache = await caches.open(CACHE_NAME);
  throwIfAborted(signal);
  const cached = await cache.match(path);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    return {
      tile: await parseCopernicusTile(tileKey, path, buffer, signal),
      fromCache: true,
      bytes: buffer.byteLength,
    };
  }

  const { buffer, response } = await fetchTileBuffer(path, signal);
  throwIfAborted(signal);
  await cache.put(path, new Response(buffer.slice(0), { status: 200, headers: response.headers }));
  return {
    tile: await parseCopernicusTile(tileKey, path, buffer, signal),
    fromCache: false,
    bytes: buffer.byteLength,
  };
};

export const loadCopernicus30TilesByKeys = async (
  tileKeys: readonly string[],
  options: {
    signal?: AbortSignal;
    concurrency?: number;
    onTileProgress?: (progress: CopernicusTileProgress) => void;
  } = {},
): Promise<CopernicusLoadResult> => {
  const keys = Array.from(new Set(tileKeys));
  const concurrency = Math.max(1, Math.min(2, Math.floor(options.concurrency ?? 2)));
  const tiles: SrtmTile[] = [];
  const failedTiles: string[] = [];
  const fetchedTiles: string[] = [];
  const cacheHits: string[] = [];
  let nextIndex = 0;
  let completedTiles = 0;

  const worker = async () => {
    while (nextIndex < keys.length) {
      throwIfAborted(options.signal);
      const tileKey = keys[nextIndex];
      nextIndex += 1;
      let bytes = 0;
      try {
        const loaded = await loadTile(tileKey, options.signal);
        throwIfAborted(options.signal);
        tiles.push(loaded.tile);
        bytes = loaded.bytes;
        if (loaded.fromCache) cacheHits.push(tileKey);
        else fetchedTiles.push(tileKey);
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) throw error;
        failedTiles.push(tileKey);
      }
      completedTiles += 1;
      if (!options.signal?.aborted) {
        options.onTileProgress?.({
          dataset: "copernicus30",
          tileKey,
          bytes,
          completedTiles,
          totalTiles: keys.length,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()));
  throwIfAborted(options.signal);
  return { tiles, failedTiles, fetchedTiles, cacheHits };
};

export const clearCopernicusCache = async (): Promise<void> => {
  await caches.delete(CACHE_NAME);
  localStorage.removeItem("linksim-copernicus-tilelist-v1");
  localStorage.removeItem("linksim-copernicus-tile-index-v1");
};
