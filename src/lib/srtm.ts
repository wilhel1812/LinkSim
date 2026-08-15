import type { SrtmTile } from "../types/radio";
import { Unzip, UnzipInflate, unzipSync } from "fflate";
import { choosePreferredTerrainTile } from "./terrainTileRank";
import { normalizeLongitude } from "./terrainTiles";

const HGT_FILENAME = /^([NS])(\d{2})([EW])(\d{3})\.hgt$/i;
const SRTM3_BYTE_LENGTH = 1201 * 1201 * 2;
const SRTM1_BYTE_LENGTH = 3601 * 3601 * 2;
const SUPPORTED_HGT_BYTE_LENGTHS = new Set([SRTM3_BYTE_LENGTH, SRTM1_BYTE_LENGTH]);
const MAX_SRTM_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_SRTM_ZIP_ENTRIES = 16;
const ZIP_STREAM_CHUNK_BYTES = 1024;

type ZipEntryMetadata = {
  name: string;
  size: number;
  originalSize: number;
  compression: number;
};

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

const assertSupportedHgtSize = (fileName: string, byteLength: number): void => {
  if (!SUPPORTED_HGT_BYTE_LENGTHS.has(byteLength)) {
    throw new Error(
      `Unsupported SRTM tile dimensions for ${fileName}. Expected 1201x1201 or 3601x3601 samples.`,
    );
  }
};

const readInt16BigEndian = (buffer: ArrayBuffer): Int16Array => {
  const view = new DataView(buffer);
  const out = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getInt16(i * 2, false);
  }
  return out;
};

