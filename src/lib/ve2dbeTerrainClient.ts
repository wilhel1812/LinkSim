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

const DATASET_TO_MODE: Record<TerrainDataset, string> = {
  srtm3: "0",
  srtm1: "1",
  srtmthird: "2",
};

const CACHE_NAME = "radio-mobile-web-ve2dbe-srtm-v1";

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
  return Array.from(links).sort();
};

const getCachedOrFetchArchive = async (archivePath: string): Promise<ArrayBuffer> => {
  const cache = await caches.open(CACHE_NAME);
  const proxiedUrl = `/ve2dbe/geodata/${archivePath}`;
  const cached = await cache.match(proxiedUrl);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(proxiedUrl);
  if (!response.ok) {
    throw new Error(`ve2dbe archive fetch failed (${response.status}) for ${archivePath}`);
  }
  await cache.put(proxiedUrl, response.clone());
  return response.arrayBuffer();
};

export const loadVe2dbeTilesForArea = async (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  dataset: TerrainDataset,
): Promise<SrtmTile[]> => {
  const archives = await fetchAvailableVe2dbeTilePaths(minLat, maxLat, minLon, maxLon, dataset);
  const tiles = await Promise.all(
    archives.map(async (archivePath) => {
      const archive = await getCachedOrFetchArchive(archivePath);
      return {
        ...parseSrtmZip(archivePath, archive),
        sourceKind: "auto-fetch" as const,
        sourceId: `ve2dbe-${dataset}`,
        sourceLabel: `ve2dbe ${dataset}`,
        sourceDetail: archivePath,
      };
    }),
  );
  return tiles;
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

export type { TerrainDataset, TerrainRecommendation };
