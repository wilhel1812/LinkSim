import type { SrtmTile } from "../types/radio";
import { unzipSync } from "fflate";
import { choosePreferredTerrainTile } from "./terrainTileRank";

const HGT_FILENAME = /^([NS])(\d{2})([EW])(\d{3})\.hgt$/i;

const normalizeName = (name: string): string => name.trim().split("/").pop()?.toLowerCase() ?? "";

const parseHeaderFromFilename = (
  fileName: string,
): { latStart: number; lonStart: number; key: string } | null => {
  const normalized = normalizeName(fileName);
  const match = normalized.match(HGT_FILENAME);

  if (!match) return null;

  const [, ns, latRaw, ew, lonRaw] = match;
  const lat = Number(latRaw) * (ns.toUpperCase() === "N" ? 1 : -1);
  const lon = Number(lonRaw) * (ew.toUpperCase() === "E" ? 1 : -1);

  return {
    latStart: lat,
    lonStart: lon,
    key: `${ns.toUpperCase()}${latRaw}${ew.toUpperCase()}${lonRaw}`,
  };
};

const detectTileSize = (byteLength: number): { size: number; arcSecondSpacing: 1 | 3 } | null => {
  const sampleCount = byteLength / 2;
  if (sampleCount === 1201 * 1201) return { size: 1201, arcSecondSpacing: 3 };
  if (sampleCount === 3601 * 3601) return { size: 3601, arcSecondSpacing: 1 };
  return null;
};

const readInt16BigEndian = (buffer: ArrayBuffer): Int16Array => {
  const view = new DataView(buffer);
  const out = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getInt16(i * 2, false);
  }
  return out;
};

export const parseSrtmTile = async (file: File): Promise<SrtmTile> => {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    return parseSrtmZip(file.name, buffer);
  }

  return parseSrtmBuffer(file.name, buffer);
};

export const parseSrtmBuffer = (fileName: string, buffer: ArrayBuffer): SrtmTile => {
  const header = parseHeaderFromFilename(fileName);
  if (!header) {
    throw new Error(`Unsupported SRTM file name: ${fileName}. Expected e.g. N45W073.hgt`);
  }

  const detected = detectTileSize(buffer.byteLength);
  if (!detected) {
    throw new Error(
      `Unsupported SRTM tile dimensions for ${fileName}. Expected 1201x1201 or 3601x3601 samples.`,
    );
  }

  const elevations = readInt16BigEndian(buffer);
  return {
    key: header.key,
    latStart: header.latStart,
    lonStart: header.lonStart,
    size: detected.size,
    width: detected.size,
    height: detected.size,
    arcSecondSpacing: detected.arcSecondSpacing,
    elevations,
  };
};

export const parseSrtmZip = (archiveName: string, zipBuffer: ArrayBuffer): SrtmTile => {
  const files = unzipSync(new Uint8Array(zipBuffer));
  const entry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith(".hgt"));

  if (!entry) {
    throw new Error(`No .hgt file found in SRTM archive: ${archiveName}`);
  }

  const [internalName, raw] = entry;
  const normalized = Uint8Array.from(raw);
  const hgtBuffer = normalized.buffer;

  return parseSrtmBuffer(internalName, hgtBuffer);
};

const inTile = (tile: SrtmTile, lat: number, lon: number): boolean =>
  lat >= tile.latStart &&
  lat <= tile.latStart + 1 &&
  lon >= tile.lonStart &&
  lon <= tile.lonStart + 1;

const sampleFromTile = (tile: SrtmTile, lat: number, lon: number): number => {
  const width = tile.width ?? tile.size;
  const height = tile.height ?? tile.size;
  const latNorm = (lat - tile.latStart) / 1;
  const lonNorm = (lon - tile.lonStart) / 1;

  const row = Math.max(0, Math.min(height - 1, Math.round((1 - latNorm) * (height - 1))));
  const col = Math.max(0, Math.min(width - 1, Math.round(lonNorm * (width - 1))));

  return tile.elevations[row * width + col];
};

const TILE_LOOKUP_CACHE = new WeakMap<ReadonlyArray<SrtmTile>, Map<string, SrtmTile>>();

const tileKeyForStart = (latStart: number, lonStart: number): string => {
  const ns = latStart >= 0 ? "N" : "S";
  const ew = lonStart >= 0 ? "E" : "W";
  return `${ns}${String(Math.floor(Math.abs(latStart))).padStart(2, "0")}${ew}${String(
    Math.floor(Math.abs(lonStart)),
  ).padStart(3, "0")}`;
};

const tileLookupFor = (tiles: ReadonlyArray<SrtmTile>): Map<string, SrtmTile> => {
  const cached = TILE_LOOKUP_CACHE.get(tiles);
  if (cached) return cached;

  const lookup = new Map<string, SrtmTile>();
  for (const tile of tiles) {
    const existing = lookup.get(tile.key);
    if (!existing) {
      lookup.set(tile.key, tile);
      continue;
    }
    lookup.set(tile.key, choosePreferredTerrainTile(existing, tile));
  }

  TILE_LOOKUP_CACHE.set(tiles, lookup);
  return lookup;
};

const NEAR_INTEGER_EPSILON = 1e-9;

const candidateTileKeysForCoordinate = (lat: number, lon: number): string[] => {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const latStarts = [latFloor];
  const lonStarts = [lonFloor];

  if (Math.abs(lat - latFloor) <= NEAR_INTEGER_EPSILON) latStarts.push(latFloor - 1);
  if (Math.abs(lon - lonFloor) <= NEAR_INTEGER_EPSILON) lonStarts.push(lonFloor - 1);

  const keys = new Set<string>();
  for (const latStart of latStarts) {
    for (const lonStart of lonStarts) {
      keys.add(tileKeyForStart(latStart, lonStart));
    }
  }
  return Array.from(keys);
};

const pickTileForCoordinate = (
  lookup: Map<string, SrtmTile>,
  lat: number,
  lon: number,
): SrtmTile | null => {
  let chosen: SrtmTile | null = null;

  for (const key of candidateTileKeysForCoordinate(lat, lon)) {
    const candidate = lookup.get(key);
    if (!candidate) continue;
    if (!inTile(candidate, lat, lon)) continue;
    chosen = chosen ? choosePreferredTerrainTile(chosen, candidate) : candidate;
  }

  return chosen;
};

export const sampleSrtmElevation = (
  tiles: ReadonlyArray<SrtmTile>,
  lat: number,
  lon: number,
): number | null => {
  const lookup = tileLookupFor(tiles);
  const tile = pickTileForCoordinate(lookup, lat, lon);
  if (!tile) return null;

  const raw = sampleFromTile(tile, lat, lon);
  if (raw <= -32760) return null;
  return raw;
};