const extractBoundedHgt = (
  zipBytes: Uint8Array,
  centralEntryNames: readonly string[],
  selectedMetadata: ZipEntryMetadata,
): ArrayBuffer => {
  const { name: selectedName, originalSize: declaredSize } = selectedMetadata;
  const output = new Uint8Array(declaredSize);
  let actualSize = 0;
  let localEntryCount = 0;
  let localHgtCount = 0;
  let selectedEntries = 0;
  let completed = false;
  const localEntryNames: string[] = [];
  const unzip = new Unzip((file) => {
    localEntryCount += 1;
    if (localEntryCount > MAX_SRTM_ZIP_ENTRIES) {
      throw new Error(`SRTM ZIP exceeds the ${MAX_SRTM_ZIP_ENTRIES} entries limit.`);
    }
    localEntryNames.push(file.name);
    if (file.name.toLowerCase().endsWith(".hgt")) {
      localHgtCount += 1;
      if (localHgtCount > 1) {
        throw new Error(`SRTM archive must contain exactly one local .hgt file: ${selectedName}`);
      }
      if (!parseHeaderFromFilename(file.name) || file.name !== selectedName) {
        throw new Error(`SRTM ZIP central/local HGT mismatch: ${selectedName} / ${file.name}`);
      }
    }
    if (file.name !== selectedName) return;
    if (
      file.compression !== selectedMetadata.compression ||
      (typeof file.size === "number" && file.size !== selectedMetadata.size) ||
      (typeof file.originalSize === "number" && file.originalSize !== selectedMetadata.originalSize)
    ) {
      throw new Error(`SRTM ZIP central/local metadata mismatch: ${selectedName}`);
    }
    selectedEntries += 1;
    if (selectedEntries > 1) {
      throw new Error(`SRTM archive contains duplicate local entry: ${selectedName}`);
    }
    file.ondata = (error, data, final) => {
      if (error) throw error;
      const nextSize = actualSize + data.byteLength;
      if (nextSize > SRTM1_BYTE_LENGTH) {
        file.terminate();
        throw new Error(`SRTM ZIP expanded data limit exceeded for ${selectedName}.`);
      }
      if (nextSize > declaredSize) {
        file.terminate();
        throw new Error(`Expanded SRTM size does not match its ZIP declaration: ${selectedName}`);
      }
      output.set(data, actualSize);
      actualSize = nextSize;
      if (!final) return;
      if (actualSize !== declaredSize) {
        throw new Error(`Expanded SRTM size does not match its ZIP declaration: ${selectedName}`);
      }
      completed = true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < zipBytes.byteLength; offset += ZIP_STREAM_CHUNK_BYTES) {
    const end = Math.min(zipBytes.byteLength, offset + ZIP_STREAM_CHUNK_BYTES);
    unzip.push(zipBytes.subarray(offset, end), end === zipBytes.byteLength);
  }

  if (selectedEntries !== 1 || !completed) {
    throw new Error(`SRTM ZIP did not yield the declared entry: ${selectedName}`);
  }
  if (localHgtCount !== 1) {
    throw new Error(`SRTM archive must contain exactly one local .hgt file: ${selectedName}`);
  }
  const remainingCentralNames = new Map<string, number>();
  for (const name of centralEntryNames) {
    remainingCentralNames.set(name, (remainingCentralNames.get(name) ?? 0) + 1);
  }
  for (const name of localEntryNames) {
    const remaining = remainingCentralNames.get(name) ?? 0;
    if (remaining <= 0) {
      throw new Error(`SRTM ZIP central/local entry mismatch: ${name}`);
    }
    if (remaining === 1) remainingCentralNames.delete(name);
    else remainingCentralNames.set(name, remaining - 1);
  }
  if (localEntryCount !== centralEntryNames.length || remainingCentralNames.size > 0) {
    throw new Error("SRTM ZIP central/local entry count mismatch.");
  }
  return output.buffer;
};

export const parseSrtmTile = async (file: File): Promise<SrtmTile> => {
  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    if (file.size > MAX_SRTM_ZIP_BYTES) {
      throw new Error(`SRTM ZIP exceeds the ${MAX_SRTM_ZIP_BYTES / 1024 / 1024} MiB limit.`);
    }
    const buffer = await file.arrayBuffer();
    return parseSrtmZip(file.name, buffer);
  }

  assertSupportedHgtSize(file.name, file.size);
  const buffer = await file.arrayBuffer();
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
  if (zipBuffer.byteLength > MAX_SRTM_ZIP_BYTES) {
    throw new Error(`SRTM ZIP exceeds the ${MAX_SRTM_ZIP_BYTES / 1024 / 1024} MiB limit.`);
  }

  let entryCount = 0;
  const centralEntryNames: string[] = [];
  let hgtEntryMetadata: ZipEntryMetadata | null = null;
  const zipBytes = new Uint8Array(zipBuffer);
  unzipSync(zipBytes, {
    filter: (entry) => {
      entryCount += 1;
      if (entryCount > MAX_SRTM_ZIP_ENTRIES) {
        throw new Error(`SRTM ZIP exceeds the ${MAX_SRTM_ZIP_ENTRIES} entries limit.`);
      }
      centralEntryNames.push(entry.name);
      if (!entry.name.toLowerCase().endsWith(".hgt")) return false;
      if (hgtEntryMetadata) {
        throw new Error(`SRTM archive must contain exactly one .hgt file: ${archiveName}`);
      }
      if (!parseHeaderFromFilename(entry.name)) {
        throw new Error(`Unsupported SRTM file name: ${entry.name}. Expected e.g. N45W073.hgt`);
      }
      assertSupportedHgtSize(entry.name, entry.originalSize);
      hgtEntryMetadata = {
        name: entry.name,
        size: entry.size,
        originalSize: entry.originalSize,
        compression: entry.compression,
      };
      return false;
    },
  });

  const selectedMetadata = hgtEntryMetadata as ZipEntryMetadata | null;
  if (!selectedMetadata) {
    throw new Error(`No .hgt file found in SRTM archive: ${archiveName}`);
  }

  const hgtBuffer = extractBoundedHgt(zipBytes, centralEntryNames, selectedMetadata);

  return parseSrtmBuffer(selectedMetadata.name, hgtBuffer);
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
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const onLatBoundary = Math.abs(lat - latFloor) <= NEAR_INTEGER_EPSILON;
  const onLonBoundary = Math.abs(lon - lonFloor) <= NEAR_INTEGER_EPSILON;
  if (!onLatBoundary && !onLonBoundary) {
    const candidate = lookup.get(tileKeyForStart(latFloor, lonFloor));
    return candidate && inTile(candidate, lat, lon) ? candidate : null;
  }

  let chosen: SrtmTile | null = null;

  for (const key of candidateTileKeysForCoordinate(lat, lon)) {
    const candidate = lookup.get(key);
    if (!candidate) continue;
    if (!inTile(candidate, lat, lon)) continue;
    chosen = chosen ? choosePreferredTerrainTile(chosen, candidate) : candidate;
  }

  return chosen;
};

const pickTileAndLongitudeForCoordinate = (
  lookup: Map<string, SrtmTile>,
  lat: number,
  lon: number,
): { tile: SrtmTile; lon: number } | null => {
  const normalizedLon = normalizeLongitude(lon);
  const candidateLongitudes = normalizedLon === -180 ? [-180, 180] : [normalizedLon];
  let chosen: { tile: SrtmTile; lon: number } | null = null;

  for (const candidateLon of candidateLongitudes) {
    const candidate = pickTileForCoordinate(lookup, lat, candidateLon);
    if (!candidate) continue;
    if (!chosen) {
      chosen = { tile: candidate, lon: candidateLon };
      continue;
    }
    if (choosePreferredTerrainTile(chosen.tile, candidate) === candidate) {
      chosen = { tile: candidate, lon: candidateLon };
    }
  }

  return chosen;
};

export const sampleSrtmElevation = (
  tiles: ReadonlyArray<SrtmTile>,
  lat: number,
  lon: number,
): number | null => {
  const lookup = tileLookupFor(tiles);
  const selected = pickTileAndLongitudeForCoordinate(lookup, lat, lon);
  if (!selected) return null;

  const raw = sampleFromTile(selected.tile, lat, selected.lon);
  if (raw <= -32760) return null;
  return raw;
};
