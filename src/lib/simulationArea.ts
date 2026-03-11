import type { Site } from "../types/radio";

export type SimulationAreaBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  latSpanDeg: number;
  lonSpanDeg: number;
  isCapped: boolean;
};

const LAT_PAD_DEG = 0.15;
const LON_PAD_DEG = 0.15;
const MAX_SPAN_DEG = 5;

export const simulationAreaBoundsForSites = (
  sites: Pick<Site, "position">[],
): SimulationAreaBounds | null => {
  if (!sites.length) return null;
  const lats = sites.map((site) => site.position.lat);
  const lons = sites.map((site) => site.position.lon);
  const minLatRaw = Math.min(...lats);
  const maxLatRaw = Math.max(...lats);
  const minLonRaw = Math.min(...lons);
  const maxLonRaw = Math.max(...lons);

  const rawLatSpan = maxLatRaw - minLatRaw + LAT_PAD_DEG * 2;
  const rawLonSpan = maxLonRaw - minLonRaw + LON_PAD_DEG * 2;
  const latSpanDeg = Math.min(MAX_SPAN_DEG, rawLatSpan);
  const lonSpanDeg = Math.min(MAX_SPAN_DEG, rawLonSpan);
  const isCapped = rawLatSpan > MAX_SPAN_DEG || rawLonSpan > MAX_SPAN_DEG;

  const latCenter = (minLatRaw + maxLatRaw) / 2;
  const lonCenter = (minLonRaw + maxLonRaw) / 2;

  return {
    minLat: latCenter - latSpanDeg / 2,
    maxLat: latCenter + latSpanDeg / 2,
    minLon: lonCenter - lonSpanDeg / 2,
    maxLon: lonCenter + lonSpanDeg / 2,
    latSpanDeg,
    lonSpanDeg,
    isCapped,
  };
};
