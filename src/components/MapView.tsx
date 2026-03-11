import { useMemo, useRef, useState } from "react";
import Map, {
  Layer,
  Marker,
  Source,
  type MapLayerMouseEvent,
  type MarkerDragEvent,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import { haversineDistanceKm } from "../lib/geo";
import { getPathLossByModel } from "../lib/rfModels";
import { sampleSrtmElevation } from "../lib/srtm";
import { estimateTerrainExcessLossDb } from "../lib/terrainLoss";
import { useSystemTheme } from "../hooks/useSystemTheme";
import { useAppStore } from "../store/appStore";
import type { Link, Site } from "../types/radio";

const mapLineLayer: LayerProps = {
  id: "link-lines",
  type: "line",
  paint: {
    "line-color": ["case", ["==", ["get", "selected"], 1], "#ffd166", "#00c2ff"],
    "line-width": ["case", ["==", ["get", "selected"], 1], 4.5, 3],
    "line-opacity": ["case", ["==", ["get", "selected"], 1], 0.98, 0.72],
    "line-dasharray": [1.5, 1],
  },
};

const profileLineLayer: LayerProps = {
  id: "profile-line",
  type: "line",
  paint: {
    "line-color": "#ffd166",
    "line-width": 3.6,
    "line-opacity": 0.9,
  },
};

const coverageRasterLayer: LayerProps = {
  id: "coverage-overlay-layer",
  type: "raster",
  paint: {
    "raster-opacity": 0.7,
    "raster-contrast": 0.06,
    "raster-saturation": 0.04,
  },
};

const terrainLayer: LayerProps = {
  id: "terrain-overlay-layer",
  type: "raster",
  paint: {
    "raster-opacity": 0.72,
    "raster-contrast": 0.2,
    "raster-saturation": -0.1,
  },
};

const styleByTheme = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
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

type TerrainBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};
type CoverageVizMode = "heatmap" | "contours" | "passfail";
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
    { v: -125, c: [79, 15, 21] },
    { v: -110, c: [165, 47, 51] },
    { v: -95, c: [230, 107, 40] },
    { v: -82, c: [238, 207, 66] },
    { v: -70, c: [74, 211, 123] },
    { v: -60, c: [43, 192, 255] },
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
): number => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(fromSite.position, { lat, lon }));
  const baseLoss = getPathLossByModel(
    propagationModel,
    distanceKm,
    effectiveLink.frequencyMHz,
    fromSite.antennaHeightM,
    receiverAntennaHeightM,
  );

  let terrainPenaltyDb = 0;
  if (propagationModel === "ITM") {
    const rxGround = terrainSampler(lat, lon);
    if (rxGround !== null) {
      terrainPenaltyDb = estimateTerrainExcessLossDb({
        from: fromSite.position,
        to: { lat, lon },
        fromAntennaAbsM: fromSite.groundElevationM + fromSite.antennaHeightM,
        toAntennaAbsM: rxGround + receiverAntennaHeightM,
        frequencyMHz: effectiveLink.frequencyMHz,
        terrainSampler: ({ lat: y, lon: x }) => terrainSampler(y, x),
        samples: 24,
      });
    }
  }

  const eirpDbm = effectiveLink.txPowerDbm + effectiveLink.txGainDbi - effectiveLink.cableLossDb;
  return eirpDbm + effectiveLink.rxGainDbi - (baseLoss + terrainPenaltyDb);
};

