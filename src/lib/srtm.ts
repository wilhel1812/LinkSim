import type { SrtmTile } from "../types/radio";
import { choosePreferredTerrainTile } from "./terrainTileRank";
import { normalizeLongitude } from "./terrainTiles";
import { createLruCache, type LruCache } from "./lruCache";
import { OverlayTaskCancelledError, runCooperativeLoop, type OverlayTaskContext } from "./overlayRaster";
import type { CoverageGridBounds } from "./coverage";

const inTile = (tile: SrtmTile, lat: number, lon: number): boolean =>
  lat >= tile.latStart &&
  lat <= tile.latStart + 1 &&
  lon >= tile.lonStart &&
  lon <= tile.lonStart + 1;

const tileGridPosition = (tile: SrtmTile, lat: number, lon: number): { row: number; col: number } => {
  const width = tile.width ?? tile.size;
  const height = tile.height ?? tile.size;
  const latNorm = (lat - tile.latStart) / 1;
  const lonNorm = (lon - tile.lonStart) / 1;

  const row = Math.max(0, Math.min(height - 1, Math.round((1 - latNorm) * (height - 1))));
  const col = Math.max(0, Math.min(width - 1, Math.round(lonNorm * (width - 1))));

  return { row, col };
};

const sampleFromTile = (tile: SrtmTile, lat: number, lon: number): number => {
  const { row, col } = tileGridPosition(tile, lat, lon);
  return tile.elevations[row * (tile.width ?? tile.size) + col];
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

const AREA_COMPLETENESS_CACHE = new WeakMap<ReadonlyArray<SrtmTile>, LruCache<boolean>>();

/** Prove every nearest-neighbour DEM cell in a rectangle is available.
 * A failed proof is inconclusive: callers must retain exact path validation.
 * Tile arrays/data are immutable snapshots, as required by tileLookupFor.
 */
export const isSrtmAreaCompleteAsync = async (
  tiles: ReadonlyArray<SrtmTile>, bounds: CoverageGridBounds, context?: OverlayTaskContext,
): Promise<boolean> => {
  if (context?.shouldCancel?.()) throw new OverlayTaskCancelledError();
  // Keep dateline and malformed bounds on the existing dateline-safe path sampler.
  if (!Object.values(bounds).every(Number.isFinite) || bounds.minLat > bounds.maxLat ||
      bounds.minLon > bounds.maxLon || bounds.minLon <= -180 || bounds.maxLon >= 180 ||
      bounds.maxLon - bounds.minLon > 180 || bounds.minLat <= -90 || bounds.maxLat >= 90) return false;
  let cache = AREA_COMPLETENESS_CACHE.get(tiles);
  if (!cache) {
    cache = createLruCache<boolean>(2);
    AREA_COMPLETENESS_CACHE.set(tiles, cache);
  }
  const key = JSON.stringify(bounds);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const lookup = tileLookupFor(tiles);
  // Include a small margin for normalized longitude and path interpolation rounding.
  const minLat = bounds.minLat - NEAR_INTEGER_EPSILON;
  const maxLat = bounds.maxLat + NEAR_INTEGER_EPSILON;
  const minLon = bounds.minLon - NEAR_INTEGER_EPSILON;
  const maxLon = bounds.maxLon + NEAR_INTEGER_EPSILON;
  let complete = true;
  for (let latStart = Math.floor(minLat); latStart <= Math.floor(maxLat) && complete; latStart += 1) {
    for (let lonStart = Math.floor(minLon); lonStart <= Math.floor(maxLon) && complete; lonStart += 1) {
      const tile = lookup.get(tileKeyForStart(latStart, lonStart));
      if (!tile || tile.latStart !== latStart || tile.lonStart !== lonStart) { complete = false; break; }
      const width = tile.width ?? tile.size;
      const height = tile.height ?? tile.size;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
          tile.elevations.length !== width * height) { complete = false; break; }
      const first = tileGridPosition(tile, Math.min(maxLat, latStart + 1), Math.max(minLon, lonStart));
      const last = tileGridPosition(tile, Math.max(minLat, latStart), Math.min(maxLon, lonStart + 1));
      const scanWidth = last.col - first.col + 1;
      const totalCells = scanWidth * (last.row - first.row + 1);
      // Bound each cooperative callback even for very wide DEMs. Reuse the raster
      // scheduler's frame budget and cancellation instead of blocking on a whole tile.
      const cellsPerChunk = 256;
      await runCooperativeLoop(Math.ceil(totalCells / cellsPerChunk), (chunk) => {
        if (!complete) return;
        const end = Math.min(totalCells, (chunk + 1) * cellsPerChunk);
        for (let index = chunk * cellsPerChunk; index < end; index += 1) {
          const row = first.row + Math.floor(index / scanWidth);
          const col = first.col + index % scanWidth;
          const raw = tile.elevations[row * width + col];
          if (!Number.isFinite(raw) || raw <= -32760) { complete = false; break; }
        }
      }, context);
    }
  }
  if (context?.shouldCancel?.()) throw new OverlayTaskCancelledError();
  cache.set(key, complete);
  return complete;
};
