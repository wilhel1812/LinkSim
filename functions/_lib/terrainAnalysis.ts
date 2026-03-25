import { fromArrayBuffer } from "geotiff";
import { analyzeLink } from "../../src/lib/propagation";
import { defaultPropagationEnvironment } from "../../src/lib/propagationEnvironment";
import { sampleSrtmElevation } from "../../src/lib/srtm";
import type { SrtmTile } from "../../src/types/radio";
import type { Env } from "./types";

type TileListEntry = {
  key: string;
  pathPrefix: "30m" | "90m";
  path: string;
  dataset: "copernicus30" | "copernicus90";
};

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
};

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

const parseCopernicusKey = (entry: string): string | null => {
  const match = entry.match(/Copernicus_DSM_COG_\d+_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM/i);
  if (!match) return null;
  const [, ns, lat, ew, lon] = match;
  return `${ns.toUpperCase()}${lat}${ew.toUpperCase()}${lon}`;
};

const parseTileList = (raw: string, pathPrefix: "30m" | "90m"): Map<string, TileListEntry[]> => {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const map = new Map<string, TileListEntry[]>();
  for (const path of lines) {
    const key = parseCopernicusKey(path);
    if (!key) continue;
    const dataset: TileListEntry["dataset"] = /_COG_30_/i.test(path) ? "copernicus30" : "copernicus90";
    const entry: TileListEntry = { key, pathPrefix, path, dataset };
    const existing = map.get(key) ?? [];
    existing.push(entry);
    map.set(key, existing);
  }
  return map;
};

const fetchTileList = async (origin: string, pathPrefix: "30m" | "90m"): Promise<Map<string, TileListEntry[]>> => {
  const response = await fetch(`${origin}/copernicus/${pathPrefix}/tileList.txt`);
  if (!response.ok) return new Map();
  const text = await response.text();
  return parseTileList(text, pathPrefix);
};

const mergeTileIndexes = (left: Map<string, TileListEntry[]>, right: Map<string, TileListEntry[]>): Map<string, TileListEntry[]> => {
  const out = new Map(left);
  for (const [key, entries] of right.entries()) {
    const existing = out.get(key) ?? [];
    out.set(key, [...existing, ...entries]);
  }
  return out;
};

const chooseTileEntry = (entries: TileListEntry[]): TileListEntry | null => {
  if (!entries.length) return null;
  const preferred30 = entries.find((entry) => entry.dataset === "copernicus30");
  return preferred30 ?? entries[0] ?? null;
};

const parseCopernicusTile = async (entry: TileListEntry, buffer: ArrayBuffer): Promise<SrtmTile> => {
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
    key: entry.key,
    latStart: Math.floor(minLat),
    lonStart: Math.floor(minLon),
    size: Math.max(width, height),
    width,
    height,
    arcSecondSpacing: entry.dataset === "copernicus30" ? 1 : 3,
    elevations: out,
    sourceKind: "auto-fetch",
    sourceId: entry.dataset,
    sourceLabel: `Copernicus ${entry.dataset === "copernicus30" ? "GLO-30" : "GLO-90"}`,
    sourceDetail: entry.path,
  };
};

const fetchTile = async (origin: string, entry: TileListEntry): Promise<SrtmTile | null> => {
  const response = await fetch(`${origin}/copernicus/${entry.pathPrefix}/${entry.path}`);
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  return parseCopernicusTile(entry, buffer);
};

export const loadCopernicusTilesForPath = async (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  requestUrl: string,
): Promise<{ tiles: SrtmTile[]; tileKeys: string[] }> => {
  const origin = new URL(requestUrl).origin;
  const minLat = Math.min(from.lat, to.lat) - 0.1;
  const maxLat = Math.max(from.lat, to.lat) + 0.1;
  const minLon = Math.min(from.lon, to.lon) - 0.1;
  const maxLon = Math.max(from.lon, to.lon) + 0.1;
  const neededKeys = tilesForBounds(minLat, maxLat, minLon, maxLon);

  const [index30, index90] = await Promise.all([fetchTileList(origin, "30m"), fetchTileList(origin, "90m")]);
  const tileIndex = mergeTileIndexes(index30, index90);

  const tiles: SrtmTile[] = [];
  const fetchedKeys: string[] = [];
  for (const key of neededKeys) {
    const entries = tileIndex.get(key) ?? [];
    const selected = chooseTileEntry(entries);
    if (!selected) continue;
    const tile = await fetchTile(origin, selected);
    if (!tile) continue;
    tiles.push(tile);
    fetchedKeys.push(`${key}:${selected.dataset}`);
  }

  return { tiles, tileKeys: fetchedKeys };
};

export const analyzeTerrainLink = async (
  env: Env,
  requestUrl: string,
  fromSite: { lat: number; lon: number; name: string; txPowerDbm: number; txGainDbi: number; rxGainDbi: number; cableLossDb: number; antennaHeightM: number },
  toSite: { lat: number; lon: number; name: string; txPowerDbm: number; txGainDbi: number; rxGainDbi: number; cableLossDb: number; antennaHeightM: number },
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

  const terrainSampler = ({ lat, lon }: { lat: number; lon: number }) => sampleSrtmElevation(tiles, lat, lon);
  const fromGroundM = terrainSampler({ lat: fromSite.lat, lon: fromSite.lon }) ?? 0;
  const toGroundM = terrainSampler({ lat: toSite.lat, lon: toSite.lon }) ?? 0;

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
  };
};
