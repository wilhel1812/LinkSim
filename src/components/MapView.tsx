import { useMemo, useRef, useState } from "react";
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
import { sampleSrtmElevation } from "../lib/srtm";
import { tilesForBounds } from "../lib/terrainTiles";
import { getUiErrorMessage } from "../lib/uiError";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { getBasemapProviderCapabilities, resolveBasemapSelection } from "../lib/basemaps";
import { useAppStore } from "../store/appStore";
import { TERRAIN_DATASET_LABEL } from "../lib/terrainDataset";
import type { Link, Site } from "../types/radio";

const mapLineLayer = (linkColor: string, selectedColor: string): LayerProps => ({
  id: "link-lines",
  type: "line",
  paint: {
    "line-color": ["case", ["==", ["get", "selected"], 1], selectedColor, linkColor],
    "line-width": ["case", ["==", ["get", "selected"], 1], 4.5, 3],
    "line-opacity": ["case", ["==", ["get", "selected"], 1], 0.98, 0.72],
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

const fallbackStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">© CARTO</a>',
    },
  },
  layers: [
    {
      id: "osm-base",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
} as const;

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
type CoverageVizMode = "none" | "heatmap" | "contours" | "passfail" | "relay";
type CoverageSampleLite = { lat: number; lon: number; valueDbm: number };
type BandStepMode = "auto" | 3 | 5 | 8 | 10;

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

const computeOverlayDimensions = (
  bounds: TerrainBounds,
  quality: "auto" | "high",
): { width: number; height: number } => {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latSpanKm = Math.max(0.5, Math.abs(bounds.maxLat - bounds.minLat) * 111.32);
  const lonSpanKm =
    Math.max(0.5, Math.abs(bounds.maxLon - bounds.minLon) * 111.32 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)));
  const aspect = lonSpanKm / latSpanKm;
  const shortSidePx = quality === "high" ? 880 : 320;
  const maxSidePx = quality === "high" ? 1400 : 540;
  let width = shortSidePx;
  let height = shortSidePx;
  if (aspect >= 1) {
    width = Math.round(shortSidePx * Math.min(2.6, aspect));
  } else {
    height = Math.round(shortSidePx * Math.min(2.6, 1 / Math.max(0.01, aspect)));
  }
  return {
    width: clamp(width, 220, maxSidePx),
    height: clamp(height, 220, maxSidePx),
  };
};

const computeSourceCentricRxDbm = (
  lat: number,
  lon: number,
  fromSite: Site,
  effectiveLink: Link,
  receiverAntennaHeightM: number,
  propagationModel: "FSPL" | "TwoRay" | "ITM",
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
): number =>
  computeSourceCentricRxMetrics(
    lat,
    lon,
    fromSite,
    effectiveLink,
    receiverAntennaHeightM,
    propagationModel,
    terrainSampler,
    terrainSamples,
  ).rxDbm;

