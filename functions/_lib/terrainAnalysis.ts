import { fromArrayBuffer } from "geotiff";
import { analyzeLink } from "../../src/lib/propagation";
import { defaultPropagationEnvironment } from "../../src/lib/propagationEnvironment";
import { copernicus30PathForTileKey } from "../../src/lib/copernicusTilePath";
import type { Env } from "./types";

export type TerrainAnalysisResult = {
  distanceKm: number;
  baselineFsplDb: number;
  terrainPenaltyDb: number;
  totalPathLossDb: number;
  terrainObstructed: boolean;
  maxIntrusionM: number;
  fresnelClearancePercent: number;
  samplesUsed: number;
  tilesFetched: string[];
  fromGroundM: number;
  toGroundM: number;
};

type TerrainBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

type CompactTerrainTile = {
  key: string;
  dataset: "copernicus30";
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  width: number;
  height: number;
  elevations: Int16Array;
};

const TILE_MARGIN_DEG = 0.02;
const MAX_TILE_CELLS = 90_000;

const tileKey = (lat: number, lon: number): string => {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`;
};

const tilesForBounds = (minLat: number, maxLat: number, minLon: number, maxLon: number): string[] => {
  const keys = new Set<string>();
  for (let lat = Math.floor(minLat); lat <= Math.floor(maxLat); lat += 1) {
    for (let lon = Math.floor(minLon); lon <= Math.floor(maxLon); lon += 1) {
      keys.add(tileKey(lat, lon));
    }
  }
  return Array.from(keys).sort();
};

const toTerrainBounds = (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): TerrainBounds => ({
  minLat: Math.max(-90, Math.min(from.lat, to.lat) - TILE_MARGIN_DEG),
  maxLat: Math.min(90, Math.max(from.lat, to.lat) + TILE_MARGIN_DEG),
  minLon: Math.max(-180, Math.min(from.lon, to.lon) - TILE_MARGIN_DEG),
  maxLon: Math.min(180, Math.max(from.lon, to.lon) + TILE_MARGIN_DEG),
});

const parseCopernicusTile = async (
  key: string,
  buffer: ArrayBuffer,
  bounds: TerrainBounds,
): Promise<CompactTerrainTile | null> => {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [minLon, minLat, maxLon, maxLat] = image.getBoundingBox();
  const overlapMinLon = Math.max(minLon, bounds.minLon);
  const overlapMaxLon = Math.min(maxLon, bounds.maxLon);
  const overlapMinLat = Math.max(minLat, bounds.minLat);
  const overlapMaxLat = Math.min(maxLat, bounds.maxLat);
  if (overlapMinLon >= overlapMaxLon || overlapMinLat >= overlapMaxLat) {
    return null;
  }

  const x0 = Math.max(0, Math.min(width - 1, Math.floor(((overlapMinLon - minLon) / (maxLon - minLon)) * width)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(((overlapMaxLon - minLon) / (maxLon - minLon)) * width)));
  const y0 = Math.max(
    0,
    Math.min(
      height - 1,
      Math.floor(((maxLat - overlapMaxLat) / (maxLat - minLat)) * height),
    ),
  );
  const y1 = Math.max(
    y0 + 1,
    Math.min(
      height,
      Math.ceil(((maxLat - overlapMinLat) / (maxLat - minLat)) * height),
    ),
  );

  const sourceW = Math.max(1, x1 - x0);
  const sourceH = Math.max(1, y1 - y0);
  const preferredDim = 300;
  let targetW = Math.min(sourceW, preferredDim);
  let targetH = Math.min(sourceH, preferredDim);
  const cellCount = targetW * targetH;
  if (cellCount > MAX_TILE_CELLS) {
    const scale = Math.sqrt(MAX_TILE_CELLS / cellCount);
    targetW = Math.max(1, Math.floor(targetW * scale));
    targetH = Math.max(1, Math.floor(targetH * scale));
  }

  const nodata = image.getGDALNoData();
  const raster = await image.readRasters({
    interleave: true,
    samples: [0],
    window: [x0, y0, x1, y1],
    width: targetW,
    height: targetH,
  });
  const nodataNumeric = nodata === null ? NaN : Number(nodata);
  const result = new Int16Array(targetW * targetH);

  for (let i = 0; i < result.length; i += 1) {
    const value = Number((raster as ArrayLike<number>)[i]);
    if (!Number.isFinite(value) || (Number.isFinite(nodataNumeric) && Math.abs(value - nodataNumeric) <= 0.01)) {
      result[i] = -32768;
      continue;
    }
    result[i] = Math.max(-32767, Math.min(32767, Math.round(value)));
  }

  return {
    key,
    dataset: "copernicus30",
    minLat: overlapMinLat,
    maxLat: overlapMaxLat,
    minLon: overlapMinLon,
    maxLon: overlapMaxLon,
    width: targetW,
    height: targetH,
    elevations: result,
  };
};

const fetchTile = async (origin: string, key: string, bounds: TerrainBounds): Promise<CompactTerrainTile | null> => {
  const response = await fetch(`${origin}${copernicus30PathForTileKey(key)}`);
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  return parseCopernicusTile(key, buffer, bounds);
};

const sampleTerrainElevation = (
  tiles: ReadonlyArray<CompactTerrainTile>,
  lat: number,
  lon: number,
): number | null => {
  const tile = tiles.find(
    (candidate) =>
      lat >= candidate.minLat &&
      lat <= candidate.maxLat &&
      lon >= candidate.minLon &&
      lon <= candidate.maxLon,
  );
  if (!tile) return null;

  const latSpan = Math.max(1e-9, tile.maxLat - tile.minLat);
  const lonSpan = Math.max(1e-9, tile.maxLon - tile.minLon);
  const row = Math.max(0, Math.min(tile.height - 1, Math.round(((tile.maxLat - lat) / latSpan) * (tile.height - 1))));
  const col = Math.max(0, Math.min(tile.width - 1, Math.round(((lon - tile.minLon) / lonSpan) * (tile.width - 1))));
  const value = tile.elevations[row * tile.width + col] ?? -32768;
  if (value <= -32760) return null;
  return value;
};

export const loadCopernicusTilesForPath = async (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  requestUrl: string,
): Promise<{ tiles: CompactTerrainTile[]; tileKeys: string[] }> => {
  const origin = new URL(requestUrl).origin;
  const bounds = toTerrainBounds(from, to);
  const { minLat, maxLat, minLon, maxLon } = bounds;
  const neededKeys = tilesForBounds(minLat, maxLat, minLon, maxLon);

  const tiles: CompactTerrainTile[] = [];
  const fetchedKeys: string[] = [];
  for (const key of neededKeys) {
    const tile = await fetchTile(origin, key, bounds);
    if (!tile) continue;
    tiles.push(tile);
    fetchedKeys.push(`${key}:copernicus30`);
  }

  return { tiles, tileKeys: fetchedKeys };
};

export const analyzeTerrainLink = async (
  env: Env,
  requestUrl: string,
  fromSite: { lat: number; lon: number; name: string; txPowerDbm: number; txGainDbi: number; rxGainDbi: number; cableLossDb: number; antennaHeightM: number; groundElevationM?: number },
  toSite: { lat: number; lon: number; name: string; txPowerDbm: number; txGainDbi: number; rxGainDbi: number; cableLossDb: number; antennaHeightM: number; groundElevationM?: number },
  frequencyMhz: number,
  samples: number,
): Promise<TerrainAnalysisResult> => {
  void env;
  const { tiles, tileKeys } = await loadCopernicusTilesForPath(
    { lat: fromSite.lat, lon: fromSite.lon },
    { lat: toSite.lat, lon: toSite.lon },
    requestUrl,
  );
  if (!tiles.length) {
    throw new Error("No terrain tiles available for this region");
  }

  const terrainSampler = ({ lat, lon }: { lat: number; lon: number }) => sampleTerrainElevation(tiles, lat, lon);
  const fromGroundM = terrainSampler({ lat: fromSite.lat, lon: fromSite.lon }) ?? fromSite.groundElevationM ?? 0;
  const toGroundM = terrainSampler({ lat: toSite.lat, lon: toSite.lon }) ?? toSite.groundElevationM ?? 0;

  const from = {
    id: "from",
    name: fromSite.name,
    position: { lat: fromSite.lat, lon: fromSite.lon },
    groundElevationM: fromGroundM,
    antennaHeightM: fromSite.antennaHeightM,
    txPowerDbm: fromSite.txPowerDbm,
    txGainDbi: fromSite.txGainDbi,
    rxGainDbi: fromSite.rxGainDbi,
    cableLossDb: fromSite.cableLossDb,
  };
  const to = {
    id: "to",
    name: toSite.name,
    position: { lat: toSite.lat, lon: toSite.lon },
    groundElevationM: toGroundM,
    antennaHeightM: toSite.antennaHeightM,
    txPowerDbm: toSite.txPowerDbm,
    txGainDbi: toSite.txGainDbi,
    rxGainDbi: toSite.rxGainDbi,
    cableLossDb: toSite.cableLossDb,
  };
  const link = {
    id: "api-link",
    fromSiteId: from.id,
    toSiteId: to.id,
    frequencyMHz: frequencyMhz,
    txPowerDbm: from.txPowerDbm,
    txGainDbi: from.txGainDbi,
    rxGainDbi: to.rxGainDbi,
    cableLossDb: from.cableLossDb,
  };

  const analysis = analyzeLink(link, from, to, "ITM", terrainSampler, {
    terrainSamples: Math.max(24, Math.round(samples)),
    environment: defaultPropagationEnvironment(),
  });

  const maxIntrusionM = Math.max(0, -analysis.worstFresnelClearanceM);
  return {
    distanceKm: analysis.distanceKm,
    baselineFsplDb: analysis.fsplDb,
    terrainPenaltyDb: Math.max(0, analysis.pathLossDb - analysis.fsplDb),
    totalPathLossDb: analysis.pathLossDb,
    terrainObstructed: analysis.terrainObstructed,
    maxIntrusionM,
    fresnelClearancePercent: analysis.worstFresnelClearancePercent,
    samplesUsed: Math.max(24, Math.round(samples)),
    tilesFetched: tileKeys,
    fromGroundM,
    toGroundM,
  };
};
