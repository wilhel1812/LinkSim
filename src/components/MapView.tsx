import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Egg, Fullscreen, Maximize2, Minimize2, Rabbit, RefreshCw, SquareStack, ZoomIn, ZoomOut } from "lucide-react";
import Map, {
  Layer,
  type MapRef,
  Marker,
  Source,
  type MapLayerMouseEvent,
  type MarkerDragEvent,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import { classifyPassFailState, computeSourceCentricRxMetrics } from "../lib/passFailState";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { sampleSrtmElevation } from "../lib/srtm";
import { getUiErrorMessage } from "../lib/uiError";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { getBasemapProviderCapabilities, getCartoFallbackStyle, resolveBasemapSelection } from "../lib/basemaps";
import {
  PROFILE_DRAFT_SITE_REQUEST_EVENT,
  type ProfileDraftSiteRequestDetail,
} from "../lib/profileDraftEvent";
import { useAppStore } from "../store/appStore";
import { useCoverageStore } from "../store/coverageStore";
import { TERRAIN_DATASET_LABEL } from "../lib/terrainDataset";
import type { Link, PropagationEnvironment, Site } from "../types/radio";
import { fetchMeshmapNodes, type MeshmapNode } from "../lib/meshtasticMqtt";
import { canShowSaveSelectedLinkAction } from "../lib/selectedPairActions";
import { SimulationResultsSection } from "./SimulationResultsSection";
import { ActionButton } from "./ActionButton";
import { useMapControls } from "./map/useMapControls";

const UI_SECTION_KEYS = {
  mapViewResults: "linksim-ui-mapview-results-v1",
  mapViewSimSummary: "linksim-ui-mapview-sim-summary-v1",
  mapViewOverlayGuide: "linksim-ui-mapview-overlay-guide-v1",
} as const;

const readSectionBool = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
};

const writeSectionBool = (key: string, value: boolean): void => {
  try { localStorage.setItem(key, String(value)); } catch {}
};

const mapLineLayer = (linkColor: string, selectedColor: string): LayerProps => ({
  id: "link-lines",
  type: "line",
  paint: {
    "line-color": [
      "case",
      ["==", ["get", "selected"], 1],
      selectedColor,
      ["==", ["get", "temporary"], 1],
      selectedColor,
      linkColor,
    ],
    "line-width": [
      "case",
      ["==", ["get", "selected"], 1],
      4.5,
      ["==", ["get", "temporary"], 1],
      3.5,
      3,
    ],
    "line-opacity": [
      "case",
      ["==", ["get", "selected"], 1],
      0.98,
      ["==", ["get", "temporary"], 1],
      0.9,
      0.72,
    ],
    "line-dasharray": [1.5, 1],
  },
});

const profileLineLayer = (color: string): LayerProps => ({
  id: "profile-line",
  type: "line",
  paint: {
    "line-color": color,
    "line-width": 3.6,
    "line-opacity": 0.9,
  },
});

const coverageRasterLayer: LayerProps = {
  id: "coverage-overlay-layer",
  type: "raster",
  paint: {
    "raster-opacity": 0.68,
    "raster-contrast": 0.08,
    "raster-saturation": 0.02,
  },
};

const terrainRasterPaint = {
  "raster-opacity": 0.62,
  "raster-contrast": 0.16,
  "raster-saturation": -0.06,
};

