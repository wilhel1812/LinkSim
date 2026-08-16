import type { SrtmTile } from "../types/radio";
import { choosePreferredTerrainTile } from "./terrainTileRank";
import { normalizeLongitude } from "./terrainTiles";

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
