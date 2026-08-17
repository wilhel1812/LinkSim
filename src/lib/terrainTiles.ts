export const MAX_TERRAIN_TILE_KEYS = 256;

const TERRAIN_TILE_KEY = /^([NS])(\d{2})([EW])(\d{3})$/;

const isTerrainTileKey = (key: string): boolean => {
  const match = TERRAIN_TILE_KEY.exec(key);
  if (!match) return false;
  const [, latitudeHemisphere, latitudeRaw, longitudeHemisphere, longitudeRaw] = match;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  const validLatitude = latitudeHemisphere === "N"
    ? latitude <= 89
    : latitude >= 1 && latitude <= 90;
  const validLongitude = longitudeHemisphere === "E"
    ? longitude <= 179
    : longitude >= 1 && longitude <= 180;
  return validLatitude && validLongitude;
};

const tileKey = (lat: number, lon: number): string => {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`;
};

export const normalizeLongitude = (lon: number): number => {
  const normalized = ((lon + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
};

export type LongitudeBounds = {
  minLon: number;
  maxLon: number;
  unwrappedMinLon: number;
  unwrappedMaxLon: number;
  spanDeg: number;
  centerLon: number;
};

export const longitudeBoundsForCoordinates = (
  longitudes: readonly number[],
  paddingDeg = 0,
): LongitudeBounds => {
  if (longitudes.length === 0 || !longitudes.every(Number.isFinite) || !Number.isFinite(paddingDeg)) {
    throw new Error("Longitude bounds require finite coordinates.");
  }
  const padding = Math.max(0, paddingDeg);
  const sorted = Array.from(new Set(longitudes.map((lon) => ((lon % 360) + 360) % 360))).sort(
    (a, b) => a - b,
  );
  let start = sorted[0];
  let span = 0;
  if (sorted.length > 1) {
    let largestGap = -1;
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + 360;
      const gap = next - current;
      if (gap > largestGap) {
        largestGap = gap;
        start = next % 360;
      }
    }
    span = 360 - largestGap;
  }

  const paddedSpan = Math.min(360, span + padding * 2);
  if (paddedSpan >= 360) {
    return {
      minLon: -180,
      maxLon: 180,
      unwrappedMinLon: -180,
      unwrappedMaxLon: 180,
      spanDeg: 360,
      centerLon: 0,
    };
  }
  let unwrappedMinLon = normalizeLongitude(start - padding);
  let unwrappedMaxLon = unwrappedMinLon + paddedSpan;
  if ((unwrappedMinLon + unwrappedMaxLon) / 2 >= 180) {
    unwrappedMinLon -= 360;
    unwrappedMaxLon -= 360;
  }
  return {
    minLon: normalizeLongitude(unwrappedMinLon),
    maxLon: normalizeLongitude(unwrappedMaxLon),
    unwrappedMinLon,
    unwrappedMaxLon,
    spanDeg: paddedSpan,
    centerLon: normalizeLongitude(unwrappedMinLon + paddedSpan / 2),
  };
};

export const unwrapLongitudeToInterval = (lon: number, bounds: LongitudeBounds): number => {
  if (!Number.isFinite(lon)) throw new Error("Longitude must be finite.");
  const normalized = normalizeLongitude(lon);
  const center = (bounds.unwrappedMinLon + bounds.unwrappedMaxLon) / 2;
  return normalized + Math.round((center - normalized) / 360) * 360;
};

const longitudeEnumeration = (minLon: number, maxLon: number): { start: number; span: number } => {
  if (minLon <= maxLon) {
    const directSpan = maxLon - minLon;
    if (directSpan >= 360) return { start: -180, span: 360 };
    return { start: normalizeLongitude(minLon), span: directSpan };
  }

  const wrappedSpan = ((maxLon - minLon) % 360 + 360) % 360;
  return { start: normalizeLongitude(minLon), span: wrappedSpan };
};

const addBoundedKey = (keys: Set<string>, key: string): void => {
  keys.add(key);
  if (keys.size > MAX_TERRAIN_TILE_KEYS) {
    throw new Error(`Terrain area exceeds maximum of ${MAX_TERRAIN_TILE_KEYS} tiles.`);
  }
};

export const boundedUniqueTerrainTileKeys = (tileKeys: Iterable<string>): string[] => {
  const keys = new Set<string>();
  for (const key of tileKeys) {
    if (!isTerrainTileKey(key)) {
      throw new Error(`Invalid terrain tile key: ${key}`);
    }
    addBoundedKey(keys, key);
  }
  return Array.from(keys);
};

export const tilesForBounds = (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
): string[] => {
  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) {
    throw new Error("Terrain bounds must be finite numbers.");
  }
  if (minLat > maxLat) {
    throw new Error("Terrain latitude bounds are reversed.");
  }

  const keys = new Set<string>();
  const latStart = Math.max(-90, Math.floor(minLat));
  const latEnd = Math.min(89, Math.floor(maxLat));
  const longitude = longitudeEnumeration(minLon, maxLon);
  const lonStart = Math.floor(longitude.start);
  const lonEnd = Math.floor(longitude.start + longitude.span);

  for (let lat = latStart; lat <= latEnd; lat += 1) {
    for (let lon = lonStart; lon <= lonEnd; lon += 1) {
      addBoundedKey(keys, tileKey(lat, normalizeLongitude(lon)));
    }
  }
  return Array.from(keys).sort();
};
