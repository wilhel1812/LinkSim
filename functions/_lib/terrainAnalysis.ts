import type { Env } from "./types";

const COPERNICUS_PROXY_BASE = "/copernicus";
const CACHE_NAME = "linksim-api-terrain-v1";
const FETCH_TIMEOUT_MS = 15000;

const haversineDistanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon - a.lon);
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(hav));
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const firstFresnelRadiusM = (distanceKm: number, frequencyMHz: number, t: number): number => {
  const dTotalM = distanceKm * 1000;
  const d1 = dTotalM * t;
  const d2 = dTotalM - d1;
  const wavelengthM = 300 / frequencyMHz;
  return Math.sqrt((wavelengthM * d1 * d2) / dTotalM);
};

const knifeEdgeLossDb = (v: number): number => {
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
};

const earthBulgeM = (distanceM: number, xM: number, kFactor: number): number => {
  const effectiveRadius = 6_371_000 * Math.max(1, kFactor);
  return (xM * (distanceM - xM)) / (2 * effectiveRadius);
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

type TileData = {
  key: string;
  latStart: number;
  lonStart: number;
  resolution: number;
  elevations: Int16Array;
  width: number;
  height: number;
};

const fetchTileAsBytes = async (origin: string, dataset: "30m" | "90m", tileKeyParam: string): Promise<ArrayBuffer | null> => {
  const ns = tileKeyParam.slice(0, 1);
  const lat = tileKeyParam.slice(1, 3);
  const ew = tileKeyParam.slice(3, 4);
  const lon = tileKeyParam.slice(4, 7);
  // 30m data is actually in the 90m bucket, and 90m is also in the 90m bucket
  const bucketDataset = dataset === "30m" ? "90m" : "90m";
  const tileName = `Copernicus_DSM_COG_${dataset === "30m" ? "30" : "90"}_${ns}${lat}_00_${ew}${String(lon).padStart(3, "0")}_00_DEM`;
  const url = `${origin}${COPERNICUS_PROXY_BASE}/${bucketDataset}/${tileName}/${tileName}.tif`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return response.arrayBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const parseGeoTiff = (buffer: ArrayBuffer, tileKeyParam: string): TileData | null => {
  // Simplified TIFF parsing - just get dimensions and basic data
  // For production, you'd want full GeoTIFF parsing
  try {
    const view = new DataView(buffer);
    // Basic TIFF header validation
    const endian = view.getUint16(0) === 0x4949 ? "little" : "big";
    const getUint16 = (offset: number) => view.getUint16(offset, endian === "little");
    const getUint32 = (offset: number) => view.getUint32(offset, endian === "little");

    const ifdOffset = getUint32(4);
    const numTags = getUint16(ifdOffset);
    
    let width = 0, height = 0, bitsPerSample = 0, sampleFormat = 0;
    
    for (let i = 0; i < numTags; i++) {
      const tagOffset = ifdOffset + 2 + i * 12;
      const tag = getUint16(tagOffset);
      const type = getUint16(tagOffset + 2);
      const value = type === 3 ? getUint16(tagOffset + 8) : getUint32(tagOffset + 8);
      
      if (tag === 256) width = value;       // ImageWidth
      if (tag === 257) height = value;      // ImageLength
      if (tag === 258) bitsPerSample = value; // BitsPerSample
      if (tag === 339) sampleFormat = value;  // SampleFormat
    }

    if (width === 0 || height === 0) return null;

    // Extract elevation data from the file
    // This is simplified - real implementation would properly parse the TIFF
    const bytesPerPixel = bitsPerSample / 8;
    const dataOffset = ifdOffset + 2 + numTags * 12 + 4;
    const dataSize = width * height * bytesPerPixel;
    
    if (dataOffset + dataSize > buffer.byteLength) return null;

    const elevations = new Int16Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const offset = dataOffset + i * bytesPerPixel;
      const value = bytesPerPixel === 2 
        ? view.getInt16(offset, endian === "little")
        : view.getUint16(offset, endian === "little");
      elevations[i] = value === -32768 ? -32768 : value;
    }

    // Parse key back to lat/lon
    const ns = tileKeyParam.slice(0, 1);
    const latNum = parseInt(tileKeyParam.slice(1, 3), 10);
    const ew = tileKeyParam.slice(3, 4);
    const lonNum = parseInt(tileKeyParam.slice(4, 7), 10);
    const latStart = ns === "N" ? latNum : -latNum;
    const lonStart = ew === "E" ? lonNum : -lonNum;

    return {
      key: tileKeyParam,
      latStart,
      lonStart,
      resolution: width === 3601 ? 1 : 3,
      elevations,
      width,
      height,
    };
  } catch {
    return null;
  }
};

const sampleFromTile = (tile: TileData, lat: number, lon: number): number | null => {
  const { latStart, lonStart, resolution, elevations, width } = tile;
  const resDeg = resolution / 3600;
  const col = Math.round((lon - lonStart) / resDeg);
  const row = Math.round((latStart - lat) / resDeg);

  if (col < 0 || col >= width || row < 0 || row >= tile.height) return null;
  
  const value = elevations[row * width + col];
  return value === -32768 ? null : value;
};

const estimateTerrainExcessLossDb = (
  elevations: number[],
  distanceKm: number,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  frequencyMHz: number,
  fromAntennaHeightM: number,
  toAntennaHeightM: number,
  kFactor: number = 4 / 3,
  clutterHeightM: number = 0,
  polarization: "Vertical" | "Horizontal" = "Vertical",
): number => {
  const sampleCount = Math.max(16, elevations.length);
  const distanceM = distanceKm * 1000;
  const wavelengthM = 300 / Math.max(1, frequencyMHz);

  const fromAntennaAbsM = elevations[0] + fromAntennaHeightM;
  const toAntennaAbsM = elevations[elevations.length - 1] + toAntennaHeightM;

  const terrainAt = (index: number): number => {
    const val = elevations[index];
    return val === -32768 || val === undefined ? 0 : val;
  };
  const distanceAt = (index: number): number => (sampleCount <= 1 ? 0 : (index / (sampleCount - 1)) * distanceM);

  const segmentLoss = (
    startIndex: number,
    endIndex: number,
    startHeightM: number,
    endHeightM: number,
    depth: number,
  ): number => {
    if (endIndex - startIndex < 2) return 0;
    const segDist = Math.max(1, distanceAt(endIndex) - distanceAt(startIndex));
    let maxV = Number.NEGATIVE_INFINITY;
    let maxIndex = -1;
    let maxObstacleM = 0;
    let maxClearanceM = Number.NEGATIVE_INFINITY;

    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const d1 = distanceAt(i) - distanceAt(startIndex);
      const d2 = distanceAt(endIndex) - distanceAt(i);
      if (d1 <= 0 || d2 <= 0) continue;
      const t = d1 / segDist;
      const losM = startHeightM + (endHeightM - startHeightM) * t;
      const bulgeM = earthBulgeM(segDist, d1, kFactor);
      const clutterBoost = Math.max(0, clutterHeightM) * 0.55;
      const obstacleM = terrainAt(i) + bulgeM + clutterBoost;
      const clearanceM = obstacleM - losM;
      const fresnelM = Math.max(0.5, Math.sqrt((wavelengthM * d1 * d2) / segDist));
      const v = clearanceM / fresnelM;
      if (v > maxV) {
        maxV = v;
        maxIndex = i;
        maxObstacleM = obstacleM;
        maxClearanceM = clearanceM;
      }
    }

    if (maxIndex < 0 || maxV <= -0.78) return 0;
    const directLoss = knifeEdgeLossDb(maxV) + (polarization === "Horizontal" ? 0.5 : 0);
    if (maxClearanceM <= 0) return directLoss * 0.32;
    if (depth >= 4) return directLoss;
    const left = segmentLoss(startIndex, maxIndex, startHeightM, maxObstacleM, depth + 1);
    const right = segmentLoss(maxIndex, endIndex, maxObstacleM, endHeightM, depth + 1);
    return directLoss + left + right;
  };

  const diffractionLoss = segmentLoss(0, elevations.length - 1, fromAntennaAbsM, toAntennaAbsM, 0);

  const validElevations = elevations.filter((e) => e !== -32768 && e !== undefined);
  const mean = validElevations.length > 0 
    ? validElevations.reduce((s, v) => s + v, 0) / validElevations.length 
    : 0;
  const variance = validElevations.length > 0 
    ? validElevations.reduce((s, v) => s + (v - mean) ** 2, 0) / validElevations.length 
    : 0;
  const terrainStd = Math.sqrt(variance);
  const roughnessLoss = clamp((terrainStd - 20) * 0.12, 0, 8);
  const clutterLoss = clamp(clutterHeightM * 0.22, 0, 12);

  if (!Number.isFinite(diffractionLoss)) return 0;
  return clamp(diffractionLoss + roughnessLoss + clutterLoss, 0, 90);
};