const buildCoverageOverlay = (
  bounds: TerrainBounds,
  samples: CoverageSampleLite[],
  mode: CoverageVizMode,
  bandStepDb: number,
  rxTargetDbm: number,
  environmentLossDb: number,
  dimensions: { width: number; height: number },
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null => {
  if (!samples.length) return null;
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
      const valueDbm = interpolateCoverageDbm(samples, lat, lon);
      if (valueDbm === null) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 180;
      if (mode === "heatmap") {
        [r, g, b] = coverageColorForDbm(valueDbm);
      } else if (mode === "contours") {
        const banded = Math.round(valueDbm / Math.max(1, bandStepDb)) * Math.max(1, bandStepDb);
        [r, g, b] = coverageColorForDbm(banded);
        a = 170;
      } else {
        const adjusted = valueDbm - environmentLossDb;
        const pass = adjusted >= rxTargetDbm;
        [r, g, b] = pass ? [39, 215, 147] : [225, 80, 95];
        a = 168;
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
      const rxDbm = computeSourceCentricRxDbm(
        lat,
        lon,
        fromSite,
        effectiveLink,
        receiverAntennaHeightM,
        propagationModel,
        terrainSampler,
      );
      const pass = rxDbm - environmentLossDb >= rxTargetDbm;
      const px = (y * width + x) * 4;
      image.data[px] = pass ? 39 : 225;
      image.data[px + 1] = pass ? 215 : 80;
      image.data[px + 2] = pass ? 147 : 95;
      image.data[px + 3] = 168;
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

export function MapView({ isMapExpanded, onToggleMapExpanded }: MapViewProps) {
  const sites = useAppStore((state) => state.sites);
  const links = useAppStore((state) => state.links);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const endpointPickTarget = useAppStore((state) => state.endpointPickTarget);
  const profileCursorIndex = useAppStore((state) => state.profileCursorIndex);
  const getSelectedProfile = useAppStore((state) => state.getSelectedProfile);
  const viewport = useAppStore((state) => state.mapViewport);
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const setSelectedSiteId = useAppStore((state) => state.setSelectedSiteId);
  const updateLink = useAppStore((state) => state.updateLink);
  const updateSite = useAppStore((state) => state.updateSite);
  const setEndpointPickTarget = useAppStore((state) => state.setEndpointPickTarget);
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
  const setCoverageResolutionMode = useAppStore((state) => state.setCoverageResolutionMode);
  const isSimulationRecomputing = useAppStore((state) => state.isSimulationRecomputing);
  const simulationProgress = useAppStore((state) => state.simulationProgress);
  const theme = useSystemTheme();
  const selectedProfile = getSelectedProfile();
  const [coverageVizMode, setCoverageVizMode] = useState<CoverageVizMode>("heatmap");
  const [bandStepMode, setBandStepMode] = useState<BandStepMode>("auto");
  const [interactionViewState, setInteractionViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
  } | null>(null);
  const recentlyDraggedSiteId = useRef<string | null>(null);
  const hasSimulationTerrain = srtmTiles.length > 0;
  const selectedNetwork = networks.find((network) => network.id === selectedNetworkId);
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0] ?? null;
  const selectedFromSite = selectedLink
    ? sites.find((site) => site.id === selectedLink.fromSiteId) ?? null
    : null;
  const selectedToSite = selectedLink
    ? sites.find((site) => site.id === selectedLink.toSiteId) ?? null
    : null;
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
    () => srtmTiles.filter((tile) => tile.sourceId === `ve2dbe-${terrainDataset}`).length,
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

  const lineFeatures = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: links.map((link) => {
        const from = sites.find((site) => site.id === link.fromSiteId)!;
        const to = sites.find((site) => site.id === link.toSiteId)!;
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
      }),
    }),
    [links, selectedLinkId, sites],
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
    const bounds = analysisBounds ?? computeCoverageBounds(boundedCoverageSamples);
    if (!bounds) return { width: 320, height: 320 };
    return computeOverlayDimensions(bounds, coverageResolutionMode);
  }, [analysisBounds, boundedCoverageSamples, coverageResolutionMode]);

  const coverageOverlay = useMemo(
    () => {
      const bounds = analysisBounds ?? computeCoverageBounds(boundedCoverageSamples);
      if (!bounds) return null;
      const effectiveBandStepDb =
        bandStepMode === "auto" ? autoBandStepDb(boundedCoverageSamples, bounds) : bandStepMode;
      if (coverageVizMode === "passfail") {
        if (!selectedLink || !selectedFromSite) return null;
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
        );
      }
      return buildCoverageOverlay(
        bounds,
        boundedCoverageSamples,
        coverageVizMode,
        effectiveBandStepDb,
        rxSensitivityTargetDbm,
        environmentLossDb,
        overlayDimensions,
      );
    },
    [
      boundedCoverageSamples,
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
    ],
  );
  const currentBandStepDb = useMemo(() => {
    const bounds = analysisBounds ?? computeCoverageBounds(boundedCoverageSamples);
    if (!bounds) return 5;
    return bandStepMode === "auto" ? autoBandStepDb(boundedCoverageSamples, bounds) : bandStepMode;
  }, [analysisBounds, boundedCoverageSamples, bandStepMode]);

  const simulationTerrainOverlay = useMemo(() => {
    if (!hasSimulationTerrain || !analysisBounds) return null;
    const bounds = analysisBounds;
    return buildTerrainShadeOverlay(bounds, (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon), overlayDimensions);
  }, [hasSimulationTerrain, analysisBounds, srtmTiles, overlayDimensions]);

  const webglAvailable = useMemo(() => supportsWebgl(), []);
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
    if (recentlyDraggedSiteId.current === siteId) {
      recentlyDraggedSiteId.current = null;
      return;
    }

    setSelectedSiteId(siteId);
    if (!endpointPickTarget) return;
    updateLink(selectedLinkId, endpointPickTarget === "from" ? { fromSiteId: siteId } : { toSiteId: siteId });
    setEndpointPickTarget(null);
  };

  const onSiteDragEnd = (siteId: string, event: MarkerDragEvent) => {
    recentlyDraggedSiteId.current = siteId;
    updateSite(siteId, {
      position: { lat: event.lngLat.lat, lon: event.lngLat.lng },
    });
  };

  const onMapClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    const id =
      feature?.layer.id === "link-lines" && feature.properties ? String(feature.properties.id ?? "") : "";
    if (!id) return;
    setSelectedLinkId(id);
  };

  if (!webglAvailable) {
    return (
      <div className="map-panel map-fallback">
        <h3>Map unavailable</h3>
        <p>WebGL is required for map rendering. The rest of the analysis tools remain available.</p>
      </div>
    );
  }

  return (
    <div className="map-panel">
      <div className="map-controls">
        <button className="map-control-btn" onClick={onToggleMapExpanded} type="button">
          {isMapExpanded ? "Show UI" : "Expand"}
        </button>
        <button className="map-control-btn" onClick={fitToNodes} type="button">
          Fit
        </button>
        <button
          className={`map-control-btn ${coverageVizMode === "heatmap" ? "is-selected" : ""}`}
          onClick={() => setCoverageVizMode("heatmap")}
          title="Coverage as continuous heatmap"
          type="button"
        >
          Heat
        </button>
        <button
          className={`map-control-btn ${coverageVizMode === "contours" ? "is-selected" : ""}`}
          onClick={() => setCoverageVizMode("contours")}
          title="Coverage as contour-like bands"
          type="button"
        >
          Bands
        </button>
        <button
          className="map-control-btn"
          onClick={() =>
            setBandStepMode((current) => {
              const order: BandStepMode[] = ["auto", 3, 5, 8, 10];
              const idx = order.indexOf(current);
              return order[(idx + 1) % order.length];
            })
          }
          title="Band step size: Auto / 3 / 5 / 8 / 10 dB"
          type="button"
        >
          Step {bandStepMode === "auto" ? `Auto(${currentBandStepDb})` : `${bandStepMode}dB`}
        </button>
        <button
          className={`map-control-btn ${coverageResolutionMode === "high" ? "is-selected" : ""}`}
          onClick={() => setCoverageResolutionMode(coverageResolutionMode === "high" ? "auto" : "high")}
          title="Toggle high resolution rendering"
          type="button"
        >
          {coverageResolutionMode === "high" ? "HQ On" : "Render HQ"}
        </button>
        <button
          className={`map-control-btn ${coverageVizMode === "passfail" ? "is-selected" : ""}`}
          onClick={() => setCoverageVizMode("passfail")}
          title="Coverage pass/fail against RX target"
          type="button"
        >
          Pass/Fail
        </button>
        <button className="map-control-btn" onClick={() => zoomBy(1)} type="button">
          +
        </button>
        <button className="map-control-btn" onClick={() => zoomBy(-1)} type="button">
          -
        </button>
      </div>
      {isSimulationRecomputing ? (
        <div className="map-progress" aria-live="polite" aria-label="Simulation recalculation progress">
          <div className="map-progress-label">Recalculating simulation... {simulationProgress}%</div>
          <div className="map-progress-track">
            <div className="map-progress-fill" style={{ width: `${simulationProgress}%` }} />
          </div>
        </div>
      ) : null}
      {!hasSimulationTerrain ? <div className="map-control-note">No SRTM loaded: simulation uses site elevations only.</div> : null}
      <aside className="map-sim-summary" aria-live="polite">
        <h3>Simulation Sources</h3>
        <p>
          Model: {propagationModel} / {selectedCoverageMode} / View: {coverageVizMode}
        </p>
        <p>
          Network: {selectedNetwork?.name ?? "n/a"} @{" "}
          {(selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 0).toFixed(3)} MHz
        </p>
        <p>
          Terrain dataset: {terrainDataset.toUpperCase()} ({selectedDatasetTileCount} matching tile
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
          <p>Terrain source: scenario/manual site elevations only</p>
        )}
        <p>
          Site elevations: {hasOnlineElevationSync ? "Open-Meteo sync + scenario values" : "Scenario values"}
        </p>
        <p>
          Resolution: {coverageResolutionMode === "high" ? "High quality" : "Auto"} ({overlayDimensions.width}x
          {overlayDimensions.height})
        </p>
        <p>
          Coverage values are terrain-aware when ITM model is selected and SRTM tiles are loaded.
        </p>
        {coverageVizMode === "contours" ? <p>Band step: {currentBandStepDb} dB ({bandStepMode})</p> : null}
        {coverageVizMode === "passfail" ? (
          <p>Pass/Fail source: {selectedFromSite?.name ?? "n/a"} (selected link transmitter)</p>
        ) : null}
      </aside>
      <Map
        longitude={activeViewState.longitude}
        latitude={activeViewState.latitude}
        zoom={activeViewState.zoom}
        initialViewState={{
          longitude: activeViewState.longitude,
          latitude: activeViewState.latitude,
          zoom: activeViewState.zoom,
        }}
        mapStyle={styleByTheme[theme]}
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
        {simulationTerrainOverlay ? (
          <Source
            coordinates={simulationTerrainOverlay.coordinates}
            id="terrain-overlay-source"
            type="image"
            url={simulationTerrainOverlay.url}
          >
            <Layer {...terrainLayer} />
          </Source>
        ) : null}

        <Source data={profileFeatures} id="profile-path" type="geojson">
          <Layer {...profileLineLayer} />
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
          <Layer {...mapLineLayer} />
        </Source>

        {sites.map((site) => (
          <Marker
            anchor="bottom"
            draggable
            key={site.id}
            latitude={site.position.lat}
            longitude={site.position.lon}
            onDragEnd={(event) => onSiteDragEnd(site.id, event)}
          >
            <div
              className={`site-pin ${site.id === selectedSiteId ? "is-selected" : ""}`}
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
        ))}

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