const buildCoverageOverlay = (
  bounds: TerrainBounds,
  samples: CoverageSampleLite[],
  mode: "heatmap" | "contours",
  bandStepDb: number,
  dimensions: { width: number; height: number },
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null => {
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
  propagationModel: "FSPL" | "TwoRay" | "ITM",
  rxTargetDbm: number,
  environmentLossDb: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  terrainSamples: number,
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null => {
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
      const metrics = computeSourceCentricRxMetrics(
        lat,
        lon,
        fromSite,
        effectiveLink,
        receiverAntennaHeightM,
        propagationModel,
        terrainSampler,
        terrainSamples,
      );
      const pass = metrics.rxDbm - environmentLossDb >= rxTargetDbm;
      const losBlocked = propagationModel === "ITM" && metrics.terrainObstructed;
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
  propagationModel: "FSPL" | "TwoRay" | "ITM",
  environmentLossDb: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
  terrainSamples: number,
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null => {
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

  for (let y = 0; y < height; y += 1) {
    const tY = y / Math.max(1, height - 1);
    const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
    for (let x = 0; x < width; x += 1) {
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;

      const relayGround = terrainSampler(lat, lon) ?? fallbackRelayGround;
      const relaySite: Site = {
        id: "__relay_candidate__",
        name: "Relay candidate",
        position: { lat, lon },
        antennaHeightM: relayAntennaHeightM,
        groundElevationM: relayGround,
      };
      const fromToRelayRx = computeSourceCentricRxDbm(
        lat,
        lon,
        fromSite,
        effectiveLink,
        relayAntennaHeightM,
        propagationModel,
        terrainSampler,
        terrainSamples,
      );
      const relayToTargetRx = computeSourceCentricRxDbm(
        toSite.position.lat,
        toSite.position.lon,
        relaySite,
        effectiveLink,
        toSite.antennaHeightM,
        propagationModel,
        terrainSampler,
        terrainSamples,
      );
      const bottleneckDbm = Math.min(fromToRelayRx, relayToTargetRx) - environmentLossDb;
      const [r, g, b] = coverageColorForDbm(clamp(bottleneckDbm, -125, -62));
      const px = (y * width + x) * 4;
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
  };
};

const buildTerrainShadeOverlay = (
  bounds: TerrainBounds,
  sampler: (lat: number, lon: number) => number | null,
  dimensions: { width: number; height: number },
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null => {
  const width = dimensions.width;
  const height = dimensions.height;
  const elevations = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);

  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    const tY = y / Math.max(1, height - 1);
    const lat = bounds.maxLat - (bounds.maxLat - bounds.minLat) * tY;
    for (let x = 0; x < width; x += 1) {
      const tX = x / Math.max(1, width - 1);
      const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tX;
      const elevation = sampler(lat, lon);
      const i = y * width + x;
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
        if (valid[i]) continue;
        const neighbors = [i - 1, i + 1, i - width, i + width];
        let sum = 0;
        let count = 0;
        for (const n of neighbors) {
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

const computeFitViewport = (
  sites: { position: { lat: number; lon: number } }[],
): { lat: number; lon: number; zoom: number } => {
  if (!sites.length) return { lat: 59.9, lon: 10.7, zoom: 8 };
  if (sites.length === 1) {
    return { lat: sites[0].position.lat, lon: sites[0].position.lon, zoom: 13 };
  }

  const lats = sites.map((s) => s.position.lat);
  const lons = sites.map((s) => s.position.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  const latSpan = Math.max(0.004, (maxLat - minLat) * 1.4);
  const lonSpan = Math.max(0.004, (maxLon - minLon) * 1.4);

  const zoomLat = Math.log2(170 / latSpan);
  const zoomLon = Math.log2(360 / lonSpan);
  const zoom = clamp(Math.min(zoomLat, zoomLon), 3, 15);

  return { lat: centerLat, lon: centerLon, zoom };
};

const computeLinkAnalysisBounds = (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  marginKmPerSide = 4,
): TerrainBounds => {
  const minLat = Math.min(from.lat, to.lat);
  const maxLat = Math.max(from.lat, to.lat);
  const minLon = Math.min(from.lon, to.lon);
  const maxLon = Math.max(from.lon, to.lon);
  const centerLat = (minLat + maxLat) / 2;
  const latPadDeg = marginKmPerSide / 111.32;
  const lonPadDeg = marginKmPerSide / (111.32 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)));
  return {
    minLat: minLat - latPadDeg,
    maxLat: maxLat + latPadDeg,
    minLon: minLon - lonPadDeg,
    maxLon: maxLon + lonPadDeg,
  };
};

type MapViewProps = {
  isMapExpanded: boolean;
  onToggleMapExpanded: () => void;
};

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

export function MapView({ isMapExpanded, onToggleMapExpanded }: MapViewProps) {
  const sites = useAppStore((state) => state.sites);
  const links = useAppStore((state) => state.links);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const temporaryDirectionReversed = useAppStore((state) => state.temporaryDirectionReversed);
  const endpointPickTarget = useAppStore((state) => state.endpointPickTarget);
  const profileCursorIndex = useAppStore((state) => state.profileCursorIndex);
  const getSelectedProfile = useAppStore((state) => state.getSelectedProfile);
  const viewport = useAppStore((state) => state.mapViewport);
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const setSelectedSiteId = useAppStore((state) => state.setSelectedSiteId);
  const updateLink = useAppStore((state) => state.updateLink);
  const updateSite = useAppStore((state) => state.updateSite);
  const setSiteDragPreview = useAppStore((state) => state.setSiteDragPreview);
  const clearSiteDragPreview = useAppStore((state) => state.clearSiteDragPreview);
  const setEndpointPickTarget = useAppStore((state) => state.setEndpointPickTarget);
  const requestSiteLibraryDraftAt = useAppStore((state) => state.requestSiteLibraryDraftAt);
  const coverageSamples = useAppStore((state) => state.coverageSamples);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const selectedCoverageMode = useAppStore((state) => state.selectedCoverageMode);
  const propagationModel = useAppStore((state) => state.propagationModel);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const networks = useAppStore((state) => state.networks);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const hasOnlineElevationSync = useAppStore((state) => state.hasOnlineElevationSync);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const coverageResolutionMode = useAppStore((state) => state.coverageResolutionMode);
  const runHighQualitySimulation = useAppStore((state) => state.runHighQualitySimulation);
  const isSimulationRecomputing = useAppStore((state) => state.isSimulationRecomputing);
  const simulationProgress = useAppStore((state) => state.simulationProgress);
  const isTerrainFetching = useAppStore((state) => state.isTerrainFetching);
  const isTerrainRecommending = useAppStore((state) => state.isTerrainRecommending);
  const isElevationSyncing = useAppStore((state) => state.isElevationSyncing);
  const basemapProvider = useAppStore((state) => state.basemapProvider);
  const basemapStylePreset = useAppStore((state) => state.basemapStylePreset);
  const setBasemapProvider = useAppStore((state) => state.setBasemapProvider);
  const setBasemapStylePreset = useAppStore((state) => state.setBasemapStylePreset);
  const { theme, variant } = useThemeVariant();
  const linkColor = variant.map.linkColor;
  const selectedLinkColor = variant.map.selectedLinkColor;
  const profileColor = variant.map.profileLineColor;
  const selectedProfile = getSelectedProfile();
  const [coverageVizMode, setCoverageVizMode] = useState<CoverageVizMode>("heatmap");
  const [bandStepMode, setBandStepMode] = useState<BandStepMode>("auto");
  const [showTerrainOverlay, setShowTerrainOverlay] = useState(true);
  const [showSimulationSummary, setShowSimulationSummary] = useState(false);
  const [showOverlayGuide, setShowOverlayGuide] = useState(true);
  const [endpointPickError, setEndpointPickError] = useState<string | null>(null);
  const [pendingNewSiteDraft, setPendingNewSiteDraft] = useState<PendingNewSiteDraft | null>(null);
  const [pendingSiteMoves, setPendingSiteMoves] = useState<Record<string, PendingSiteMove>>({});
  const [siteDraftStatus, setSiteDraftStatus] = useState<string | null>(null);
  const [useFallbackMapStyle, setUseFallbackMapStyle] = useState(false);
  const [mapProviderWarning, setMapProviderWarning] = useState<string | null>(null);
  const [interactionViewState, setInteractionViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
  } | null>(null);
  const mapRef = useRef<MapRef | null>(null);
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
  const selectedLink =
    links.find((link) => link.id === selectedLinkId) ??
    visibleLinks[0] ??
    links[0] ??
    (sites.length >= 1
      ? {
          id: "__auto__",
          name: "Auto Link",
          fromSiteId: sites[0].id,
          toSiteId: sites[1]?.id ?? sites[0].id,
          frequencyMHz:
            selectedNetwork?.frequencyOverrideMHz ??
            selectedNetwork?.frequencyMHz ??
            869.618,
          txPowerDbm: 22,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        }
      : null);
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
  const selectedFromSite = selectedFromSiteId
    ? sites.find((site) => site.id === selectedFromSiteId) ?? null
    : null;
  const selectedToSite = selectedToSiteId
    ? sites.find((site) => site.id === selectedToSiteId) ?? null
    : null;
  const hasHeatTopology = sites.length >= 1;
  const hasPassFailTopology = sites.length >= 1;
  const hasRelayTopology = sites.length >= 2;
  const hasMinimumTopology = hasHeatTopology;
  const analysisBounds = useMemo(
    () =>
      selectedFromSite && selectedToSite
        ? computeLinkAnalysisBounds(selectedFromSite.position, selectedToSite.position, 4)
        : sites.length
          ? computeTerrainBounds(sites)
          : null,
    [selectedFromSite, selectedToSite, sites],
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
  const requiredTerrainTileKeys = useMemo(() => {
    if (!analysisBounds) return [] as string[];
    return tilesForBounds(
      analysisBounds.minLat,
      analysisBounds.maxLat,
      analysisBounds.minLon,
      analysisBounds.maxLon,
    );
  }, [analysisBounds]);
  const loadedDatasetTileKeys = useMemo(
    () =>
      new Set(
        srtmTiles
          .filter((tile) => (tile.sourceId ?? "") === terrainDataset)
          .map((tile) => tile.key),
      ),
    [srtmTiles, terrainDataset],
  );
  const missingRequiredTileCount = useMemo(
    () => requiredTerrainTileKeys.filter((key) => !loadedDatasetTileKeys.has(key)).length,
    [requiredTerrainTileKeys, loadedDatasetTileKeys],
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
    () => ({
      type: "FeatureCollection" as const,
      features: visibleLinks
        .map((link) => {
          const from = sites.find((site) => site.id === link.fromSiteId);
          const to = sites.find((site) => site.id === link.toSiteId);
          if (!from || !to) return null;
          return {
            type: "Feature" as const,
            properties: { id: link.id, selected: link.id === selectedLinkId ? 1 : 0 },
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [from.position.lon, from.position.lat],
                [to.position.lon, to.position.lat],
              ],
            },
          };
        })
        .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
    }),
    [visibleLinks, selectedLinkId, sites],
  );

  const profileFeatures = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        selectedProfile.length > 1
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
    [selectedProfile],
  );

  const cursorPoint = selectedProfile[Math.max(0, Math.min(selectedProfile.length - 1, profileCursorIndex))];

  const overlayDimensions = useMemo(() => {
    const bounds = analysisBounds ?? computeCoverageBounds(samplesForOverlay);
    if (!bounds) return { width: 320, height: 320 };
    return computeOverlayDimensions(bounds, coverageResolutionMode);
  }, [analysisBounds, samplesForOverlay, coverageResolutionMode]);

  const coverageOverlay = useMemo(
    () => {
      const bounds = analysisBounds ?? computeCoverageBounds(samplesForOverlay);
      if (!bounds) return null;
      const effectiveBandStepDb =
        bandStepMode === "auto" ? autoBandStepDb(samplesForOverlay, bounds) : bandStepMode;
      if (coverageVizMode === "none") return null;
      if (coverageVizMode === "relay") {
        if (!selectedLink || !selectedFromSite || !selectedToSite || !hasRelayTopology) return null;
        const effectiveLink: Link = {
          ...selectedLink,
          frequencyMHz: selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? selectedLink.frequencyMHz,
        };
        return buildRelayCandidateOverlay(
          bounds,
          selectedFromSite,
          selectedToSite,
          effectiveLink,
          propagationModel,
          environmentLossDb,
          (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
          overlayDimensions,
          coverageResolutionMode === "high" ? 80 : 24,
        );
      }
      if (coverageVizMode === "passfail") {
        if (!selectedLink || !selectedFromSite || !hasPassFailTopology) return null;
        const effectiveLink: Link = {
          ...selectedLink,
          frequencyMHz: selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? selectedLink.frequencyMHz,
        };
        const receiverAntennaHeightM = selectedToSite?.antennaHeightM ?? 2;
        return buildSourcePassFailOverlay(
          bounds,
          selectedFromSite,
          effectiveLink,
          receiverAntennaHeightM,
          propagationModel,
          rxSensitivityTargetDbm,
          environmentLossDb,
          (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
          overlayDimensions,
          coverageResolutionMode === "high" ? 80 : 24,
        );
      }
      return buildCoverageOverlay(
        bounds,
        samplesForOverlay,
        coverageVizMode === "contours" ? "contours" : "heatmap",
        effectiveBandStepDb,
        overlayDimensions,
      );
    },
    [
      samplesForOverlay,
      coverageVizMode,
      bandStepMode,
      rxSensitivityTargetDbm,
      environmentLossDb,
      selectedLink,
      selectedFromSite,
      selectedToSite,
      selectedNetwork,
      propagationModel,
      srtmTiles,
      analysisBounds,
      overlayDimensions,
      coverageResolutionMode,
      hasPassFailTopology,
      hasRelayTopology,
    ],
  );
  const currentBandStepDb = useMemo(() => {
    const bounds = analysisBounds ?? computeCoverageBounds(samplesForOverlay);
    if (!bounds) return 5;
    return bandStepMode === "auto" ? autoBandStepDb(samplesForOverlay, bounds) : bandStepMode;
  }, [analysisBounds, samplesForOverlay, bandStepMode]);
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
    return buildTerrainShadeOverlay(bounds, (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon), overlayDimensions);
  }, [hasSimulationTerrain, analysisBounds, srtmTiles, overlayDimensions]);

  const webglAvailable = useMemo(() => supportsWebgl(), []);
  const isLikelyTerrainColdFetch =
    isTerrainFetching &&
    requiredTerrainTileKeys.length > 0 &&
    missingRequiredTileCount === requiredTerrainTileKeys.length;
  const isBackgroundBusy = isTerrainFetching || isTerrainRecommending || isElevationSyncing;
  const backgroundBusyLabel = isTerrainFetching
    ? isLikelyTerrainColdFetch
      ? "Fetching terrain data... first load for this area can take a few minutes, then it is cached."
      : "Fetching terrain data..."
    : isTerrainRecommending
      ? "Checking terrain dataset coverage..."
      : isElevationSyncing
        ? "Syncing site elevations..."
        : "";
  const activeViewState = interactionViewState ?? {
    longitude: viewport.center.lon,
    latitude: viewport.center.lat,
    zoom: viewport.zoom,
  };

  const onMoveEnd = (event: ViewStateChangeEvent) => {
    setInteractionViewState(null);
    updateMapViewport({
      center: { lat: event.viewState.latitude, lon: event.viewState.longitude },
      zoom: event.viewState.zoom,
    });
  };

  const zoomBy = (delta: number) => {
    const nextZoom = clamp(activeViewState.zoom + delta, 2, 17);
    setInteractionViewState(null);
    updateMapViewport({ zoom: nextZoom });
  };

  const fitToNodes = () => {
    const next = computeFitViewport(sites);
    setInteractionViewState(null);
    updateMapViewport({
      center: { lat: next.lat, lon: next.lon },
      zoom: next.zoom,
    });
  };

  const onSiteClick = (siteId: string) => {
    setSelectedSiteId(siteId);
    if (coverageVizMode === "passfail" && selectedLink) {
      if (siteId === selectedLink.fromSiteId) return;
      if (siteId === selectedLink.toSiteId) {
        const swapToId =
          selectedLink.fromSiteId !== siteId
            ? selectedLink.fromSiteId
            : sites.find((candidate) => candidate.id !== siteId)?.id;
        if (swapToId && swapToId !== siteId) {
          updateLink(selectedLink.id, { fromSiteId: siteId, toSiteId: swapToId });
        }
        return;
      }
      updateLink(selectedLink.id, { fromSiteId: siteId });
      return;
    }
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
    setPendingSiteMoves({});
    clearSiteDragPreview();
    setSiteDraftStatus(null);
  };

  const dismissPendingSiteMove = () => {
    if (!pendingMoveCount) return;
    for (const move of pendingMoveEntries) {
      updateSite(move.siteId, {
        position: move.originalPosition,
        groundElevationM: move.originalGroundElevationM,
      });
    }
    setPendingSiteMoves({});
    clearSiteDragPreview();
    setSiteDraftStatus(null);
  };

  const onSiteDrag = (siteId: string, event: MarkerDragEvent) => {
    if (pendingNewSiteDraft) {
      setSiteDraftStatus("Dismiss or save the new map site before moving existing sites.");
      return;
    }
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
    clearSiteDragPreview(siteId);
    updateSite(siteId, {
      position: nextPosition,
      groundElevationM: nextGroundElevationM,
    });
  };

  const onPendingNewSiteDragEnd = (event: MarkerDragEvent) => {
    const nextPosition = {
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    };
    setPendingNewSiteDraft(nextPosition);
    setSiteDraftStatus(null);
  };

  const onMapClick = (event: MapLayerMouseEvent) => {
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
    if (id && visibleLinks.some((link) => link.id === id)) {
      setSelectedLinkId(id);
      return;
    }
    if (pendingMoveCount > 0) {
      setSiteDraftStatus("Save or dismiss the current site move before creating another new site.");
      return;
    }
    setPendingNewSiteDraft({
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    });
    setSiteDraftStatus(null);
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
  const selectedProviderConfig =
    providerCapabilities.find((entry) => entry.provider === basemapProvider) ?? providerCapabilities[0];
  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapProvider, basemapStylePreset, theme),
    [basemapProvider, basemapStylePreset, theme],
  );
  const resolvedPresetOptions = selectedProviderConfig?.presets ?? [];
  const globalProviders = providerCapabilities.filter((entry) => entry.group === "global");
  const regionalProviders = providerCapabilities.filter((entry) => entry.group === "regional");

  return (
    <div className={hasMinimumTopology ? "map-panel" : "map-panel map-panel-empty"}>
      <div className="map-controls map-controls-provider">
        <div className="map-controls-group map-controls-group-provider">
          <label className="map-provider-field">
            <span>Basemap Provider</span>
            <select
              className="locale-select"
              onChange={(event) => {
                const nextProvider = event.target.value as typeof basemapProvider;
                setBasemapProvider(nextProvider);
                setBasemapStylePreset("auto");
                setUseFallbackMapStyle(false);
                setMapProviderWarning(null);
              }}
              value={basemapProvider}
            >
              {globalProviders.map((provider) => (
                <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                  {provider.label}
                  {!provider.available ? " (unavailable)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="map-provider-field">
            <span>Style</span>
            <select
              className="locale-select"
              onChange={(event) => {
                setBasemapStylePreset(event.target.value);
                setUseFallbackMapStyle(false);
                setMapProviderWarning(null);
              }}
              value={basemapStylePreset}
            >
              <option value="auto">Auto ({theme === "dark" ? "Dark" : "Light"})</option>
              {resolvedPresetOptions.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {regionalProviders.length ? (
            <details className="compact-details map-provider-regional">
              <summary>Regional providers</summary>
              <div className="chip-group">
                {regionalProviders.map((provider) => (
                  <button
                    className={`map-control-btn ${basemapProvider === provider.provider ? "is-selected" : ""}`}
                    disabled={!provider.available}
                    key={provider.provider}
                    onClick={() => {
                      setBasemapProvider(provider.provider);
                      setBasemapStylePreset("auto");
                      setUseFallbackMapStyle(false);
                      setMapProviderWarning(null);
                    }}
                    type="button"
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="map-controls map-controls-main">
        <div className="map-controls-group">
          <button
            className={`map-control-btn ${showTerrainOverlay ? "is-selected" : ""}`}
            onClick={() => setShowTerrainOverlay((current) => !current)}
            title="Toggle terrain overlay (visual only)"
            type="button"
          >
            Terrain
          </button>
          <button
            className={`map-control-btn ${coverageVizMode === "heatmap" || coverageVizMode === "contours" ? "is-selected" : ""}`}
            onClick={() => setCoverageVizMode((current) => (current === "heatmap" || current === "contours" ? "none" : "heatmap"))}
            title="Coverage strength overlay"
            type="button"
          >
            Heat
          </button>
          <button
            className={`map-control-btn ${coverageVizMode === "passfail" ? "is-selected" : ""}`}
            onClick={() => setCoverageVizMode((current) => (current === "passfail" ? "none" : "passfail"))}
            title="Coverage pass/fail against RX target"
            type="button"
          >
            Pass/Fail
          </button>
          <button
            className={`map-control-btn ${coverageVizMode === "relay" ? "is-selected" : ""}`}
            onClick={() => setCoverageVizMode((current) => (current === "relay" ? "none" : "relay"))}
            title="Relay candidate quality between selected From/To endpoints"
            type="button"
          >
            Relay
          </button>
        </div>
        <div className="map-controls-group map-controls-group-utility">
          <button
            className="map-control-btn"
            disabled={isSimulationRecomputing}
            onClick={() => runHighQualitySimulation()}
            title="Run one high-quality simulation pass"
            type="button"
          >
            Render HQ
          </button>
          <button className="map-control-btn" onClick={onToggleMapExpanded} type="button">
            {isMapExpanded ? "Show UI" : "Expand"}
          </button>
          <button className="map-control-btn" onClick={fitToNodes} type="button">
            Fit
          </button>
          <button className="map-control-btn" onClick={() => zoomBy(1)} type="button">
            +
          </button>
          <button className="map-control-btn" onClick={() => zoomBy(-1)} type="button">
            -
          </button>
        </div>
      </div>
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
      {isSimulationRecomputing || isBackgroundBusy ? (
        <div className="map-progress" aria-live="polite" aria-label="Simulation recalculation progress">
          <div className="map-progress-label">
            {isSimulationRecomputing ? `Recalculating simulation... ${simulationProgress}%` : backgroundBusyLabel}
          </div>
          <div className="map-progress-track">
            {isSimulationRecomputing ? (
              <div className="map-progress-fill" style={{ width: `${simulationProgress}%` }} />
            ) : (
              <div className="map-progress-fill map-progress-fill-indeterminate" />
            )}
          </div>
        </div>
      ) : null}
      {!hasSimulationTerrain ? <div className="map-control-note">No SRTM loaded: simulation uses site elevations only.</div> : null}
      {resolvedBasemap.fallbackReason && !useFallbackMapStyle ? (
        <div className="map-control-note map-control-note-secondary">{resolvedBasemap.fallbackReason}</div>
      ) : null}
      {useFallbackMapStyle ? (
        <div className="map-control-note map-control-note-secondary">
          Base map provider failed. Auto-switched to CARTO fallback style.
        </div>
      ) : null}
      {mapProviderWarning ? <div className="map-control-note map-control-note-secondary">{mapProviderWarning}</div> : null}
      {endpointPickTarget && endpointPickError ? (
        <div className="map-control-note map-control-note-tertiary">{endpointPickError}</div>
      ) : null}
      {pendingNewSiteDraft ? (
        <div className="map-control-note map-control-note-tertiary">
          New site at {pendingNewSiteDraft.lat.toFixed(5)}, {pendingNewSiteDraft.lon.toFixed(5)}. Drag it, then save or dismiss.
          <span className="map-inline-actions">
            <button className="map-control-btn" onClick={() => void savePendingNewSiteDraft()} type="button">
              Save To Library
            </button>
            <button className="map-control-btn" onClick={dismissPendingNewSiteDraft} type="button">
              Dismiss
            </button>
          </span>
        </div>
      ) : null}
      {pendingMoveCount > 0 && pendingMovePreview ? (
        <div className="map-control-note map-control-note-tertiary">
          {pendingMoveCount === 1
            ? `Unsaved move for ${sites.find((site) => site.id === pendingMovePreview.siteId)?.name ?? "site"} to ${pendingMovePreview.currentPosition.lat.toFixed(5)}, ${pendingMovePreview.currentPosition.lon.toFixed(5)}.`
            : `${pendingMoveCount} sites have unsaved position changes.`}
          <span className="map-inline-actions">
            <button className="map-control-btn" onClick={savePendingSiteMove} type="button">
              Save Positions
            </button>
            <button className="map-control-btn" onClick={dismissPendingSiteMove} type="button">
              Dismiss
            </button>
          </span>
        </div>
      ) : null}
      {siteDraftStatus ? <div className="map-control-note map-control-note-secondary">{siteDraftStatus}</div> : null}
      <aside className="map-sim-summary" aria-live="polite">
        <div className="map-sim-summary-header">
          <h3>Simulation Sources</h3>
          <button
            className="map-control-btn map-summary-toggle"
            onClick={() => setShowSimulationSummary((current) => !current)}
            type="button"
          >
            {showSimulationSummary ? "Hide" : "Show"}
          </button>
        </div>
        {showSimulationSummary ? (
          <>
            <p>
              Model: {propagationModel} / {selectedCoverageMode} / View: {coverageVizMode}
            </p>
            <p>
              Network: {selectedNetwork?.name ?? "n/a"} @{" "}
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
            <p>
              Site elevations: {hasOnlineElevationSync ? "Open-Meteo sync + simulation values" : "Simulation values"}
            </p>
            <p>
              Resolution: {coverageResolutionMode === "high" ? "High quality (one-shot)" : "Auto"} ({overlayDimensions.width}x
              {overlayDimensions.height})
            </p>
            <p>
              Coverage values are terrain-aware when ITM model is selected and terrain tiles are loaded.
            </p>
            <p>Terrain overlay: {showTerrainOverlay ? "Visible" : "Hidden"} (simulation still uses loaded terrain)</p>
          </>
        ) : null}
      </aside>
      <aside className="map-overlay-guide" aria-live="polite">
        <div className="map-sim-summary-header">
          <h3>Overlay Guide</h3>
          <button
            className="map-control-btn map-summary-toggle"
            onClick={() => setShowOverlayGuide((current) => !current)}
            type="button"
          >
            {showOverlayGuide ? "Hide" : "Show"}
          </button>
        </div>
        {showOverlayGuide ? (
          <>
            <p>
              Mode: <strong>{overlayGuideTitle}</strong>
            </p>
            {coverageVizMode === "none" ? <p>Overlay is hidden. Click Heat, Pass/Fail, or Relay to show it again.</p> : null}
            {coverageVizMode === "heatmap" ? (
              <>
                <p>
                  Shows overall coverage strength from your current simulation sites. Think of it as “how good signal
                  should feel if you stand here”.
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
                    <span>Weaker signal</span>
                    <span>Stronger signal</span>
                  </div>
                </div>
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
                    <span>Weaker signal</span>
                    <span>Stronger signal</span>
                  </div>
                </div>
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
                    <span>Worse relay position</span>
                    <span>Better relay position</span>
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </aside>
      <Map
        ref={mapRef}
        longitude={activeViewState.longitude}
        latitude={activeViewState.latitude}
        zoom={activeViewState.zoom}
        initialViewState={{
          longitude: activeViewState.longitude,
          latitude: activeViewState.latitude,
          zoom: activeViewState.zoom,
        }}
        mapStyle={useFallbackMapStyle ? (fallbackStyle as unknown as string) : resolvedBasemap.style}
        onError={() => {
          if (!useFallbackMapStyle) {
            setUseFallbackMapStyle(true);
            setMapProviderWarning(
              `${selectedProviderConfig?.label ?? "Selected provider"} failed (network, quota, or style error).`,
            );
          }
        }}
        interactiveLayerIds={["link-lines"]}
        onClick={onMapClick}
        onMove={(event) =>
          setInteractionViewState({
            longitude: event.viewState.longitude,
            latitude: event.viewState.latitude,
            zoom: event.viewState.zoom,
          })
        }
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
          const isSelected = site.id === selectedSiteId;
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
              <div
                className={`site-pin ${isSelected ? "is-selected" : ""} ${isTemporarilyMoved ? "is-temporary" : ""} ${
                  isFocusNode ? "is-mode-focus" : "is-dimmed"
                }`}
                onClick={() => onSiteClick(site.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSiteClick(site.id);
                }}
                role="button"
                tabIndex={0}
              >
                <span>{site.name}</span>
              </div>
            </Marker>
          );
        })}

        {pendingNewSiteDraft ? (
          <Marker
            anchor="bottom"
            draggable
            latitude={pendingNewSiteDraft.lat}
            longitude={pendingNewSiteDraft.lon}
            onDragEnd={onPendingNewSiteDragEnd}
          >
            <div className="site-pin is-temporary" role="button" tabIndex={0}>
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
