import type { CoverageSampleLite, TerrainBounds } from "./overlayRaster";

export type ContourLineFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { targetDbm: number };
    geometry: {
      type: "LineString";
      coordinates: [[number, number], [number, number]];
    };
  }>;
};

type GridCell = {
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
  v00: number;
  v10: number;
  v11: number;
  v01: number;
};

const emptyContour = (): ContourLineFeatureCollection => ({ type: "FeatureCollection", features: [] });

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const edgeCrossing = (
  a: { lat: number; lon: number; value: number },
  b: { lat: number; lon: number; value: number },
  targetDbm: number,
): [number, number] | null => {
  const da = a.value - targetDbm;
  const db = b.value - targetDbm;
  if (da === 0 && db === 0) return null;
  if (da * db > 0) return null;
  const denominator = b.value - a.value;
  const t = denominator === 0 ? 0.5 : (targetDbm - a.value) / denominator;
  return [lerp(a.lon, b.lon, t), lerp(a.lat, b.lat, t)];
};

const cellSegments = (cell: GridCell, targetDbm: number): Array<[[number, number], [number, number]]> => {
  const bottomLeft = { lat: cell.lat0, lon: cell.lon0, value: cell.v00 };
  const bottomRight = { lat: cell.lat0, lon: cell.lon1, value: cell.v10 };
  const topRight = { lat: cell.lat1, lon: cell.lon1, value: cell.v11 };
  const topLeft = { lat: cell.lat1, lon: cell.lon0, value: cell.v01 };
  const crossings = [
    edgeCrossing(bottomLeft, bottomRight, targetDbm),
    edgeCrossing(bottomRight, topRight, targetDbm),
    edgeCrossing(topRight, topLeft, targetDbm),
    edgeCrossing(topLeft, bottomLeft, targetDbm),
  ].filter((point): point is [number, number] => point !== null);

  if (crossings.length < 2) return [];
  if (crossings.length === 2) return [[crossings[0], crossings[1]]];
  return [
    [crossings[0], crossings[1]],
    [crossings[2], crossings[3]],
  ];
};

export const buildCoverageTargetContourFeatures = (
  samples: CoverageSampleLite[],
  targetDbm: number,
  bounds?: TerrainBounds | null,
): ContourLineFeatureCollection => {
  if (samples.length < 4 || !Number.isFinite(targetDbm)) return emptyContour();

  const lats = Array.from(new Set(samples.map((sample) => sample.lat))).sort((a, b) => a - b);
  const lons = Array.from(new Set(samples.map((sample) => sample.lon))).sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2 || lats.length * lons.length !== samples.length) return emptyContour();

  const latIndex = new Map<number, number>();
  const lonIndex = new Map<number, number>();
  lats.forEach((lat, index) => latIndex.set(lat, index));
  lons.forEach((lon, index) => lonIndex.set(lon, index));

  const values = new Float64Array(lats.length * lons.length);
  const seen = new Uint8Array(lats.length * lons.length);
  for (const sample of samples) {
    const yi = latIndex.get(sample.lat);
    const xi = lonIndex.get(sample.lon);
    if (yi === undefined || xi === undefined) return emptyContour();
    const idx = yi * lons.length + xi;
    values[idx] = sample.valueDbm;
    seen[idx] = 1;
  }
  for (const mark of seen) {
    if (mark !== 1) return emptyContour();
  }

  const features: ContourLineFeatureCollection["features"] = [];
  for (let y = 0; y < lats.length - 1; y += 1) {
    for (let x = 0; x < lons.length - 1; x += 1) {
      const lat0 = lats[y];
      const lat1 = lats[y + 1];
      const lon0 = lons[x];
      const lon1 = lons[x + 1];
      if (
        bounds &&
        (lat1 < bounds.minLat || lat0 > bounds.maxLat || lon1 < bounds.minLon || lon0 > bounds.maxLon)
      ) {
        continue;
      }
      const idx = y * lons.length + x;
      const segments = cellSegments(
        {
          lat0,
          lat1,
          lon0,
          lon1,
          v00: values[idx],
          v10: values[idx + 1],
          v11: values[idx + lons.length + 1],
          v01: values[idx + lons.length],
        },
        targetDbm,
      );
      for (const segment of segments) {
        features.push({
          type: "Feature",
          properties: { targetDbm },
          geometry: { type: "LineString", coordinates: segment },
        });
      }
    }
  }

  return { type: "FeatureCollection", features };
};
