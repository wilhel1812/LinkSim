import { parseSrtmZip } from "./srtm";
import type { SrtmTile } from "../types/radio";

type TerrainDataset = "srtm1" | "srtm3" | "srtmthird";
type TerrainRecommendation = {
  dataset: TerrainDataset;
  completeness: number;
  expectedTiles: number;
  availableTiles: number;
  byDataset: Record<TerrainDataset, { availableTiles: number; completeness: number }>;
};
type Ve2dbeLoadResult = {
  tiles: SrtmTile[];
  failedArchives: string[];
  fetchedArchives: string[];
  cacheHits: string[];
};

const DATASET_TO_MODE: Record<TerrainDataset, string> = {
  srtm3: "0",
  srtm1: "1",
  srtmthird: "2",
};

const CACHE_NAME = "linksim-ve2dbe-srtm-v1";
const META_KEY = "linksim-ve2dbe-cache-meta-v1";
const TILELIST_CACHE_KEY = "linksim-ve2dbe-tilelist-cache-v1";
const FETCH_TIMEOUT_MS = 12000;
const MAX_RETRIES = 3;
const TILELIST_TTL_MS = 5 * 60 * 1000;

const tileKey = (lat: number, lon: number): string => {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`;
};

export const tilesForBounds = (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
): string[] => {
  const keys = new Set<string>();
  const latStart = Math.floor(minLat);
  const latEnd = Math.floor(maxLat);
  const lonStart = Math.floor(minLon);
  const lonEnd = Math.floor(maxLon);

  for (let lat = latStart; lat <= latEnd; lat += 1) {
    for (let lon = lonStart; lon <= lonEnd; lon += 1) {
      keys.add(tileKey(lat, lon));
    }
  }
  return Array.from(keys).sort();
};

export const fetchAvailableVe2dbeTilePaths = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  dataset: TerrainDataset,
): Promise<string[]> => {
  const requestKey = `${dataset}:${Math.floor(minLat)}:${Math.ceil(maxLat)}:${Math.floor(minLon)}:${Math.ceil(maxLon)}`;
  try {
    const raw = localStorage.getItem(TILELIST_CACHE_KEY);
    if (raw) {
      const cache = JSON.parse(raw) as Record<string, { fetchedAtMs: number; links: string[] }>;
      const cached = cache[requestKey];
      if (cached && Date.now() - cached.fetchedAtMs <= TILELIST_TTL_MS) {
        return cached.links;
      }
    }
  } catch {
    // Ignore corrupt local cache and continue with network fetch.
  }

  const body = new URLSearchParams({
    lat1: String(Math.floor(minLat)),
    lat2: String(Math.ceil(maxLat)),
    lon1: String(Math.floor(minLon)),
    lon2: String(Math.ceil(maxLon)),
    mode: DATASET_TO_MODE[dataset],
  });

  const response = await fetch("/ve2dbe/geodata/gettile.asp", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`ve2dbe tile list failed (${response.status})`);
  }

  const html = await response.text();
  const links = new Set<string>();
  const rx = /href="([^"]+\.(?:hgt|lcv)\.zip)"/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(html))) {
    links.add(match[1]);
  }
  const sortedLinks = Array.from(links).sort();
  try {
    const raw = localStorage.getItem(TILELIST_CACHE_KEY);
    const existing = raw ? (JSON.parse(raw) as Record<string, { fetchedAtMs: number; links: string[] }>) : {};
    existing[requestKey] = { fetchedAtMs: Date.now(), links: sortedLinks };
    localStorage.setItem(TILELIST_CACHE_KEY, JSON.stringify(existing));
  } catch {
    // Best-effort local cache only.
  }
  return sortedLinks;
};

type CacheMetaRecord = {
  dataset: TerrainDataset;
  archivePath: string;
  fetchedAt: string;
  sourceUrl: string;
};

const getCacheMeta = (): Record<string, CacheMetaRecord> => {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CacheMetaRecord>;
  } catch {
    return {};
  }
};

const setCacheMeta = (meta: Record<string, CacheMetaRecord>) => {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
};

const fetchWithRetry = async (url: string, retries = MAX_RETRIES): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) {
        const backoffMs = 450 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const getCachedOrFetchArchive = async (
  archivePath: string,
  dataset: TerrainDataset,
): Promise<{ buffer: ArrayBuffer; fromCache: boolean }> => {
  const cache = await caches.open(CACHE_NAME);
  const proxiedUrl = `/ve2dbe/geodata/${archivePath}`;
  const cached = await cache.match(proxiedUrl);
  if (cached) {
    return { buffer: await cached.arrayBuffer(), fromCache: true };
  }

  const response = await fetchWithRetry(proxiedUrl);
  await cache.put(proxiedUrl, response.clone());
  const meta = getCacheMeta();
  meta[archivePath] = {
    dataset,
    archivePath,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://www.ve2dbe.com/geodata/${archivePath}`,
  };
  setCacheMeta(meta);
  return { buffer: await response.arrayBuffer(), fromCache: false };
};