const isTerrainLineObstructed = (
  elevations: number[],
  distanceKm: number,
  fromAntennaHeightM: number,
  toAntennaHeightM: number,
  kFactor: number = 4 / 3,
  clutterHeightM: number = 0,
): boolean => {
  const sampleCount = Math.max(12, elevations.length);
  const distanceM = distanceKm * 1000;
  const fromAntennaAbsM = elevations[0] + fromAntennaHeightM;
  const toAntennaAbsM = elevations[elevations.length - 1] + toAntennaHeightM;
  const clutterBoost = Math.max(0, clutterHeightM) * 0.55;

  for (let i = 1; i < sampleCount - 1; i += 1) {
    const t = i / (sampleCount - 1);
    const d1 = distanceM * t;
    const losM = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * t;
    const bulgeM = earthBulgeM(distanceM, d1, kFactor);
    const val = elevations[i];
    const terrainM = (val === -32768 || val === undefined) ? 0 : val;
    const obstacleM = terrainM + bulgeM + clutterBoost;
    if (obstacleM > losM) return true;
  }
  return false;
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

export const analyzeTerrainLink = async (
  env: Env,
  requestUrl: string,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  frequencyMhz: number,
  fromAntennaHeightM: number = 2,
  toAntennaHeightM: number = 2,
  samples: number = 80,
): Promise<TerrainAnalysisResult> => {
  const origin = new URL(requestUrl).origin;

  const minLat = Math.min(fromLat, toLat) - 0.1;
  const maxLat = Math.max(fromLat, toLat) + 0.1;
  const minLon = Math.min(fromLon, toLon) - 0.1;
  const maxLon = Math.max(fromLon, toLon) + 0.1;

  const tileKeys = tilesForBounds(minLat, maxLat, minLon, maxLon);

  const tiles: TileData[] = [];
  const tilesFetched: string[] = [];

  for (const key of tileKeys) {
    let tileData: ArrayBuffer | null = null;
    
    // Try 30m first
    tileData = await fetchTileAsBytes(origin, "30m", key);
    if (!tileData) {
      // Fallback to 90m
      tileData = await fetchTileAsBytes(origin, "90m", key);
      if (tileData) tilesFetched.push(`${key} (90m)`);
    } else {
      tilesFetched.push(`${key} (30m)`);
    }
    
    if (tileData) {
      const parsed = parseGeoTiff(tileData, key);
      if (parsed) tiles.push(parsed);
    }
  }

  if (tiles.length === 0) {
    throw new Error("No terrain tiles available for this region");
  }

  const elevations: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = samples <= 1 ? 0 : i / (samples - 1);
    const lat = fromLat + (toLat - fromLat) * t;
    const lon = fromLon + (toLon - fromLon) * t;

    let elevation: number | null = null;
    for (const tile of tiles) {
      elevation = sampleFromTile(tile, lat, lon);
      if (elevation !== null) break;
    }
    elevations.push(elevation ?? -32768);
  }

  const distanceKm = haversineDistanceKm({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon });
  const baselineFsplDb = 32.44 + 20 * Math.log10(Math.max(0.001, distanceKm)) + 20 * Math.log10(frequencyMhz);

  const terrainPenaltyDb = estimateTerrainExcessLossDb(
    elevations,
    distanceKm,
    fromLat,
    fromLon,
    toLat,
    toLon,
    frequencyMhz,
    fromAntennaHeightM,
    toAntennaHeightM,
  );

  const obstructed = isTerrainLineObstructed(
    elevations,
    distanceKm,
    fromAntennaHeightM,
    toAntennaHeightM,
  );

  let maxIntrusionM = 0;
  const distanceM = distanceKm * 1000;
  const fromAntennaAbsM = elevations[0] + fromAntennaHeightM;
  const toAntennaAbsM = elevations[elevations.length - 1] + toAntennaHeightM;

  for (let i = 1; i < elevations.length - 1; i += 1) {
    const t = i / (elevations.length - 1);
    const d1 = distanceM * t;
    const losM = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * t;
    const bulgeM = earthBulgeM(distanceM, d1, 4 / 3);
    const val = elevations[i];
    const terrainM = (val === -32768 || val === undefined) ? 0 : val;
    const intrusionM = terrainM + bulgeM - losM;
    if (intrusionM > maxIntrusionM) maxIntrusionM = intrusionM;
  }

  const midPointT = 0.5;
  const midD1 = distanceM * midPointT;
  const midLosM = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * midPointT;
  const midBulgeM = earthBulgeM(distanceM, midD1, 4 / 3);
  const midVal = elevations[Math.floor(elevations.length / 2)];
  const midTerrainM = ((midVal === -32768 || midVal === undefined) ? 0 : midVal) + midBulgeM;
  const fresnelRadiusM = firstFresnelRadiusM(distanceKm, frequencyMhz, midPointT);
  const geometricClearanceM = midLosM - midTerrainM;
  const fresnelClearancePercent = Math.max(0, Math.min(100, (geometricClearanceM / fresnelRadiusM) * 100));

  return {
    distanceKm,
    baselineFsplDb,
    terrainPenaltyDb,
    totalPathLossDb: baselineFsplDb + terrainPenaltyDb,
    terrainObstructed: obstructed,
    maxIntrusionM,
    fresnelClearancePercent,
    samplesUsed: elevations.filter((e) => e !== -32768 && e !== undefined).length,
    tilesFetched,
  };
};