const supportsWebgl = (): boolean => {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const fmtDbm = (value: number): string => `${value.toFixed(1)} dBm`;

const guessSiteNameForPosition = async (lat: number, lon: number): Promise<string> => {
  const fallback = `Site ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const reverseUrl = new URL("https://nominatim.openstreetmap.org/reverse");
  reverseUrl.searchParams.set("format", "jsonv2");
  reverseUrl.searchParams.set("lat", lat.toFixed(7));
  reverseUrl.searchParams.set("lon", lon.toFixed(7));
  reverseUrl.searchParams.set("zoom", "16");
  reverseUrl.searchParams.set("addressdetails", "1");

  const response = await fetch(reverseUrl.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) return fallback;
  const payload = (await response.json()) as {
    name?: string;
    display_name?: string;
    address?: {
      road?: string;
      hamlet?: string;
      village?: string;
      town?: string;
      city?: string;
      municipality?: string;
      county?: string;
    };
  };
  const address = payload.address ?? {};
  const place =
    payload.name?.trim() ||
    address.road?.trim() ||
    address.hamlet?.trim() ||
    address.village?.trim() ||
    address.town?.trim() ||
    address.city?.trim() ||
    address.municipality?.trim() ||
    address.county?.trim() ||
    payload.display_name?.split(",")[0]?.trim();
  return place?.length ? place : fallback;
};

type TerrainBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};
type CoverageSampleLite = { lat: number; lon: number; valueDbm: number };
type BandStepMode = "auto" | 3 | 5 | 8 | 10;
type OverlayRaster = {
  url: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
};

type OverlayMaskArea = {
  bounds: TerrainBounds;
  contains: (lat: number, lon: number) => boolean;
};

const computeTerrainBounds = (sites: { position: { lat: number; lon: number } }[]): TerrainBounds => {
  const lats = sites.map((site) => site.position.lat);
  const lons = sites.map((site) => site.position.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const latPadding = Math.max(0.01, (maxLat - minLat) * 0.22);
  const lonPadding = Math.max(0.01, (maxLon - minLon) * 0.22);

  return {
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
    minLon: minLon - lonPadding,
    maxLon: maxLon + lonPadding,
  };
};

const distanceKmBetween = (latA: number, lonA: number, latB: number, lonB: number): number => {
  const dLat = (latB - latA) * 111.32;
  const midLat = (latA + latB) / 2;
  const dLon = (lonB - lonA) * 111.32 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

const distancePointToSegmentKm = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
};

const convexHull = (points: { x: number; y: number }[]): { x: number; y: number }[] => {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: { x: number; y: number }[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
};

const pointInPolygon = (x: number, y: number, polygon: { x: number; y: number }[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const buildBufferedSelectionArea = (sites: Site[], radiusKm: number): OverlayMaskArea | null => {
  if (!sites.length) return null;
  const centerLat = sites.reduce((sum, site) => sum + site.position.lat, 0) / sites.length;
  const kmPerLat = 111.32;
  const kmPerLon = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)) * 111.32;
  const projected = sites.map((site) => ({
    x: site.position.lon * kmPerLon,
    y: site.position.lat * kmPerLat,
    lat: site.position.lat,
    lon: site.position.lon,
  }));
  const hull = convexHull(projected.map((point) => ({ x: point.x, y: point.y })));
  const minLat = Math.min(...projected.map((point) => point.lat));
  const maxLat = Math.max(...projected.map((point) => point.lat));
  const minLon = Math.min(...projected.map((point) => point.lon));
  const maxLon = Math.max(...projected.map((point) => point.lon));
  const latDelta = Math.max(0.01, radiusKm / kmPerLat);
  const lonDelta = Math.max(0.01, radiusKm / kmPerLon);
  const bounds: TerrainBounds = {
    minLat: minLat - latDelta,
    maxLat: maxLat + latDelta,
    minLon: minLon - lonDelta,
    maxLon: maxLon + lonDelta,
  };

  const contains = (lat: number, lon: number): boolean => {
    const x = lon * kmPerLon;
    const y = lat * kmPerLat;
    if (projected.length === 1) {
      return distanceKmBetween(lat, lon, projected[0].lat, projected[0].lon) <= radiusKm;
    }
    if (hull.length <= 2) {
      const a = hull[0];
      const b = hull[1] ?? hull[0];
      return distancePointToSegmentKm(x, y, a.x, a.y, b.x, b.y) <= radiusKm;
    }
    if (pointInPolygon(x, y, hull)) return true;
    for (let index = 0; index < hull.length; index += 1) {
      const a = hull[index];
      const b = hull[(index + 1) % hull.length];
      if (distancePointToSegmentKm(x, y, a.x, a.y, b.x, b.y) <= radiusKm) return true;
    }
    return false;
  };

  return { bounds, contains };
};

const computeCoverageBounds = (samples: CoverageSampleLite[]): TerrainBounds | null => {
  if (!samples.length) return null;
  const lats = samples.map((sample) => sample.lat);
  const lons = samples.map((sample) => sample.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latPad = Math.max(0.008, (maxLat - minLat) * 0.06);
  const lonPad = Math.max(0.008, (maxLon - minLon) * 0.06);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
  };
};

const boundsDiagonalKm = (bounds: TerrainBounds): number => {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latSpanKm = Math.abs(bounds.maxLat - bounds.minLat) * 111.32;
  const lonSpanKm =
    Math.abs(bounds.maxLon - bounds.minLon) *
    111.32 *
    Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  return Math.hypot(latSpanKm, lonSpanKm);
};

const coverageColorForDbm = (valueDbm: number): [number, number, number] => {
  const stops: Array<{ v: number; c: [number, number, number] }> = [
    { v: -125, c: [105, 42, 45] },
    { v: -114, c: [156, 63, 49] },
    { v: -104, c: [201, 92, 45] },
    { v: -95, c: [226, 127, 45] },
    { v: -86, c: [218, 175, 55] },
    { v: -78, c: [164, 193, 68] },
    { v: -70, c: [95, 178, 95] },
    { v: -62, c: [64, 150, 178] },
  ];
  if (valueDbm <= stops[0].v) return stops[0].c;
  if (valueDbm >= stops[stops.length - 1].v) return stops[stops.length - 1].c;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (valueDbm < a.v || valueDbm > b.v) continue;
    const t = (valueDbm - a.v) / (b.v - a.v);
    return [
      Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
      Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
      Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
    ];
  }
  return [255, 255, 255];
};

const coverageColorAdaptive = (valueDbm: number, samples: CoverageSampleLite[]): [number, number, number] => {
  if (samples.length < 2) return coverageColorForDbm(valueDbm);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample.valueDbm);
    max = Math.max(max, sample.valueDbm);
  }
  const range = Math.max(6, max - min);
  const normalized = -125 + ((valueDbm - min) / range) * 63;
  return coverageColorForDbm(clamp(normalized, -125, -62));
};

const autoBandStepDb = (samples: CoverageSampleLite[], bounds: TerrainBounds): 3 | 5 | 8 | 10 => {
  if (samples.length < 2) return 5;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample.valueDbm);
    max = Math.max(max, sample.valueDbm);
  }
  const dynamicRange = Math.max(0, max - min);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latSpanKm = Math.abs(bounds.maxLat - bounds.minLat) * 111.32;
  const lonSpanKm =
    Math.abs(bounds.maxLon - bounds.minLon) *
    111.32 *
    Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const diagonalKm = Math.hypot(latSpanKm, lonSpanKm);

  if (diagonalKm > 90 || dynamicRange > 45) return 10;
  if (diagonalKm > 45 || dynamicRange > 30) return 8;
  if (diagonalKm > 20 || dynamicRange > 18) return 5;
  return 3;
};

const interpolateCoverageDbm = (samples: CoverageSampleLite[], lat: number, lon: number): number | null => {
  if (!samples.length) return null;
  let weightSum = 0;
  let valueSum = 0;
  for (const sample of samples) {
    const dLat = sample.lat - lat;
    const dLon = sample.lon - lon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < 1e-12) return sample.valueDbm;
    const weight = 1 / d2;
    weightSum += weight;
    valueSum += sample.valueDbm * weight;
  }
  if (weightSum <= 0) return null;
  return valueSum / weightSum;
};

const binarySearchFloor = (values: number[], target: number): number => {
  let lo = 0;
  let hi = values.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = values[mid];
    if (value <= target) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return clamp(hi, 0, values.length - 1);
};

const makeGridInterpolator = (
  samples: CoverageSampleLite[],
): ((lat: number, lon: number) => number | null) | null => {
  if (samples.length < 4) return null;
  const latSet = new Set<number>();
  const lonSet = new Set<number>();
  for (const sample of samples) {
    latSet.add(sample.lat);
    lonSet.add(sample.lon);
  }
  const lats = Array.from(latSet).sort((a, b) => a - b);
  const lons = Array.from(lonSet).sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  if (lats.length * lons.length !== samples.length) return null;

  const latIndex = new globalThis.Map<number, number>();
  const lonIndex = new globalThis.Map<number, number>();
  lats.forEach((value, index) => latIndex.set(value, index));
  lons.forEach((value, index) => lonIndex.set(value, index));

  const values = new Float64Array(lats.length * lons.length);
  const seen = new Uint8Array(lats.length * lons.length);
  for (const sample of samples) {
    const yi = latIndex.get(sample.lat);
    const xi = lonIndex.get(sample.lon);
    if (yi === undefined || xi === undefined) return null;
    const idx = yi * lons.length + xi;
    values[idx] = sample.valueDbm;
    seen[idx] = 1;
  }
  for (const mark of seen) {
    if (mark !== 1) return null;
  }

  return (lat, lon) => {
    const latClamped = clamp(lat, lats[0], lats[lats.length - 1]);
    const lonClamped = clamp(lon, lons[0], lons[lons.length - 1]);
    const y0 = binarySearchFloor(lats, latClamped);
    const x0 = binarySearchFloor(lons, lonClamped);
    const y1 = Math.min(y0 + 1, lats.length - 1);
    const x1 = Math.min(x0 + 1, lons.length - 1);

    const lat0 = lats[y0];
    const lat1 = lats[y1];
    const lon0 = lons[x0];
    const lon1 = lons[x1];
    const ty = lat1 === lat0 ? 0 : (latClamped - lat0) / (lat1 - lat0);
    const tx = lon1 === lon0 ? 0 : (lonClamped - lon0) / (lon1 - lon0);

    const q00 = values[y0 * lons.length + x0];
    const q10 = values[y0 * lons.length + x1];
    const q01 = values[y1 * lons.length + x0];
    const q11 = values[y1 * lons.length + x1];
    const a = q00 + (q10 - q00) * tx;
    const b = q01 + (q11 - q01) * tx;
    return a + (b - a) * ty;
  };
};

const computeOverlayDimensions = (bounds: TerrainBounds, resolutionScale = 1): { width: number; height: number } => {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latSpanKm = Math.max(0.5, Math.abs(bounds.maxLat - bounds.minLat) * 111.32);
  const lonSpanKm =
    Math.max(0.5, Math.abs(bounds.maxLon - bounds.minLon) * 111.32 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)));
  const aspect = lonSpanKm / latSpanKm;
  const shortSidePx = 320;
  const maxSidePx = 540;
  let width = shortSidePx;
  let height = shortSidePx;
  if (aspect >= 1) {
    width = Math.round(shortSidePx * Math.min(2.6, aspect));
  } else {
    height = Math.round(shortSidePx * Math.min(2.6, 1 / Math.max(0.01, aspect)));
  }
  const scaledWidth = Math.round(width * resolutionScale);
  const scaledHeight = Math.round(height * resolutionScale);
  return {
    width: clamp(scaledWidth, 200, maxSidePx),
    height: clamp(scaledHeight, 200, maxSidePx),
  };
};

const computeSourceCentricRxDbm = (
  lat: number,
  lon: number,
  fromSite: Site,
  effectiveLink: Link,
  receiverAntennaHeightM: number,
  receiverRxGainDbi: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
  propagationEnvironment: PropagationEnvironment,
): number =>
  computeSourceCentricRxMetrics(
    lat,
    lon,
    fromSite,
    effectiveLink,
    receiverAntennaHeightM,
    receiverRxGainDbi,
    terrainSampler,
    terrainSamples,
    propagationEnvironment,
  ).rxDbm;

const buildCoverageOverlay = (
  bounds: TerrainBounds,
  samples: CoverageSampleLite[],
  mode: "heatmap" | "contours",
  bandStepDb: number,
  dimensions: { width: number; height: number },
  pointMask?: (lat: number, lon: number) => boolean,
  terrainSampler?: (lat: number, lon: number) => number | null,
): OverlayRaster | null => {
  if (!samples.length) return null;
  const gridInterpolator = makeGridInterpolator(samples);
  const width = dimensions.width;
  const height = dimensions.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const tY = y / Math.max(1, height - 1);
    const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
    for (let x = 0; x < width; x += 1) {
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      if (pointMask && !pointMask(lat, lon)) continue;
      if (terrainSampler && terrainSampler(lat, lon) === null) continue;
      const valueDbm = gridInterpolator
        ? gridInterpolator(lat, lon)
        : interpolateCoverageDbm(samples, lat, lon);
      if (valueDbm === null) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 180;
      if (mode === "heatmap") {
        [r, g, b] = coverageColorAdaptive(valueDbm, samples);
      } else if (mode === "contours") {
        const banded = Math.round(valueDbm / Math.max(1, bandStepDb)) * Math.max(1, bandStepDb);
        [r, g, b] = coverageColorAdaptive(banded, samples);
        a = 170;
      }
      const px = (y * width + x) * 4;
      image.data[px] = r;
      image.data[px + 1] = g;
      image.data[px + 2] = b;
      image.data[px + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    coordinates: [
      [bounds.minLon, bounds.maxLat],
      [bounds.maxLon, bounds.maxLat],
      [bounds.maxLon, bounds.minLat],
      [bounds.minLon, bounds.minLat],
    ],
  };
};

const buildSourcePassFailOverlay = (
  bounds: TerrainBounds,
  fromSite: Site,
  effectiveLink: Link,
  receiverAntennaHeightM: number,
  receiverRxGainDbi: number,
  propagationEnvironment: PropagationEnvironment,
  rxTargetDbm: number,
  environmentLossDb: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  terrainSamples: number,
  pointMask?: (lat: number, lon: number) => boolean,
): OverlayRaster | null => {
  const width = dimensions.width;
  const height = dimensions.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const tY = y / Math.max(1, height - 1);
    const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
    for (let x = 0; x < width; x += 1) {
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      if (pointMask && !pointMask(lat, lon)) {
        continue;
      }
      if (terrainSampler(lat, lon) === null) {
        continue;
      }
      const metrics = computeSourceCentricRxMetrics(
        lat,
        lon,
        fromSite,
        effectiveLink,
        receiverAntennaHeightM,
        receiverRxGainDbi,
        terrainSampler,
        terrainSamples,
        propagationEnvironment,
      );
      const pass = metrics.rxDbm - environmentLossDb >= rxTargetDbm;
      const losBlocked = metrics.terrainObstructed;
      const state = classifyPassFailState(pass, losBlocked);
      const px = (y * width + x) * 4;
      if (state === "pass_clear") {
        image.data[px] = 82;
        image.data[px + 1] = 181;
        image.data[px + 2] = 96;
      } else if (state === "pass_blocked") {
        image.data[px] = 232;
        image.data[px + 1] = 170;
        image.data[px + 2] = 72;
      } else if (state === "fail_clear") {
        image.data[px] = 235;
        image.data[px + 1] = 120;
        image.data[px + 2] = 70;
      } else {
        image.data[px] = 205;
        image.data[px + 1] = 87;
        image.data[px + 2] = 79;
      }
      image.data[px + 3] = 162;
    }
  }

  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    coordinates: [
      [bounds.minLon, bounds.maxLat],
      [bounds.maxLon, bounds.maxLat],
      [bounds.maxLon, bounds.minLat],
      [bounds.minLon, bounds.minLat],
    ],
  };
};

const buildRelayCandidateOverlay = (
  bounds: TerrainBounds,
  fromSite: Site,
  toSite: Site,
  effectiveLink: Link,
  propagationEnvironment: PropagationEnvironment,
  environmentLossDb: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  terrainSamples: number,
  pointMask?: (lat: number, lon: number) => boolean,
): (OverlayRaster & { minDbm: number; maxDbm: number }) | null => {
  const width = dimensions.width;
  const height = dimensions.height;
  const relayAntennaHeightM = Math.max(2, (fromSite.antennaHeightM + toSite.antennaHeightM) / 2);
  const fallbackRelayGround = (fromSite.groundElevationM + toSite.groundElevationM) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  const bottleneck = new Float32Array(width * height).fill(-Infinity);
  let minDbm = Number.POSITIVE_INFINITY;
  let maxDbm = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    const tY = y / Math.max(1, height - 1);
    const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
    for (let x = 0; x < width; x += 1) {
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      if (pointMask && !pointMask(lat, lon)) {
        continue;
      }

      const sampledGround = terrainSampler(lat, lon);
      if (sampledGround === null) {
        continue;
      }
      const relayGround = sampledGround ?? fallbackRelayGround;
      const relaySite: Site = {
        id: "__relay_candidate__",
        name: "Relay candidate",
        position: { lat, lon },
        antennaHeightM: relayAntennaHeightM,
        groundElevationM: relayGround,
        txPowerDbm: STANDARD_SITE_RADIO.txPowerDbm,
        txGainDbi: STANDARD_SITE_RADIO.txGainDbi,
        rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
        cableLossDb: STANDARD_SITE_RADIO.cableLossDb,
      };
      const fromToRelayRx = computeSourceCentricRxDbm(
        lat,
        lon,
        fromSite,
        effectiveLink,
        relayAntennaHeightM,
        relaySite.rxGainDbi,
        terrainSampler,
        terrainSamples,
        propagationEnvironment,
      );
      const relayToTargetRx = computeSourceCentricRxDbm(
        toSite.position.lat,
        toSite.position.lon,
        relaySite,
        effectiveLink,
        toSite.antennaHeightM,
        toSite.rxGainDbi,
        terrainSampler,
        terrainSamples,
        propagationEnvironment,
      );
      const bottleneckDbm = Math.min(fromToRelayRx, relayToTargetRx) - environmentLossDb;
      const i = y * width + x;
      bottleneck[i] = bottleneckDbm;
      minDbm = Math.min(minDbm, bottleneckDbm);
      maxDbm = Math.max(maxDbm, bottleneckDbm);
    }
  }
  if (!Number.isFinite(minDbm) || !Number.isFinite(maxDbm)) return null;
  const dynamicRange = Math.max(6, maxDbm - minDbm);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!Number.isFinite(bottleneck[i])) continue;
      const px = i * 4;
      const normalized = -125 + ((bottleneck[i] - minDbm) / dynamicRange) * 63;
      const [r, g, b] = coverageColorForDbm(clamp(normalized, -125, -62));
      image.data[px] = r;
      image.data[px + 1] = g;
      image.data[px + 2] = b;
      image.data[px + 3] = 172;
    }
  }

  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    coordinates: [
      [bounds.minLon, bounds.maxLat],
      [bounds.maxLon, bounds.maxLat],
      [bounds.maxLon, bounds.minLat],
      [bounds.minLon, bounds.minLat],
    ],
    minDbm,
    maxDbm,
  };
};

const buildTerrainShadeOverlay = (
  bounds: TerrainBounds,
  sampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  pointMask?: (lat: number, lon: number) => boolean,
): OverlayRaster | null => {
  const width = dimensions.width;
  const height = dimensions.height;
  const elevations = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  const allowed = new Uint8Array(width * height);

  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    const tY = y / Math.max(1, height - 1);
    const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
    for (let x = 0; x < width; x += 1) {
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      const isAllowed = pointMask ? pointMask(lat, lon) : true;
      const elevation = sampler(lat, lon);
      const i = y * width + x;
      if (isAllowed) {
        allowed[i] = 1;
      }
      if (!isAllowed) continue;
      if (elevation === null) continue;
      elevations[i] = elevation;
      valid[i] = 1;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    }
  }

  if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) return null;

  for (let pass = 0; pass < 3; pass += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (!allowed[i]) continue;
        if (valid[i]) continue;
        const neighbors = [i - 1, i + 1, i - width, i + width];
        let sum = 0;
        let count = 0;
        for (const n of neighbors) {
          if (!allowed[n]) continue;
          if (!valid[n]) continue;
          sum += elevations[n];
          count += 1;
        }
        if (!count) continue;
        elevations[i] = sum / count;
        valid[i] = 1;
      }
    }
  }

  const lightAzimuthRad = (315 * Math.PI) / 180;
  const lightAltitudeRad = (45 * Math.PI) / 180;
  const lx = Math.cos(lightAltitudeRad) * Math.sin(lightAzimuthRad);
  const ly = Math.cos(lightAltitudeRad) * Math.cos(lightAzimuthRad);
  const lz = Math.sin(lightAltitudeRad);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const metersPerLon =
    ((bounds.maxLon - bounds.minLon) * 111_320 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180))) /
    Math.max(1, width - 1);
  const metersPerLat = ((bounds.maxLat - bounds.minLat) * 111_320) / Math.max(1, height - 1);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  const range = Math.max(1, maxElevation - minElevation);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const px = i * 4;
      if (!allowed[i]) {
        image.data[px + 3] = 0;
        continue;
      }
      if (!valid[i]) {
        image.data[px + 3] = 0;
        continue;
      }

      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      const left = elevations[y * width + x0];
      const right = elevations[y * width + x1];
      const top = elevations[y0 * width + x];
      const bottom = elevations[y1 * width + x];

      const dzdx = (right - left) / Math.max(1, (x1 - x0) * metersPerLon);
      const dzdy = (bottom - top) / Math.max(1, (y1 - y0) * metersPerLat);

      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1;
      const norm = Math.hypot(nx, ny, nz) || 1;
      const shade = Math.max(0, (nx * lx + ny * ly + nz * lz) / norm);

      const elevationNorm = (elevations[i] - minElevation) / range;
      const base = 58 + elevationNorm * 112;
      const lit = clamp(base * 0.65 + shade * 145, 0, 255);

      image.data[px] = lit * 0.95;
      image.data[px + 1] = lit;
      image.data[px + 2] = lit * 1.04;
      image.data[px + 3] = 210;
    }
  }

  ctx.putImageData(image, 0, 0);

  return {
    url: canvas.toDataURL("image/png"),
    coordinates: [
      [bounds.minLon, bounds.maxLat],
      [bounds.maxLon, bounds.maxLat],
      [bounds.maxLon, bounds.minLat],
      [bounds.minLon, bounds.minLat],
    ],
  };
};

/** ~20 km geographic margin added around sites before fitting. */
const FIT_PAD_DEG = 0.18;
/**
 * Pixel insets reserved for UI chrome inside the map container.
 * Right accounts for the map controls pill; others are minimal breathing room.
 */
const FIT_CHROME_PADDING = { top: 30, right: 70, bottom: 30, left: 20 } as const;

/**
 * Compute the LngLatBounds to pass to maplibre fitBounds for a set of sites,
 * expanding by ~20 km in all directions.
 */
const computeSiteFitBounds = (
  sites: { position: { lat: number; lon: number } }[],
): [[number, number], [number, number]] | null => {
  if (!sites.length) return null;
  const lats = sites.map((s) => s.position.lat);
  const lons = sites.map((s) => s.position.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  // Scale lon padding by 1/cos(lat) so the geographic margin is uniform in km.
  const lonPad = FIT_PAD_DEG / Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  return [
    [Math.min(...lons) - lonPad, Math.min(...lats) - FIT_PAD_DEG],
    [Math.max(...lons) + lonPad, Math.max(...lats) + FIT_PAD_DEG],
  ];
};

type MapViewProps = {
  isMapExpanded: boolean;
  showInspector?: boolean;
  showMultiSelectToggle?: boolean;
  readOnly?: boolean;
  canPersist?: boolean;
  onToggleMapExpanded: () => void;
  // Legacy prop name retained for stability; this renders in the RightSidePanel shell.
  inspectorHeaderActions?: ReactNode;
  notice?: {
    message: string;
    tone: "info" | "warning" | "error";
    onDismiss?: () => void;
  };
  /** Pixel inset for the bottom edge when computing fitBounds, to avoid UI chrome. */
  fitBottomInset?: number;
};

type MarkerActionButtonProps = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

function MarkerActionButton({
  ariaLabel,
  children,
  className,
  onActivate,
  onMouseEnter,
  onMouseLeave,
}: MarkerActionButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate(event);
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      type="button"
    >
      {children}
    </button>
  );
}

type PendingNewSiteDraft = {
  lat: number;
  lon: number;
};

type PendingSiteMove = {
  siteId: string;
  originalPosition: { lat: number; lon: number };
  originalGroundElevationM: number;
  currentPosition: { lat: number; lon: number };
  currentGroundElevationM: number;
};

type MapInspectorHoverInfo = {
  text: string;
  libraryEntryId?: string;
};

const DEFAULT_MAP_VIEWPORT = {
  center: { lat: 59.9, lon: 10.75 },
  zoom: 8,
};

export function MapView({
  isMapExpanded,
  showInspector = true,
  showMultiSelectToggle = false,
  readOnly = false,
  canPersist = true,
  onToggleMapExpanded,
  inspectorHeaderActions,
  notice,
  fitBottomInset = 30,
}: MapViewProps) {
  const sites = useAppStore((state) => state.sites);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const links = useAppStore((state) => state.links);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteIds = useAppStore((state) => state.selectedSiteIds);
  const temporaryDirectionReversed = useAppStore((state) => state.temporaryDirectionReversed);
  const endpointPickTarget = useAppStore((state) => state.endpointPickTarget);
  const profileCursorIndex = useAppStore((state) => state.profileCursorIndex);
  const getSelectedProfile = useAppStore((state) => state.getSelectedProfile);
  const mapViewport = useAppStore((state) => state.mapViewport);
  const viewport = mapViewport ?? DEFAULT_MAP_VIEWPORT;
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const selectSiteById = useAppStore((state) => state.selectSiteById);
  const clearActiveSelection = useAppStore((state) => state.clearActiveSelection);
  const createLink = useAppStore((state) => state.createLink);
  const updateLink = useAppStore((state) => state.updateLink);
  const updateSite = useAppStore((state) => state.updateSite);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const setSiteDragPreview = useAppStore((state) => state.setSiteDragPreview);
  const clearSiteDragPreview = useAppStore((state) => state.clearSiteDragPreview);
  const setEndpointPickTarget = useAppStore((state) => state.setEndpointPickTarget);
  const requestSiteLibraryDraftAt = useAppStore((state) => state.requestSiteLibraryDraftAt);
  const requestOpenSiteLibraryEntry = useAppStore((state) => state.requestOpenSiteLibraryEntry);
  const coverageSamples = useCoverageStore((state) => state.coverageSamples);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const terrainFetchStatus = useAppStore((state) => state.terrainFetchStatus);
  const terrainLoadingStartedAtMs = useAppStore((state) => state.terrainLoadingStartedAtMs);
  const terrainProgressPercent = useAppStore((state) => state.terrainProgressPercent);
  const terrainProgressTilesLoaded = useAppStore((state) => state.terrainProgressTilesLoaded);
  const terrainProgressTilesTotal = useAppStore((state) => state.terrainProgressTilesTotal);
  const terrainProgressBytesLoaded = useAppStore((state) => state.terrainProgressBytesLoaded);
  const terrainProgressBytesEstimated = useAppStore((state) => state.terrainProgressBytesEstimated);
  const propagationModel = useAppStore((state) => state.propagationModel);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const networks = useAppStore((state) => state.networks);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const isSimulationRecomputing = useCoverageStore((state) => state.isSimulationRecomputing);
  const simulationProgress = useCoverageStore((state) => state.simulationProgress);
  const isTerrainFetching = useAppStore((state) => state.isTerrainFetching);
  const isTerrainRecommending = useAppStore((state) => state.isTerrainRecommending);
  const basemapProvider = useAppStore((state) => state.basemapProvider);
  const basemapStylePreset = useAppStore((state) => state.basemapStylePreset);
  const setBasemapProvider = useAppStore((state) => state.setBasemapProvider);
  const setBasemapStylePreset = useAppStore((state) => state.setBasemapStylePreset);
  const {
    theme,
    colorTheme,
    variant,
    activeHolidayTheme,
    showHolidayThemeNotice,
    isHolidayThemeForced,
    dismissHolidayThemeNotice,
    revertHolidayThemeForWindow,
  } = useThemeVariant();
  const linkColor = variant.map.linkColor;
  const selectedLinkColor = variant.map.selectedLinkColor;
  const profileColor = variant.map.profileLineColor;
  const selectedProfile = useMemo(
    () => getSelectedProfile(),
    [
      getSelectedProfile,
      links,
      sites,
      srtmTiles,
      selectedLinkId,
      selectedSiteIds,
      selectedNetworkId,
      networks,
      propagationModel,
      temporaryDirectionReversed,
    ],
  );
  const coverageVizMode = useAppStore((state) => state.mapOverlayMode);
  const setCoverageVizMode = useAppStore((state) => state.setMapOverlayMode);
  const selectedCoverageResolution = useAppStore((state) => state.selectedCoverageResolution);
  const setSelectedCoverageResolution = useAppStore((state) => state.setSelectedCoverageResolution);
  const [bandStepMode, setBandStepMode] = useState<BandStepMode>("auto");
  const [showTerrainOverlay, setShowTerrainOverlay] = useState(false);
  const [showResultsSummary, setShowResultsSummary] = useState(() => readSectionBool(UI_SECTION_KEYS.mapViewResults, true));
  const [showSimulationSummary, setShowSimulationSummary] = useState(() => readSectionBool(UI_SECTION_KEYS.mapViewSimSummary, false));
  const [showOverlayGuide, setShowOverlayGuide] = useState(() => readSectionBool(UI_SECTION_KEYS.mapViewOverlayGuide, true));
  const fitSitesEpoch = useAppStore((state) => state.fitSitesEpoch);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [endpointPickError, setEndpointPickError] = useState<string | null>(null);
  const [pendingNewSiteDraft, setPendingNewSiteDraft] = useState<PendingNewSiteDraft | null>(null);
  const [armAddSiteOnNextEmptyMapClick, setArmAddSiteOnNextEmptyMapClick] = useState(false);
  const [pendingSiteMoves, setPendingSiteMoves] = useState<Record<string, PendingSiteMove>>({});
  const [isDraggingSite, setIsDraggingSite] = useState(false);
  const [siteDraftStatus, setSiteDraftStatus] = useState<string | null>(null);
  const [showDiscoverySites, setShowDiscoverySites] = useState(false);
  const [showDiscoveryMqtt, setShowDiscoveryMqtt] = useState(false);
  const [mqttNodes, setMqttNodes] = useState<MeshmapNode[]>([]);
  const [mqttLoadStatus, setMqttLoadStatus] = useState<string | null>(null);
  const [overlayHoverInfo, setOverlayHoverInfo] = useState<MapInspectorHoverInfo | null>(null);
  const [selectedDiscoveryLibraryEntryId, setSelectedDiscoveryLibraryEntryId] = useState<string | null>(null);
  const [mqttDuplicatePrompt, setMqttDuplicatePrompt] = useState<{
    node: MeshmapNode;
    existingId: string;
    existingName: string;
  } | null>(null);
  const [useFallbackMapStyle, setUseFallbackMapStyle] = useState(false);
  const [mapProviderWarning, setMapProviderWarning] = useState<string | null>(null);
  const [interactionViewState, setInteractionViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
  } | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  useEffect(() => {
    const handleViewportChange = () => {
      mapRef.current?.resize();
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
    };
  }, []);

  // When a scenario or simulation loads (fitSitesEpoch increments), fit the map to
  // all sites with a ~20 km geographic margin and insets for UI chrome.
  useEffect(() => {
    if (!fitSitesEpoch || !isMapLoaded || !mapRef.current) return;
    const bounds = computeSiteFitBounds(sites);
    if (!bounds) return;
    mapRef.current.fitBounds(bounds, {
      padding: { ...FIT_CHROME_PADDING, bottom: fitBottomInset },
      animate: false,
      maxZoom: 14,
    });
    setInteractionViewState(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSitesEpoch, isMapLoaded, fitBottomInset]);

  const hasNonAutoLinks = useMemo(
    () => links.some((link) => (link.name ?? "").trim().toLowerCase() !== "auto link"),
    [links],
  );
  const visibleLinks = useMemo(
    () => (hasNonAutoLinks ? links.filter((link) => (link.name ?? "").trim().toLowerCase() !== "auto link") : links),
    [hasNonAutoLinks, links],
  );
  const hasSimulationTerrain = srtmTiles.length > 0;
  const selectedNetwork = networks.find((network) => network.id === selectedNetworkId);
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null;
  const selectedFromSiteId = selectedLink
    ? temporaryDirectionReversed
      ? selectedLink.toSiteId
      : selectedLink.fromSiteId
    : null;
  const selectedToSiteId = selectedLink
    ? temporaryDirectionReversed
      ? selectedLink.fromSiteId
      : selectedLink.toSiteId
    : null;
  const selectedSites = useMemo(
    () => selectedSiteIds.map((id) => sites.find((site) => site.id === id)).filter((site): site is Site => Boolean(site)),
    [selectedSiteIds, sites],
  );
  const selectedSiteSet = useMemo(() => new Set(selectedSites.map((site) => site.id)), [selectedSites]);
  const selectionCount = selectedSites.length;
  const selectedFromSite = selectedSites[0] ?? (selectedFromSiteId ? sites.find((site) => site.id === selectedFromSiteId) ?? null : null);
  const selectedToSite =
    selectedSites.length >= 2
      ? selectedSites[selectedSites.length - 1]
      : selectedToSiteId
        ? sites.find((site) => site.id === selectedToSiteId) ?? null
        : null;
  const activeSelectionLink = useMemo<Link | null>(() => {
    if (!selectedFromSite) return null;
    const toSite = selectedToSite ?? selectedFromSite;
    return {
      id: "__selection__",
      name: `${selectedFromSite.name} -> ${toSite.name}`,
      fromSiteId: selectedFromSite.id,
      toSiteId: toSite.id,
      frequencyMHz: selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? selectedLink?.frequencyMHz ?? 869.618,
      txPowerDbm: selectedFromSite.txPowerDbm,
      txGainDbi: selectedFromSite.txGainDbi,
      rxGainDbi: toSite.rxGainDbi,
      cableLossDb: selectedFromSite.cableLossDb,
    };
  }, [selectedFromSite, selectedToSite, selectedNetwork, selectedLink]);
  const hasHeatTopology = sites.length >= 1;
  const simulationLibrarySiteIds = useMemo(
    () =>
      new Set(
        sites
          .map((site) => site.libraryEntryId)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    [sites],
  );
  const sharedOrPublicLibrarySites = useMemo(
    () =>
      siteLibrary.filter(
        (entry) =>
          (entry.visibility === "shared" || entry.visibility === "public") &&
          !simulationLibrarySiteIds.has(entry.id),
      ),
    [siteLibrary, simulationLibrarySiteIds],
  );

  useEffect(() => {
    if (!showDiscoveryMqtt) return;
    if (mqttNodes.length) return;
    let canceled = false;
    setMqttLoadStatus("Loading MQTT nodes...");
    void fetchMeshmapNodes({ cacheTtlMs: 30 * 60 * 1000 })
      .then((result) => {
        if (canceled) return;
        setMqttNodes(result.nodes);
        if (result.fromCache && result.networkError) {
          const ageMin = Math.max(1, Math.round((result.cacheAgeMs ?? 0) / 60_000));
          setMqttLoadStatus(`Live fetch failed — showing ${result.nodes.length} cached node(s) from ${ageMin} min ago.`);
        } else {
          setMqttLoadStatus(null);
        }
      })
      .catch((error) => {
        if (canceled) return;
        setMqttLoadStatus(`MQTT load failed: ${getUiErrorMessage(error)}`);
      });
    return () => {
      canceled = true;
    };
  }, [showDiscoveryMqtt, mqttNodes.length]);
  const hasPassFailTopology = selectionCount >= 1;
  const hasRelayTopology = selectionCount >= 2;
  const hasMinimumTopology = sites.length >= 1;
  const analysisTargetSites = sites;
  const overlayMaskArea = useMemo(() => buildBufferedSelectionArea(analysisTargetSites, 20), [analysisTargetSites]);
  const overlayPointMask = overlayMaskArea?.contains;
  const analysisBounds = useMemo(() => {
    if (overlayMaskArea) return overlayMaskArea.bounds;
    if (!analysisTargetSites.length) return null;
    return computeTerrainBounds(analysisTargetSites);
  }, [analysisTargetSites, overlayMaskArea]);
  const analysisBoundsDiagonalKm = useMemo(
    () => (analysisBounds ? boundsDiagonalKm(analysisBounds) : 0),
    [analysisBounds],
  );
  const terrainSourceSummary = useMemo<Array<{ label: string; count: number }>>(() => {
    const breakdown = new globalThis.Map<string, { label: string; count: number }>();
    for (const tile of srtmTiles) {
      const key = tile.sourceId ?? "unknown";
      const label = tile.sourceLabel ?? "Unknown source";
      breakdown.set(key, { label, count: (breakdown.get(key)?.count ?? 0) + 1 });
    }
    return Array.from(breakdown.values()).sort((a, b) => b.count - a.count);
  }, [srtmTiles]);
  const selectedDatasetTileCount = useMemo(
    () => srtmTiles.filter((tile) => (tile.sourceId ?? "") === terrainDataset).length,
    [srtmTiles, terrainDataset],
  );
  const boundedCoverageSamples = useMemo(() => {
    if (!analysisBounds) return coverageSamples;
    return coverageSamples.filter(
      (sample) =>
        sample.lat >= analysisBounds.minLat &&
        sample.lat <= analysisBounds.maxLat &&
        sample.lon >= analysisBounds.minLon &&
        sample.lon <= analysisBounds.maxLon,
    );
  }, [coverageSamples, analysisBounds]);
  const samplesForOverlay = useMemo(
    () => (boundedCoverageSamples.length >= 6 ? boundedCoverageSamples : coverageSamples),
    [boundedCoverageSamples, coverageSamples],
  );

  const lineFeatures = useMemo(
    () => {
      const showSelectionHighlights = !armAddSiteOnNextEmptyMapClick;
      const savedLinkFeatures = visibleLinks
        .map((link) => {
          const from = sites.find((site) => site.id === link.fromSiteId);
          const to = sites.find((site) => site.id === link.toSiteId);
          if (!from || !to) return null;
          return {
            type: "Feature" as const,
            properties: { id: link.id, selected: showSelectionHighlights && link.id === selectedLinkId ? 1 : 0, temporary: 0 },
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [from.position.lon, from.position.lat],
                [to.position.lon, to.position.lat],
              ],
            },
          };
        })
        .filter((feature): feature is NonNullable<typeof feature> => feature !== null);
      const fromSite = selectedSites[0] ?? null;
      const toSite = selectedSites.length >= 2 ? selectedSites[selectedSites.length - 1] : null;
      const hasSavedLinkForSelection = Boolean(
        fromSite &&
          toSite &&
          links.some(
            (link) =>
              (link.fromSiteId === fromSite.id && link.toSiteId === toSite.id) ||
              (link.fromSiteId === toSite.id && link.toSiteId === fromSite.id),
          ),
      );
      const temporarySelectionFeature =
        showSelectionHighlights && fromSite && toSite && !hasSavedLinkForSelection
          ? [
              {
                type: "Feature" as const,
                properties: { id: "__selection__", selected: 0, temporary: 1 },
                geometry: {
                  type: "LineString" as const,
                  coordinates: [
                    [fromSite.position.lon, fromSite.position.lat],
                    [toSite.position.lon, toSite.position.lat],
                  ],
                },
              },
            ]
          : [];
      return {
        type: "FeatureCollection" as const,
        features: [...savedLinkFeatures, ...temporarySelectionFeature],
      };
    },
    [visibleLinks, selectedLinkId, sites, selectedSites, links, armAddSiteOnNextEmptyMapClick],
  );

  const profileFeatures = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        selectionCount === 2 && selectedProfile.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: { id: "selected-profile" },
                geometry: {
                  type: "LineString" as const,
                  coordinates: selectedProfile.map((point) => [point.lon, point.lat]),
                },
              },
            ]
          : [],
    }),
    [selectedProfile, selectionCount],
  );

  const cursorPoint =
    selectionCount === 2
      ? selectedProfile[Math.max(0, Math.min(selectedProfile.length - 1, profileCursorIndex))]
      : undefined;

  const overlayResolutionScale = useMemo(() => {
    if (analysisBoundsDiagonalKm > 600) return 0.52;
    if (analysisBoundsDiagonalKm > 400) return 0.64;
    if (analysisBoundsDiagonalKm > 250) return 0.76;
    return 1;
  }, [analysisBoundsDiagonalKm]);
  const largeAreaOptimizationActive = overlayResolutionScale < 1;

  const overlayDimensions = useMemo(() => {
    const bounds = analysisBounds ?? computeCoverageBounds(samplesForOverlay);
    if (!bounds) return { width: 320, height: 320 };
    return computeOverlayDimensions(bounds, overlayResolutionScale);
  }, [analysisBounds, samplesForOverlay, overlayResolutionScale]);

  const overlayBounds = useMemo(() => analysisBounds ?? computeCoverageBounds(samplesForOverlay), [analysisBounds, samplesForOverlay]);
  const effectiveBandStepDb = useMemo(() => {
    if (!overlayBounds) return 5;
    return bandStepMode === "auto" ? autoBandStepDb(samplesForOverlay, overlayBounds) : bandStepMode;
  }, [overlayBounds, samplesForOverlay, bandStepMode]);
  const baseOverlayMode = coverageVizMode === "contours" ? "contours" : coverageVizMode === "heatmap" ? "heatmap" : null;
  const baseCoverageOverlay = useMemo<(OverlayRaster & { minDbm?: number; maxDbm?: number }) | null>(() => {
    if (!overlayBounds || !baseOverlayMode) return null;
    return buildCoverageOverlay(
      overlayBounds,
      samplesForOverlay,
      baseOverlayMode,
      effectiveBandStepDb,
      overlayDimensions,
      overlayPointMask,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
    );
  }, [overlayBounds, samplesForOverlay, baseOverlayMode, effectiveBandStepDb, overlayDimensions, overlayPointMask, srtmTiles]);
  // During a site drag, force low-res (24) to keep overlay recomputations cheap.
  // On mouse release (isDraggingSite → false) the configured resolution is restored.
  const effectiveGridSize = isDraggingSite || selectedCoverageResolution !== "high" ? 24 : 42;
  const passFailCoverageOverlay = useMemo<(OverlayRaster & { minDbm?: number; maxDbm?: number }) | null>(() => {
    if (coverageVizMode !== "passfail") return null;
    if (!overlayBounds || !activeSelectionLink || !selectedFromSite || !hasPassFailTopology) return null;
    const receiverAntennaHeightM = selectedToSite?.antennaHeightM ?? selectedFromSite.antennaHeightM ?? 2;
    const receiverRxGainDbi = selectedToSite?.rxGainDbi ?? selectedFromSite.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi;
    return buildSourcePassFailOverlay(
      overlayBounds,
      selectedFromSite,
      activeSelectionLink,
      receiverAntennaHeightM,
      receiverRxGainDbi,
      propagationEnvironment,
      rxSensitivityTargetDbm,
      environmentLossDb,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      overlayDimensions,
      effectiveGridSize,
      overlayPointMask,
    );
  }, [
    coverageVizMode,
    overlayBounds,
    activeSelectionLink,
    selectedFromSite,
    selectedToSite,
    hasPassFailTopology,
    propagationEnvironment,
    rxSensitivityTargetDbm,
    environmentLossDb,
    srtmTiles,
    overlayDimensions,
    overlayPointMask,
    effectiveGridSize,
  ]);
  const relayCoverageOverlay = useMemo<(OverlayRaster & { minDbm?: number; maxDbm?: number }) | null>(() => {
    if (coverageVizMode !== "relay") return null;
    if (!overlayBounds || !activeSelectionLink || !selectedFromSite || !selectedToSite || !hasRelayTopology) return null;
    return buildRelayCandidateOverlay(
      overlayBounds,
      selectedFromSite,
      selectedToSite,
      activeSelectionLink,
      propagationEnvironment,
      environmentLossDb,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      overlayDimensions,
      effectiveGridSize,
      overlayPointMask,
    );
  }, [
    coverageVizMode,
    overlayBounds,
    activeSelectionLink,
    selectedFromSite,
    selectedToSite,
    hasRelayTopology,
    propagationEnvironment,
    environmentLossDb,
    srtmTiles,
    overlayDimensions,
    overlayPointMask,
    effectiveGridSize,
  ]);
  const coverageOverlay = useMemo<(OverlayRaster & { minDbm?: number; maxDbm?: number }) | null>(() => {
    if (coverageVizMode === "none") return null;
    if (coverageVizMode === "relay") return relayCoverageOverlay;
    if (coverageVizMode === "passfail") return passFailCoverageOverlay;
    return baseCoverageOverlay;
  }, [coverageVizMode, relayCoverageOverlay, passFailCoverageOverlay, baseCoverageOverlay]);
  const currentBandStepDb = effectiveBandStepDb;

  const signalRange = useMemo(() => {
    if (!samplesForOverlay.length) return { min: -125, max: -62 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const sample of samplesForOverlay) {
      min = Math.min(min, sample.valueDbm);
      max = Math.max(max, sample.valueDbm);
    }
    return { min, max };
  }, [samplesForOverlay]);

  const relayRange = useMemo(() => {
    if (!coverageOverlay || coverageVizMode !== "relay") return null;
    if (typeof coverageOverlay.minDbm !== "number" || typeof coverageOverlay.maxDbm !== "number") return null;
    return { min: coverageOverlay.minDbm, max: coverageOverlay.maxDbm };
  }, [coverageOverlay, coverageVizMode]);
  const overlayGuideTitle =
    coverageVizMode === "none"
      ? "Hidden"
      : coverageVizMode === "heatmap"
      ? "Heatmap"
      : coverageVizMode === "contours"
        ? "Bands"
        : coverageVizMode === "passfail"
          ? "Pass/Fail"
          : "Relay";

  const simulationTerrainOverlay = useMemo(() => {
    if (!hasSimulationTerrain || !analysisBounds) return null;
    const bounds = analysisBounds;
    return buildTerrainShadeOverlay(
      bounds,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      overlayDimensions,
      overlayPointMask,
    );
  }, [hasSimulationTerrain, analysisBounds, srtmTiles, overlayDimensions, overlayPointMask]);

  const webglAvailable = useMemo(() => supportsWebgl(), []);
  const isBackgroundBusy = isTerrainFetching || isTerrainRecommending;
  const [elapsedTerrainLoadingMs, setElapsedTerrainLoadingMs] = useState(0);
  useEffect(() => {
    if (!isTerrainFetching || terrainLoadingStartedAtMs === 0) {
      setElapsedTerrainLoadingMs(0);
      return;
    }
    const update = () => setElapsedTerrainLoadingMs(Date.now() - terrainLoadingStartedAtMs);
    update();
    const id = setInterval(update, 5_000);
    return () => clearInterval(id);
  }, [isTerrainFetching, terrainLoadingStartedAtMs]);
  const keepWorkingSuffix =
    elapsedTerrainLoadingMs > 60_000 ? " — loading will continue in the background, even if you leave the app" : "";
  const hasTerrainDownloadProgress =
    terrainProgressTilesLoaded > 0 || terrainProgressBytesLoaded > 0 || terrainProgressBytesEstimated > 0;
  const formatMb = (bytes: number) => `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;
  const terrainProgressLabel =
    isTerrainFetching && hasTerrainDownloadProgress && terrainProgressTilesTotal > 0
      ? `Loading terrain ${terrainProgressPercent}% — ${formatMb(terrainProgressBytesLoaded)} of ~${formatMb(
          terrainProgressBytesEstimated || terrainProgressBytesLoaded,
        )} (${terrainProgressTilesLoaded}/${terrainProgressTilesTotal} tiles)`
      : null;
  const terrainPreparingLabel =
    isTerrainFetching && !hasTerrainDownloadProgress
      ? terrainProgressTilesTotal > 0
        ? `Preparing terrain download... (${terrainProgressTilesLoaded}/${terrainProgressTilesTotal} tiles queued)`
        : "Preparing terrain download..."
      : null;
  const backgroundBusyLabel = (isTerrainFetching
    ? terrainProgressLabel || terrainPreparingLabel || terrainFetchStatus || "Loading terrain data..."
    : isTerrainRecommending
      ? terrainFetchStatus || "Checking terrain dataset coverage..."
      : "") + keepWorkingSuffix;
  const activeViewState = interactionViewState ?? {
    longitude: viewport.center.lon,
    latitude: viewport.center.lat,
    zoom: viewport.zoom,
  };
  const mqttNodesInView = useMemo(() => {
    const lonSpan = Math.max(0.12, 360 / Math.pow(2, activeViewState.zoom) * 2.2);
    const latSpan = Math.max(0.12, 170 / Math.pow(2, activeViewState.zoom) * 1.8);
    const minLon = activeViewState.longitude - lonSpan / 2;
    const maxLon = activeViewState.longitude + lonSpan / 2;
    const minLat = activeViewState.latitude - latSpan / 2;
    const maxLat = activeViewState.latitude + latSpan / 2;
    return mqttNodes.filter(
      (node) => node.lon >= minLon && node.lon <= maxLon && node.lat >= minLat && node.lat <= maxLat,
    );
  }, [mqttNodes, activeViewState.latitude, activeViewState.longitude, activeViewState.zoom]);
  const mqttInViewLimit = 1000;
  const mqttTooDenseInView = mqttNodesInView.length > mqttInViewLimit;

  const onMoveEnd = (event: ViewStateChangeEvent) => {
    setInteractionViewState(null);
    updateMapViewport({
      center: { lat: event.viewState.latitude, lon: event.viewState.longitude },
      zoom: event.viewState.zoom,
    });
  };

  const onSiteClick = (siteId: string, additive = false) => {
    setArmAddSiteOnNextEmptyMapClick(false);
    setSelectedDiscoveryLibraryEntryId(null);
    selectSiteById(siteId, additive);
    if (!endpointPickTarget || !selectedLink) return;
    setEndpointPickError(null);
    if (endpointPickTarget === "from" && siteId === selectedLink.toSiteId) {
      setEndpointPickError("From and To must be different sites.");
      return;
    }
    if (endpointPickTarget === "to" && siteId === selectedLink.fromSiteId) {
      setEndpointPickError("From and To must be different sites.");
      return;
    }
    updateLink(selectedLinkId, endpointPickTarget === "from" ? { fromSiteId: siteId } : { toSiteId: siteId });
    setEndpointPickError(null);
    setEndpointPickTarget(null);
  };

  const savePendingNewSiteDraft = async () => {
    if (!canPersist) {
      setSiteDraftStatus("Read-only mode: cannot save to library.");
      return;
    }
    if (!pendingNewSiteDraft) return;
    setSiteDraftStatus("Preparing site draft...");
    try {
      const suggestedName = await guessSiteNameForPosition(pendingNewSiteDraft.lat, pendingNewSiteDraft.lon);
      requestSiteLibraryDraftAt(pendingNewSiteDraft.lat, pendingNewSiteDraft.lon, suggestedName);
      setPendingNewSiteDraft(null);
      setSiteDraftStatus(null);
    } catch (error) {
      setSiteDraftStatus(`Unable to prepare the site draft: ${getUiErrorMessage(error)}`);
    }
  };

  const dismissPendingNewSiteDraft = () => {
    setPendingNewSiteDraft(null);
    setSiteDraftStatus(null);
  };

  const pendingMoveCount = Object.keys(pendingSiteMoves).length;
  const pendingMoveEntries = Object.values(pendingSiteMoves);
  const pendingMovePreview = pendingMoveEntries[0] ?? null;

  const savePendingSiteMove = () => {
    if (!pendingMoveCount) return;
    for (const move of pendingMoveEntries) {
      updateSite(move.siteId, {
        position: move.currentPosition,
        groundElevationM: move.currentGroundElevationM,
      });
    }
    setPendingSiteMoves({});
    clearSiteDragPreview();
    setSiteDraftStatus(null);
  };

  const dismissPendingSiteMove = () => {
    if (!pendingMoveCount) return;
    setPendingSiteMoves({});
    clearSiteDragPreview();
    setSiteDraftStatus(null);
  };

  const removeSelectedSiteFromSimulation = () => {
    if (!selectedSite || !canPersist || sites.length <= 1) return;
    const confirmed = window.confirm(`Remove ${selectedSite.name} from this simulation?`);
    if (!confirmed) return;
    deleteSite(selectedSite.id);
    setSiteDraftStatus(`${selectedSite.name} removed from the simulation.`);
  };

  const saveSelectedSitesAsLink = () => {
    if (!canPersist) return;
    const fromSite = selectedFromSite;
    const toSite = selectedToSite;
    if (!fromSite || !toSite || fromSite.id === toSite.id) return;
    createLink(fromSite.id, toSite.id);
    setSiteDraftStatus(`Saved link ${fromSite.name} -> ${toSite.name}.`);
  };

  const onSiteDrag = (siteId: string, event: MarkerDragEvent) => {
    if (pendingNewSiteDraft) {
      setSiteDraftStatus("Dismiss or save the new map site before moving existing sites.");
      return;
    }
    setIsDraggingSite(true);
    const site = sites.find((candidate) => candidate.id === siteId);
    if (!site) return;
    const nextPosition = {
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    };
    const terrainElevation = sampleSrtmElevation(srtmTiles, nextPosition.lat, nextPosition.lon);
    const nextGroundElevationM = Number.isFinite(terrainElevation)
      ? Math.round(terrainElevation as number)
      : site.groundElevationM;
    const existingPendingMove = pendingSiteMoves[siteId] ?? null;
    const originalPosition = existingPendingMove?.originalPosition ?? site.position;
    const originalGroundElevationM = existingPendingMove?.originalGroundElevationM ?? site.groundElevationM;
    setSiteDragPreview(siteId, {
      position: nextPosition,
      groundElevationM: nextGroundElevationM,
    });
    setPendingSiteMoves((current) => ({
      ...current,
      [siteId]: {
        siteId,
        originalPosition,
        originalGroundElevationM,
        currentPosition: nextPosition,
        currentGroundElevationM: nextGroundElevationM,
      },
    }));
    setSiteDraftStatus(null);
  };

  const onSiteDragEnd = (siteId: string, event: MarkerDragEvent) => {
    setIsDraggingSite(false);
    const site = sites.find((candidate) => candidate.id === siteId);
    if (!site) return;
    const nextPosition = {
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    };
    const terrainElevation = sampleSrtmElevation(srtmTiles, nextPosition.lat, nextPosition.lon);
    const nextGroundElevationM = Number.isFinite(terrainElevation)
      ? Math.round(terrainElevation as number)
      : site.groundElevationM;
    const existingPendingMove = pendingSiteMoves[siteId] ?? null;
    const originalPosition = existingPendingMove?.originalPosition ?? site.position;
    const originalGroundElevationM = existingPendingMove?.originalGroundElevationM ?? site.groundElevationM;
    setSiteDragPreview(siteId, {
      position: nextPosition,
      groundElevationM: nextGroundElevationM,
    });
    setPendingSiteMoves((current) => ({
      ...current,
      [siteId]: {
        siteId,
        originalPosition,
        originalGroundElevationM,
        currentPosition: nextPosition,
        currentGroundElevationM: nextGroundElevationM,
      },
    }));
  };

  const onPendingNewSiteDragEnd = (event: MarkerDragEvent) => {
    const nextPosition = {
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    };
    setPendingNewSiteDraft(nextPosition);
    setSiteDraftStatus(null);
  };

  const beginPendingNewSiteDraft = (lat: number, lon: number) => {
    if (endpointPickTarget) return;
    if (pendingMoveCount > 0) {
      setSiteDraftStatus("Save or dismiss the current site move before creating another new site.");
      return;
    }
    setPendingNewSiteDraft({ lat, lon });
    setSiteDraftStatus(null);
  };

  const onMapClick = (event: MapLayerMouseEvent) => {
    const rawTarget = event.originalEvent?.target;
    if (rawTarget instanceof Element && rawTarget.closest(".site-pin")) return;
    if (endpointPickTarget) return;
    const interactiveFeature = event.features?.find((feature) => feature.layer.id === "link-lines");
    let id = interactiveFeature?.properties ? String(interactiveFeature.properties.id ?? "") : "";
    if (!id && mapRef.current) {
      const clickPoint = event.point;
      const buffer = 8;
      const features = mapRef.current.queryRenderedFeatures(
        [
          [clickPoint.x - buffer, clickPoint.y - buffer],
          [clickPoint.x + buffer, clickPoint.y + buffer],
        ],
        { layers: ["link-lines"] },
      );
      const nearby = features.find((feature) => feature.properties && typeof feature.properties.id !== "undefined");
      id = nearby?.properties ? String(nearby.properties.id ?? "") : "";
    }
    if (id) {
      setArmAddSiteOnNextEmptyMapClick(false);
      setSelectedDiscoveryLibraryEntryId(null);
      if (id === "__selection__") return;
      if (visibleLinks.some((link) => link.id === id)) {
        setSelectedLinkId(id);
      }
      return;
    }
    if (pendingNewSiteDraft) {
      dismissPendingNewSiteDraft();
      clearActiveSelection();
      setSelectedDiscoveryLibraryEntryId(null);
      setArmAddSiteOnNextEmptyMapClick(true);
      return;
    }
    if (!armAddSiteOnNextEmptyMapClick) {
      clearActiveSelection();
      setSelectedDiscoveryLibraryEntryId(null);
      setArmAddSiteOnNextEmptyMapClick(true);
      return;
    }
    setArmAddSiteOnNextEmptyMapClick(false);
    beginPendingNewSiteDraft(event.lngLat.lat, event.lngLat.lng);
  };

  useEffect(() => {
    const onProfileDraftRequest = (rawEvent: Event) => {
      const customEvent = rawEvent as CustomEvent<ProfileDraftSiteRequestDetail>;
      const detail = customEvent.detail;
      if (!detail) return;
      beginPendingNewSiteDraft(detail.lat, detail.lon);
    };
    window.addEventListener(PROFILE_DRAFT_SITE_REQUEST_EVENT, onProfileDraftRequest);
    return () => window.removeEventListener(PROFILE_DRAFT_SITE_REQUEST_EVENT, onProfileDraftRequest);
  }, [endpointPickTarget, pendingMoveCount]);

  useEffect(() => {
    if (showDiscoverySites) return;
    setSelectedDiscoveryLibraryEntryId(null);
  }, [showDiscoverySites]);

  const addDiscoveryLibrarySiteToSimulation = (entryId: string) => {
    if (!canPersist) {
      setSiteDraftStatus("Read-only mode: cannot add library sites to this simulation.");
      return;
    }
    if (sites.some((site) => site.libraryEntryId === entryId)) {
      setSiteDraftStatus("That site is already in this simulation.");
      return;
    }
    insertSiteFromLibrary(entryId);
    setSiteDraftStatus("Added selected library site to the current simulation.");
    setSelectedDiscoveryLibraryEntryId(entryId);
    setArmAddSiteOnNextEmptyMapClick(false);
  };

  const addDiscoveryMqttNodeToSimulation = (node: MeshmapNode) => {
    if (!canPersist) {
      setSiteDraftStatus("Read-only mode: cannot save MQTT nodes.");
      return;
    }
    const existing = siteLibrary.find((entry) => {
      const meta = entry.sourceMeta;
      if (meta?.sourceType === "mqtt-feed" && meta.nodeId === node.nodeId) return true;
      const latClose = Math.abs(entry.position.lat - node.lat) < 0.00001;
      const lonClose = Math.abs(entry.position.lon - node.lon) < 0.00001;
      return latClose && lonClose;
    });
    if (existing) {
      setMqttDuplicatePrompt({
        node,
        existingId: existing.id,
        existingName: existing.name,
      });
      setSiteDraftStatus(`Node already exists as "${existing.name}". Choose add existing or create a copy.`);
      return;
    }
    requestSiteLibraryDraftAt(node.lat, node.lon, node.longName ?? node.shortName ?? node.nodeId, {
      sourceType: "mqtt-feed",
      sourceUrl: "/meshmap/nodes.json",
      nodeId: node.nodeId,
      longName: node.longName,
      shortName: node.shortName,
      hwModel: node.hwModel,
      role: node.role,
    });
    setSiteDraftStatus("Opened MQTT node in Add Site form. Review and save to add it.");
  };

  const addExistingDuplicateMqttNode = () => {
    if (!mqttDuplicatePrompt) return;
    insertSiteFromLibrary(mqttDuplicatePrompt.existingId);
    setSiteDraftStatus(`Added existing site "${mqttDuplicatePrompt.existingName}" to this simulation.`);
    setMqttDuplicatePrompt(null);
  };

  const createDuplicateMqttCopy = () => {
    if (!mqttDuplicatePrompt) return;
    const node = mqttDuplicatePrompt.node;
    requestSiteLibraryDraftAt(node.lat, node.lon, node.longName ?? node.shortName ?? node.nodeId, {
      sourceType: "mqtt-feed",
      sourceUrl: "/meshmap/nodes.json",
      nodeId: node.nodeId,
      longName: node.longName,
      shortName: node.shortName,
      hwModel: node.hwModel,
      role: node.role,
    });
    setSiteDraftStatus(`Opened copy draft for "${mqttDuplicatePrompt.existingName}".`);
    setMqttDuplicatePrompt(null);
  };

  if (!webglAvailable) {
    return (
      <div className="map-panel map-fallback">
        <h3>Map unavailable</h3>
        <p>WebGL is required for map rendering. The rest of the analysis tools remain available.</p>
      </div>
    );
  }

  const providerCapabilities = useMemo(() => getBasemapProviderCapabilities(), []);
  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapProvider, basemapStylePreset, theme, colorTheme),
    [basemapProvider, basemapStylePreset, theme, colorTheme],
  );
  const fallbackMapStyle = useMemo(() => getCartoFallbackStyle(theme, colorTheme), [theme, colorTheme]);
  const requestedProviderConfig =
    providerCapabilities.find((entry) => entry.provider === basemapProvider) ?? providerCapabilities[0];
  const activeProviderConfig =
    providerCapabilities.find((entry) => entry.provider === resolvedBasemap.provider) ?? providerCapabilities[0];
  const resolvedPresetOptions = activeProviderConfig?.presets ?? [];
  const styleSelectValue =
    resolvedPresetOptions.length <= 1
      ? resolvedPresetOptions[0]?.id ?? basemapStylePreset
      : basemapStylePreset;
  const globalProviders = providerCapabilities.filter((entry) => entry.group === "global");
  const regionalProviders = providerCapabilities.filter((entry) => entry.group === "regional");
  const providerMaxZoom = useMemo(() => {
    switch (resolvedBasemap.provider) {
      case "kartverket":
        return 20;
      default:
        return 22;
    }
  }, [resolvedBasemap.provider]);
  const { isMultiSelectMode, setIsMultiSelectMode, fitControlActive, clearFitControlActive, zoomBy, fitToNodes } = useMapControls({
    activeViewState,
    fitBottomInset,
    mapRef,
    providerMaxZoom,
    sites,
    computeSiteFitBounds,
    fitChromePadding: FIT_CHROME_PADDING,
    clamp,
    setInteractionViewState,
    updateMapViewport,
  });
  const allowedOverlayModes = useMemo<Array<"none" | "heatmap" | "contours" | "passfail" | "relay">>(() => {
    if (selectionCount <= 0) return ["none", "heatmap", "contours"];
    if (selectionCount === 1) return ["none", "passfail", "heatmap", "contours"];
    if (selectionCount === 2) return ["none", "relay", "heatmap", "contours"];
    return ["none", "heatmap", "contours"];
  }, [selectionCount]);
  useEffect(() => {
    if (coverageVizMode === "heatmap") {
      setCoverageVizMode("contours");
      return;
    }
    if (allowedOverlayModes.includes(coverageVizMode as "none" | "heatmap" | "contours" | "passfail" | "relay")) return;
    setCoverageVizMode(selectionCount === 1 ? "passfail" : selectionCount === 2 ? "relay" : "contours");
  }, [allowedOverlayModes, coverageVizMode, selectionCount, setCoverageVizMode]);
  const simulationOverlaySelectValue = coverageVizMode === "contours" ? "heatmap" : coverageVizMode;
  const siteVisibilityMode: "simulation" | "library" | "mqtt" =
    showDiscoveryMqtt ? "mqtt" : showDiscoverySites ? "library" : "simulation";
  const selectedSite = selectedSites[0] ?? null;
  const selectedDiscoveryLibraryEntry =
    selectedDiscoveryLibraryEntryId
      ? sharedOrPublicLibrarySites.find((entry) => entry.id === selectedDiscoveryLibraryEntryId) ?? null
      : null;
  const selectedLibraryEntry =
    selectedSite?.libraryEntryId
      ? siteLibrary.find((entry) => entry.id === selectedSite.libraryEntryId) ?? null
      : null;
  const selectedDiscoveryInspectorText = selectedDiscoveryLibraryEntry
    ? `${selectedDiscoveryLibraryEntry.name} · ${selectedDiscoveryLibraryEntry.position.lat.toFixed(5)}, ${selectedDiscoveryLibraryEntry.position.lon.toFixed(5)}`
    : null;
  const selectedSiteInspectorText = selectedSite
    ? `${selectedSite.name} · ${selectedSite.position.lat.toFixed(5)}, ${selectedSite.position.lon.toFixed(5)} · ${
        selectedSite.groundElevationM
      } m ASL`
    : null;
  const inspectorPrimary = overlayHoverInfo?.text ?? selectedDiscoveryInspectorText ?? selectedSiteInspectorText;
  const inspectorPrimaryLibraryEntryId =
    overlayHoverInfo?.libraryEntryId ?? selectedDiscoveryLibraryEntry?.id ?? selectedLibraryEntry?.id;
  const canAddSelectedDiscoverySite =
    canPersist &&
    Boolean(selectedDiscoveryLibraryEntry) &&
    !sites.some((site) => site.libraryEntryId === selectedDiscoveryLibraryEntry?.id);
  const canRemoveSelectedSite = Boolean(selectedSite && canPersist && sites.length > 1);
  const canSaveSelectedLink = canShowSaveSelectedLinkAction({
    canPersist,
    fromSiteId: selectedFromSite?.id ?? null,
    toSiteId: selectedToSite?.id ?? null,
  });
  const hasInspectorActions = Boolean(
    inspectorPrimaryLibraryEntryId || canAddSelectedDiscoverySite || canRemoveSelectedSite || canSaveSelectedLink,
  );
  const inspectorLines: string[] = [];
  if (!hasSimulationTerrain) inspectorLines.push("No terrain loaded: simulation currently uses site elevations only.");
  if (resolvedBasemap.fallbackReason && !useFallbackMapStyle) inspectorLines.push(resolvedBasemap.fallbackReason);
  if (useFallbackMapStyle) inspectorLines.push("Base map provider failed. Auto-switched to CARTO fallback style.");
  if (mapProviderWarning) inspectorLines.push(mapProviderWarning);
  if (showDiscoverySites) {
    inspectorLines.push(
      `Shared/Public Library Sites visible: ${sharedOrPublicLibrarySites.length}. Click a marker to inspect, then choose Add to Simulation.`,
    );
  }
  if (showDiscoveryMqtt && !mqttLoadStatus) {
    inspectorLines.push(
      mqttTooDenseInView
        ? `MQTT nodes in view: ${mqttNodesInView.length}. Zoom in to show markers (limit ${mqttInViewLimit}).`
        : `MQTT nodes in view: ${mqttNodesInView.length}. Click a marker to open an Add Site draft.`,
    );
  }
  if (endpointPickTarget && endpointPickError) inspectorLines.push(endpointPickError);
  if (siteDraftStatus) inspectorLines.push(siteDraftStatus);
  return (
    <div className={hasMinimumTopology ? "map-panel" : "map-panel map-panel-empty"}>
      <div className="map-controls map-controls-unified map-controls-icon-only">
        <div className="map-controls-group map-controls-group-utility map-controls-utility-pill">
          {showMultiSelectToggle ? (
            <button
              aria-label={isMultiSelectMode ? "Disable multi-select" : "Enable multi-select"}
              className={`map-control-btn map-control-btn-icon ${isMultiSelectMode ? "is-selected" : ""}`}
              onClick={() => setIsMultiSelectMode((current) => !current)}
              title={isMultiSelectMode ? "Multi-select On" : "Multi-select Off"}
              type="button"
            >
              <SquareStack aria-hidden="true" strokeWidth={1.8} />
            </button>
          ) : null}
          <button aria-label="Zoom out" className="map-control-btn map-control-btn-icon" onClick={() => zoomBy(-1)} title="Zoom out" type="button">
            <ZoomOut aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button aria-label="Zoom in" className="map-control-btn map-control-btn-icon" onClick={() => zoomBy(1)} title="Zoom in" type="button">
            <ZoomIn aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label="Fit map to sites"
            className={`map-control-btn map-control-btn-icon ${fitControlActive ? "is-selected" : ""}`}
            onClick={fitToNodes}
            title="Fit"
            type="button"
          >
            <Fullscreen aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label={isMapExpanded ? "Show panels" : "Hide panels"}
            className={`map-control-btn map-control-btn-icon ${isMapExpanded ? "is-selected" : ""}`}
            onClick={onToggleMapExpanded}
            title={isMapExpanded ? "Show panels" : "Hide panels"}
            type="button"
          >
            {isMapExpanded ? <Minimize2 aria-hidden="true" strokeWidth={1.8} /> : <Maximize2 aria-hidden="true" strokeWidth={1.8} />}
          </button>
        </div>
      </div>
      {notice ? (
        <div className={`map-inline-notice map-inline-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.message}</span>
          {notice.onDismiss ? (
            <ActionButton aria-label="Dismiss notice" onClick={notice.onDismiss} title="Dismiss">
              Dismiss
            </ActionButton>
          ) : null}
        </div>
      ) : null}
      {(coverageVizMode !== "none" &&
        (!hasHeatTopology ||
        (coverageVizMode === "relay" && !hasRelayTopology) ||
        ((coverageVizMode === "passfail" || coverageVizMode === "relay") && !hasPassFailTopology))) ? (
        <div className="map-empty-state" role="status">
          {coverageVizMode === "heatmap" || coverageVizMode === "contours"
            ? "Add at least one site to start coverage mapping."
            : coverageVizMode === "passfail"
              ? "Add at least one site to run pass/fail mapping. Add a second site for path-based analysis."
              : "Add at least two sites to run relay analysis."}
        </div>
      ) : null}
      {showInspector ? (
        <aside className="map-inspector" aria-live="polite">
          {inspectorHeaderActions ? (
            <div className="map-inspector-header-row">{inspectorHeaderActions}</div>
          ) : null}
          {(isSimulationRecomputing || isBackgroundBusy) && backgroundBusyLabel ? (
            <div className="map-inspector-section">
              <p className="map-inspector-line">
                {isSimulationRecomputing ? `Recalculating simulation... ${simulationProgress}%` : backgroundBusyLabel}
              </p>
              <div className="map-progress-track">
                {isSimulationRecomputing ? (
                  <div className="map-progress-fill" style={{ width: `${simulationProgress}%` }} />
                ) : isTerrainFetching && hasTerrainDownloadProgress && terrainProgressTilesTotal > 0 ? (
                  <div className="map-progress-fill" style={{ width: `${terrainProgressPercent}%` }} />
                ) : (
                  <div className="map-progress-fill map-progress-fill-indeterminate" />
                )}
              </div>
            </div>
          ) : null}
          {showHolidayThemeNotice && activeHolidayTheme ? (
            <div className="map-inspector-section map-holiday-note" role="status">
              <p className="map-inspector-primary map-holiday-note-title">
                <span className="map-holiday-note-icons" aria-hidden="true">
                  <Rabbit size={15} strokeWidth={1.8} />
                  <Egg size={14} strokeWidth={1.8} />
                </span>
                {activeHolidayTheme.message}
              </p>
              <p className="map-inspector-line">
                {isHolidayThemeForced
                  ? "Easter theme is active this week."
                  : "Your preferred theme is active for this Easter week."}
              </p>
              <span className="map-inline-actions">
                {isHolidayThemeForced ? (
                  <ActionButton onClick={revertHolidayThemeForWindow}>
                    Revert Theme
                  </ActionButton>
                ) : null}
                <ActionButton onClick={dismissHolidayThemeNotice}>
                  Dismiss
                </ActionButton>
              </span>
            </div>
          ) : null}
          {inspectorPrimary || hasInspectorActions ? (
            <div className="map-inspector-section">
              {inspectorPrimary ? <p className="map-inspector-primary">{inspectorPrimary}</p> : null}
              {hasInspectorActions ? (
                <div className="chip-group">
                  {inspectorPrimaryLibraryEntryId ? (
                    <ActionButton
                      onClick={() => requestOpenSiteLibraryEntry(inspectorPrimaryLibraryEntryId)}
                    >
                      Details
                    </ActionButton>
                  ) : null}
                  {canRemoveSelectedSite ? (
                    <ActionButton onClick={removeSelectedSiteFromSimulation} variant="danger">
                      Remove From Simulation
                    </ActionButton>
                  ) : null}
                  {canAddSelectedDiscoverySite && selectedDiscoveryLibraryEntry ? (
                    <ActionButton
                      onClick={() => addDiscoveryLibrarySiteToSimulation(selectedDiscoveryLibraryEntry.id)}
                    >
                      Add to Simulation
                    </ActionButton>
                  ) : null}
                  {canSaveSelectedLink ? (
                    <ActionButton onClick={saveSelectedSitesAsLink}>
                      Save Selected Path
                    </ActionButton>
                  ) : null}
                  {canAddSelectedDiscoverySite && selectedDiscoveryLibraryEntry ? (
                    <button
                      className="inline-action"
                      onClick={() => addDiscoveryLibrarySiteToSimulation(selectedDiscoveryLibraryEntry.id)}
                      type="button"
                    >
                      Add To Simulation
                    </button>
                  ) : null}
                  {canSaveSelectedLink ? (
                    <button className="inline-action" onClick={saveSelectedSitesAsLink} type="button">
                      Save Selected Link
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {inspectorLines.length ? (
            <div className="map-inspector-section">
              {inspectorLines.map((line) => (
                <p className="map-inspector-line" key={line}>
                  {line}
                </p>
              ))}
            </div>
          ) : null}
          {showDiscoveryMqtt && mqttLoadStatus ? (
            <div className="map-inspector-section">
              <p className="map-inspector-line">{mqttLoadStatus}</p>
              {mqttLoadStatus === "Loading MQTT nodes..." ? (
                <div className="map-progress-track">
                  <div className="map-progress-fill map-progress-fill-indeterminate" />
                </div>
              ) : mqttLoadStatus.includes("failed") ? (
                <span className="map-inline-actions">
                  <ActionButton
                    aria-label="Retry MQTT load"
                    onClick={() => {
                      setMqttNodes([]);
                      setMqttLoadStatus(null);
                    }}
                  >
                    <RefreshCw aria-hidden="true" size={12} strokeWidth={2} />
                    <span>Retry</span>
                  </ActionButton>
                </span>
              ) : null}
            </div>
          ) : null}
          {mqttDuplicatePrompt ? (
            <div className="map-inspector-section">
              <p className="map-inspector-line">
                This MQTT node is already in your library as <strong>{mqttDuplicatePrompt.existingName}</strong>.
              </p>
              <span className="map-inline-actions">
                <ActionButton onClick={addExistingDuplicateMqttNode}>
                  Add Existing
                </ActionButton>
                <ActionButton onClick={createDuplicateMqttCopy}>
                  Create Copy
                </ActionButton>
                <ActionButton onClick={() => setMqttDuplicatePrompt(null)}>
                  Cancel
                </ActionButton>
              </span>
            </div>
          ) : null}
          {pendingNewSiteDraft ? (
            <div className="map-inspector-section">
              <p className="map-inspector-line">
                New site at {pendingNewSiteDraft.lat.toFixed(5)}, {pendingNewSiteDraft.lon.toFixed(5)}. Drag it, then
                save or dismiss.
              </p>
              <span className="map-inline-actions">
                {canPersist ? (
                  <ActionButton onClick={() => void savePendingNewSiteDraft()}>
                    Save To Library
                  </ActionButton>
                ) : null}
                <ActionButton onClick={dismissPendingNewSiteDraft}>
                  Dismiss
                </ActionButton>
              </span>
            </div>
          ) : null}
          {pendingMoveCount > 0 && pendingMovePreview ? (
            <div className="map-inspector-section">
              <p className="map-inspector-line">
                {(pendingMoveCount === 1
                  ? `Unsaved move for ${sites.find((site) => site.id === pendingMovePreview.siteId)?.name ?? "site"} to ${pendingMovePreview.currentPosition.lat.toFixed(5)}, ${pendingMovePreview.currentPosition.lon.toFixed(5)}.`
                  : `${pendingMoveCount} sites have unsaved position changes.`) +
                  (readOnly && !canPersist ? " Read-only mode: changes are temporary." : "")}
              </p>
              <span className="map-inline-actions">
                {canPersist ? (
                  <ActionButton onClick={savePendingSiteMove}>
                    Save Positions
                  </ActionButton>
                ) : null}
                <ActionButton onClick={dismissPendingSiteMove}>
                  {canPersist ? "Dismiss" : "Revert"}
                </ActionButton>
              </span>
            </div>
          ) : null}
          <details
            className="compact-details map-inspector-details"
            onToggle={(event) => { const v = event.currentTarget.open; writeSectionBool(UI_SECTION_KEYS.mapViewOverlayGuide, v); setShowOverlayGuide(v); }}
            open={showOverlayGuide}
          >
            <summary>Map</summary>
            <div className="map-inspector-map-settings">
              <label className="map-inspector-map-setting">
                <span>Map Provider</span>
                <select
                  className="locale-select"
                  onChange={(event) => {
                    const nextProvider = event.target.value as typeof basemapProvider;
                    const nextProviderConfig =
                      providerCapabilities.find((entry) => entry.provider === nextProvider) ?? providerCapabilities[0];
                    setBasemapProvider(nextProvider);
                    setBasemapStylePreset(
                      nextProviderConfig.presets.find((preset) => preset.id === "normal-themed")?.id ??
                        nextProviderConfig.presets.find((preset) => preset.id === "normal")?.id ??
                        nextProviderConfig.presets[0]?.id ??
                        "normal",
                    );
                    setUseFallbackMapStyle(false);
                    setMapProviderWarning(null);
                  }}
                  value={basemapProvider}
                >
                  <optgroup label="Global">
                    {globalProviders.map((provider) => (
                      <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                        {provider.label}
                        {!provider.available ? " (unavailable)" : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Regional">
                    {regionalProviders.map((provider) => (
                      <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                        {provider.label}
                        {!provider.available ? " (unavailable)" : ""}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label className="map-inspector-map-setting">
                <span>Map Style</span>
                <select
                  className="locale-select"
                  disabled={resolvedPresetOptions.length <= 1}
                  onChange={(event) => {
                    setBasemapStylePreset(event.target.value);
                    setUseFallbackMapStyle(false);
                    setMapProviderWarning(null);
                  }}
                  value={styleSelectValue}
                >
                  {resolvedPresetOptions.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="map-inspector-map-setting">
                <span>Terrain</span>
                <select
                  className="locale-select"
                  onChange={(event) => setShowTerrainOverlay(event.target.value === "on")}
                  value={showTerrainOverlay ? "on" : "off"}
                >
                  <option value="on">Copernicus</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label className="map-inspector-map-setting">
                <span>Simulation Overlay</span>
                <select
                  className="locale-select"
                  onChange={(event) => {
                    const mode = event.target.value as "none" | "heatmap" | "contours" | "passfail" | "relay";
                    if (mode === "heatmap") {
                      setCoverageVizMode("heatmap");
                      return;
                    }
                    if (mode === "contours") {
                      setCoverageVizMode("contours");
                      return;
                    }
                    setCoverageVizMode(mode);
                  }}
                  value={simulationOverlaySelectValue}
                >
                  <option value="none">Hidden</option>
                  {allowedOverlayModes.includes("heatmap") ? <option value="heatmap">Heatmap</option> : null}
                  {allowedOverlayModes.includes("contours") ? <option value="contours">Contours</option> : null}
                  {allowedOverlayModes.includes("passfail") ? <option value="passfail">Pass/Fail</option> : null}
                  {allowedOverlayModes.includes("relay") ? <option value="relay">Relay</option> : null}
                </select>
              </label>
              {coverageVizMode !== "none" && (
                <label className="map-inspector-map-setting">
                  <span>Coverage Detail</span>
                  <select
                    className="locale-select"
                    onChange={(event) => setSelectedCoverageResolution(event.target.value as "normal" | "high")}
                    value={selectedCoverageResolution}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High (slower)</option>
                  </select>
                </label>
              )}
              <label className="map-inspector-map-setting">
                <span>Visible Sites</span>
                <select
                  className="locale-select"
                  onChange={(event) => {
                    const mode = event.target.value as "simulation" | "library" | "mqtt";
                    if (mode === "simulation") {
                      setShowDiscoverySites(false);
                      setShowDiscoveryMqtt(false);
                      return;
                    }
                    if (mode === "library") {
                      setShowDiscoverySites(true);
                      setShowDiscoveryMqtt(false);
                      return;
                    }
                    setShowDiscoverySites(false);
                    setShowDiscoveryMqtt(true);
                  }}
                  value={siteVisibilityMode}
                >
                  <option value="simulation">Only Simulation</option>
                  <option value="library">Simulation + Library</option>
                  <option value="mqtt">Simulation + MQTT</option>
                </select>
              </label>
            </div>
            <p>
              Mode: <strong>{overlayGuideTitle}</strong>
            </p>
            {coverageVizMode === "none" ? <p>Overlay is hidden. Use Simulation Overlay to show it again.</p> : null}
            {coverageVizMode === "heatmap" ? (
              <>
                <p>
                  Shows overall coverage strength from your current simulation sites. Think of it as "how good signal
                  should feel if you stand here".
                </p>
                <div className="overlay-inline-controls">
                  <span>Style</span>
                  <div className="chip-group">
                    <button
                      className="map-control-btn is-selected"
                      onClick={() => setCoverageVizMode("heatmap")}
                      type="button"
                    >
                      Smooth
                    </button>
                    <button
                      className="map-control-btn"
                      onClick={() => setCoverageVizMode("contours")}
                      type="button"
                    >
                      Bands
                    </button>
                  </div>
                </div>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{fmtDbm(signalRange.min)}</span>
                    <span>{fmtDbm(signalRange.max)}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">Left side is weaker signal (worse). Right side is stronger signal (better).</p>
              </>
            ) : null}
            {coverageVizMode === "contours" ? (
              <>
                <p>Same data as Heatmap, but grouped into steps so boundaries are easier to read.</p>
                <div className="overlay-inline-controls">
                  <span>Style</span>
                  <div className="chip-group">
                    <button
                      className="map-control-btn"
                      onClick={() => setCoverageVizMode("heatmap")}
                      type="button"
                    >
                      Smooth
                    </button>
                    <button
                      className="map-control-btn is-selected"
                      onClick={() => setCoverageVizMode("contours")}
                      type="button"
                    >
                      Bands
                    </button>
                  </div>
                </div>
                <div className="overlay-inline-controls">
                  <span>Band step</span>
                  <select
                    className="locale-select"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "auto") {
                        setBandStepMode("auto");
                        return;
                      }
                      const parsed = Number(value);
                      if (parsed === 3 || parsed === 5 || parsed === 8 || parsed === 10) {
                        setBandStepMode(parsed);
                      }
                    }}
                    value={String(bandStepMode)}
                  >
                    <option value="auto">Auto ({currentBandStepDb} dB)</option>
                    <option value="3">3 dB</option>
                    <option value="5">5 dB</option>
                    <option value="8">8 dB</option>
                    <option value="10">10 dB</option>
                  </select>
                </div>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{fmtDbm(signalRange.min)}</span>
                    <span>{fmtDbm(signalRange.max)}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">Left side is weaker signal (worse). Right side is stronger signal (better).</p>
              </>
            ) : null}
            {coverageVizMode === "passfail" ? (
              <>
                <p>Go/no-go map with terrain context.</p>
                <ul className="overlay-legend">
                  <li>
                    <span className="state-dot state-dot-pass_clear" />
                    <span>Clear path and meets signal target</span>
                  </li>
                  <li>
                    <span className="state-dot state-dot-pass_blocked" />
                    <span>Blocked path, but still meets signal target</span>
                  </li>
                  <li>
                    <span className="state-dot state-dot-fail_clear" />
                    <span>Clear path, but below signal target</span>
                  </li>
                  <li>
                    <span className="state-dot state-dot-fail_blocked" />
                    <span>Blocked path and below signal target</span>
                  </li>
                </ul>
              </>
            ) : null}
            {coverageVizMode === "relay" ? (
              <>
                <p>
                  Helps you find where to place a relay between {selectedFromSite?.name ?? "n/a"} and{" "}
                  {selectedToSite?.name ?? "n/a"}.
                </p>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{relayRange ? fmtDbm(relayRange.min) : "Worse relay position"}</span>
                    <span>{relayRange ? fmtDbm(relayRange.max) : "Better relay position"}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">Left side is worse relay quality. Right side is better relay quality.</p>
              </>
            ) : null}
          </details>
          <details
            className="compact-details map-inspector-details"
            onToggle={(event) => { const v = event.currentTarget.open; writeSectionBool(UI_SECTION_KEYS.mapViewResults, v); setShowResultsSummary(v); }}
            open={showResultsSummary}
          >
            <summary>Results</summary>
            <SimulationResultsSection />
          </details>
          <details
            className="compact-details map-inspector-details"
            onToggle={(event) => { const v = event.currentTarget.open; writeSectionBool(UI_SECTION_KEYS.mapViewSimSummary, v); setShowSimulationSummary(v); }}
            open={showSimulationSummary}
          >
            <summary>Simulation Sources</summary>
            <p>
              Model: {propagationModel} / {selectedCoverageResolution} / View: {coverageVizMode}
            </p>
            <p>
              Network: {selectedNetwork?.name ?? "n/a"} @ {" "}
              {(selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 0).toFixed(3)} MHz
            </p>
            <p>
              Terrain dataset: {TERRAIN_DATASET_LABEL[terrainDataset]} ({selectedDatasetTileCount} matching tile
              {selectedDatasetTileCount === 1 ? "" : "s"}, {srtmTiles.length} total loaded)
            </p>
            {terrainSourceSummary.length ? (
              <ul className="map-sim-sources">
                {terrainSourceSummary.map((entry) => (
                  <li key={entry.label}>
                    {entry.label}: {entry.count}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Terrain source: simulation/manual site elevations only</p>
            )}
            <p>Site elevations: Simulation values</p>
            <p>Resolution: Auto ({overlayDimensions.width}x{overlayDimensions.height})</p>
            <p>Overlay area diagonal: {analysisBoundsDiagonalKm.toFixed(0)} km</p>
            <p>Optimization thresholds (by simulation area): &gt;250 km, &gt;400 km, &gt;600 km.</p>
            {largeAreaOptimizationActive ? (
              <p>
                Large-area optimization active (preview resolution scale {Math.round(overlayResolutionScale * 100)}%).
                Zoom in or narrow site spread for higher detail.
              </p>
            ) : (
              <p>Large-area optimization inactive at this simulation extent.</p>
            )}
            <p>
              Coverage values are terrain-aware when ITM model is selected and terrain tiles are loaded.
            </p>
            <p>Terrain overlay: {showTerrainOverlay ? "Visible" : "Hidden"} (simulation still uses loaded terrain)</p>
          </details>
        </aside>
      ) : null}
      <Map
        ref={mapRef}
        longitude={activeViewState.longitude}
        latitude={activeViewState.latitude}
        zoom={activeViewState.zoom}
        maxZoom={providerMaxZoom}
        renderWorldCopies={resolvedBasemap.provider !== "kartverket"}
        initialViewState={{
          longitude: activeViewState.longitude,
          latitude: activeViewState.latitude,
          zoom: activeViewState.zoom,
        }}
        mapStyle={useFallbackMapStyle ? fallbackMapStyle : resolvedBasemap.style}
        onLoad={() => setIsMapLoaded(true)}
        onError={() => {
          if (!useFallbackMapStyle && resolvedBasemap.provider !== "kartverket") {
            setUseFallbackMapStyle(true);
            setBasemapProvider("carto");
            setInteractionViewState({
              longitude: activeViewState.longitude,
              latitude: activeViewState.latitude,
              zoom: Math.min(activeViewState.zoom, 20),
            });
            setMapProviderWarning(
              `${requestedProviderConfig?.label ?? "Selected provider"} failed (network, quota, or style error).`,
            );
          }
        }}
        interactiveLayerIds={["link-lines"]}
        onClick={onMapClick}
        onTouchStart={() => {
          mapRef.current?.getMap().stop();
        }}
        onMove={(event) => {
          if (event.originalEvent) {
            clearFitControlActive();
          }
          setInteractionViewState({
            longitude: event.viewState.longitude,
            latitude: event.viewState.latitude,
            zoom: Math.min(event.viewState.zoom, providerMaxZoom),
          });
        }}
        onMoveEnd={onMoveEnd}
      >
        {showTerrainOverlay && simulationTerrainOverlay ? (
          <Source
            coordinates={simulationTerrainOverlay.coordinates}
            id="terrain-overlay-source"
            type="image"
            url={simulationTerrainOverlay.url}
          >
            <Layer
              id="terrain-overlay-layer"
              type="raster"
              paint={{
                ...terrainRasterPaint,
                "raster-opacity": coverageOverlay ? 0.34 : 0.62,
              }}
            />
          </Source>
        ) : null}

        <Source data={profileFeatures} id="profile-path" type="geojson">
          <Layer {...profileLineLayer(profileColor)} />
        </Source>

        {coverageOverlay ? (
          <Source
            coordinates={coverageOverlay.coordinates}
            id="coverage-overlay-source"
            type="image"
            url={coverageOverlay.url}
          >
            <Layer {...coverageRasterLayer} />
          </Source>
        ) : null}

        <Source data={lineFeatures} id="links" type="geojson">
          <Layer {...mapLineLayer(linkColor, selectedLinkColor)} />
        </Source>

        {sites.map((site) => {
          const isSelected = !armAddSiteOnNextEmptyMapClick && selectedSiteSet.has(site.id);
          const pendingMove = pendingSiteMoves[site.id];
          const markerPosition = pendingMove?.currentPosition ?? site.position;
          const isTemporarilyMoved = Boolean(pendingMove);
          const isPassFailMode = coverageVizMode === "passfail" && Boolean(selectedFromSite);
          const isRelayMode = coverageVizMode === "relay" && Boolean(selectedFromSite) && Boolean(selectedToSite);
          const isFocusNode = isPassFailMode
            ? site.id === selectedFromSite?.id
            : isRelayMode
              ? site.id === selectedFromSite?.id || site.id === selectedToSite?.id
              : true;
          return (
            <Marker
              anchor="bottom"
              draggable
              key={site.id}
              latitude={markerPosition.lat}
              longitude={markerPosition.lon}
              onDrag={(event) => onSiteDrag(site.id, event)}
              onDragEnd={(event) => onSiteDragEnd(site.id, event)}
            >
              <MarkerActionButton
                ariaLabel={site.name}
                className={`site-pin ${isSelected ? "is-selected" : ""} ${isTemporarilyMoved ? "is-temporary" : ""} ${
                  isFocusNode ? "is-mode-focus" : "is-dimmed"
                }`}
                onMouseEnter={() =>
                  setOverlayHoverInfo({
                    text: `${site.name} · ${markerPosition.lat.toFixed(5)}, ${markerPosition.lon.toFixed(5)} · ${
                      site.groundElevationM
                    } m ASL`,
                    ...(site.libraryEntryId ? { libraryEntryId: site.libraryEntryId } : {}),
                  })
                }
                onMouseLeave={() => setOverlayHoverInfo(null)}
                onActivate={(event) => {
                  const nativeEvent = event as unknown as { ctrlKey?: boolean; metaKey?: boolean };
                  onSiteClick(site.id, isMultiSelectMode || Boolean(nativeEvent.ctrlKey || nativeEvent.metaKey));
                }}
              >
                <span>{site.name}</span>
              </MarkerActionButton>
            </Marker>
          );
        })}

        {showDiscoverySites
          ? sharedOrPublicLibrarySites.map((entry) => (
              <Marker
                anchor="bottom"
                key={`discover-site-${entry.id}`}
                latitude={entry.position.lat}
                longitude={entry.position.lon}
              >
                <MarkerActionButton
                  ariaLabel={entry.name}
                  className="site-pin is-temporary"
                  onMouseEnter={() =>
                    setOverlayHoverInfo({
                      text: `${entry.name} · ${entry.position.lat.toFixed(5)}, ${entry.position.lon.toFixed(5)}`,
                      libraryEntryId: entry.id,
                    })
                  }
                  onMouseLeave={() => setOverlayHoverInfo(null)}
                  onActivate={() => {
                    setArmAddSiteOnNextEmptyMapClick(false);
                    setSelectedDiscoveryLibraryEntryId(entry.id);
                  }}
                >
                  <span>{entry.name}</span>
                </MarkerActionButton>
              </Marker>
            ))
          : null}

        {showDiscoveryMqtt
          ? (mqttTooDenseInView ? [] : mqttNodesInView).map((node) => (
              <Marker anchor="bottom" key={`discover-mqtt-${node.nodeId}`} latitude={node.lat} longitude={node.lon}>
                <MarkerActionButton
                  ariaLabel={node.longName ?? node.shortName ?? node.nodeId}
                  className="site-pin is-temporary"
                  onMouseEnter={() =>
                    setOverlayHoverInfo({
                      text: `${node.longName ?? node.shortName ?? node.nodeId} · ${node.nodeId}${
                        node.shortName ? ` · ${node.shortName}` : ""
                      }${node.hwModel ? ` · ${node.hwModel}` : ""}`,
                    })
                  }
                  onMouseLeave={() => setOverlayHoverInfo(null)}
                  onActivate={() => {
                    addDiscoveryMqttNodeToSimulation(node);
                  }}
                >
                  <span>+ {node.longName ?? node.shortName ?? node.nodeId}</span>
                </MarkerActionButton>
              </Marker>
            ))
          : null}

        {pendingNewSiteDraft ? (
          <Marker
            anchor="bottom"
            draggable
            latitude={pendingNewSiteDraft.lat}
            longitude={pendingNewSiteDraft.lon}
            onDragEnd={onPendingNewSiteDragEnd}
          >
            <div className="site-pin is-temporary">
              <span>New Site</span>
            </div>
          </Marker>
        ) : null}

        {cursorPoint ? (
          <Marker
            anchor="center"
            latitude={cursorPoint.lat}
            longitude={cursorPoint.lon}
          >
            <div className="profile-map-cursor" />
          </Marker>
        ) : null}
      </Map>
    </div>
  );
}