export const loadVe2dbeTilesForArea = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  dataset: TerrainDataset,
): Promise<Ve2dbeLoadResult> => {
  const archives = await fetchAvailableVe2dbeTilePaths(minLat, maxLat, minLon, maxLon, dataset);
  const fetchedArchives: string[] = [];
  const cacheHits: string[] = [];
  const failedArchives: string[] = [];
  const results = await Promise.all(
    archives.map(async (archivePath) => {
      try {
        const { buffer, fromCache } = await getCachedOrFetchArchive(archivePath, dataset);
        if (fromCache) {
          cacheHits.push(archivePath);
        } else {
          fetchedArchives.push(archivePath);
        }
        return {
          ok: true as const,
          tile: {
            ...parseSrtmZip(archivePath, buffer),
            sourceKind: "auto-fetch" as const,
            sourceId: `ve2dbe-${dataset}`,
            sourceLabel: `ve2dbe ${dataset}`,
            sourceDetail: archivePath,
          },
        };
      } catch {
        failedArchives.push(archivePath);
        return { ok: false as const };
      }
    }),
  );
  return {
    tiles: results.filter((result) => result.ok).map((result) => result.tile),
    failedArchives,
    fetchedArchives,
    cacheHits,
  };
};

export const clearVe2dbeCache = async (): Promise<void> => {
  await caches.delete(CACHE_NAME);
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(TILELIST_CACHE_KEY);
};

export const recommendVe2dbeDatasetForArea = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
): Promise<TerrainRecommendation> => {
  const expected = Math.max(1, tilesForBounds(minLat, maxLat, minLon, maxLon).length);
  const datasets: TerrainDataset[] = ["srtmthird", "srtm1", "srtm3"];
  const results = await Promise.all(
    datasets.map(async (dataset) => {
      const available = (await fetchAvailableVe2dbeTilePaths(minLat, maxLat, minLon, maxLon, dataset)).length;
      return {
        dataset,
        available,
        completeness: available / expected,
      };
    }),
  );

  const ranked = [...results].sort((a, b) => {
    if (b.completeness !== a.completeness) return b.completeness - a.completeness;
    const order = { srtmthird: 3, srtm1: 2, srtm3: 1 } as const;
    return order[b.dataset] - order[a.dataset];
  });
  const best = ranked[0];

  return {
    dataset: best.dataset,
    completeness: best.completeness,
    expectedTiles: expected,
    availableTiles: best.available,
    byDataset: {
      srtm1: {
        availableTiles: results.find((result) => result.dataset === "srtm1")?.available ?? 0,
        completeness: results.find((result) => result.dataset === "srtm1")?.completeness ?? 0,
      },
      srtm3: {
        availableTiles: results.find((result) => result.dataset === "srtm3")?.available ?? 0,
        completeness: results.find((result) => result.dataset === "srtm3")?.completeness ?? 0,
      },
      srtmthird: {
        availableTiles: results.find((result) => result.dataset === "srtmthird")?.available ?? 0,
        completeness: results.find((result) => result.dataset === "srtmthird")?.completeness ?? 0,
      },
    },
  };
};

export type { TerrainDataset, TerrainRecommendation, Ve2dbeLoadResult };
