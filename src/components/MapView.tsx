import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
import { computeCoverageGridDimensions } from "../lib/coverage";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { sampleSrtmElevation } from "../lib/srtm";
import { getUiErrorMessage } from "../lib/uiError";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { getBasemapProviderCapabilities, getCartoFallbackStyle, resolveBasemapSelection } from "../lib/basemaps";
import {
  PROFILE_DRAFT_SITE_REQUEST_EVENT,
  type ProfileDraftSiteRequestDetail,
} from "../lib/profileDraftEvent";
import { subscribePanoramaInteraction, type PanoramaFocusPoint, type PanoramaInteractionEvent } from "../lib/panoramaEvents";
import { useAppStore } from "../store/appStore";
import { useCoverageStore } from "../store/coverageStore";
import { TERRAIN_DATASET_LABEL } from "../lib/terrainDataset";
import type { Link, Site } from "../types/radio";
import { fetchMeshmapNodes, type MeshmapNode } from "../lib/meshtasticMqtt";
import { canShowSaveSelectedLinkAction } from "../lib/selectedPairActions";
import {
  optionsForSelectionCount,
  resolveEffectiveOverlayRadiusKm,
  resolveLoadedOverlayRadiusCapKm,
  resolveOverlayRadiusOptionForSelectionTransition,
  resolveTargetOverlayRadiusKm,
  type SimulationOverlayRadiusOption,
} from "../lib/simulationOverlayRadius";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { tilesForBounds } from "../lib/terrainTiles";
import {
  buildCoverageOverlayPixelsAsync,
  buildRelayCandidateOverlayPixelsAsync,
  buildSourcePassFailOverlayPixelsAsync,
  buildTerrainShadeOverlayPixelsAsync,
  overlayPixelsToDataUrl,
  OverlayTaskCancelledError,
  type OverlayRasterPixels,
} from "../lib/overlayRaster";
import { overlayTaskBudgetForMode } from "../lib/overlayTaskBudget";
import {
  recordSimulationOverlayPerf,
  recordSimulationRunCancelled,
} from "../lib/simulationPerf";
import { resolveSimulationBusyIndicatorState } from "../lib/simulationBusyIndicator";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "../lib/latestOnlyTaskScheduler";
import { createLruCache } from "../lib/lruCache";
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

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

const updateFvnHash = (hash: number, value: number): number => {
  const next = hash ^ (value & 0xff_ff_ff_ff);
  return Math.imul(next, FNV_PRIME) >>> 0;
};

const roundHashValue = (value: number, factor = 10_000): number =>
  Number.isFinite(value) ? Math.round(value * factor) : 0;

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

const panoramaRayLayer = (color: string): LayerProps => ({
  id: "panorama-ray-line",
  type: "line",
  paint: {
    "line-color": color,
    "line-width": 2.8,
    "line-opacity": 0.88,
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

const computeOverlayDimensions = (
  bounds: TerrainBounds,
  targetGridSize: number,
  resolutionScale = 1,
): { width: number; height: number } => {
  const { rows, cols } = computeCoverageGridDimensions(targetGridSize, bounds, 1);
  // Match the historical visual baseline (~100k display pixels at 24x24 samples)
  // while keeping display density proportional to simulation sample density.
  const targetDisplayPixelsPerSample = 174;
  const displaySupersample = Math.sqrt(targetDisplayPixelsPerSample);
  const scaledWidth = Math.round(cols * resolutionScale * displaySupersample);
  const scaledHeight = Math.round(rows * resolutionScale * displaySupersample);
  return {
    width: clamp(scaledWidth, 8, 1400),
    height: clamp(scaledHeight, 8, 1400),
  };
};

const kmToLatDegrees = (km: number): number => km / 111.32;
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
  fitRadiusKm = 20,
): [[number, number], [number, number]] | null => {
  if (!sites.length) return null;
  const lats = sites.map((s) => s.position.lat);
  const lons = sites.map((s) => s.position.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const latPad = kmToLatDegrees(Math.max(1, fitRadiusKm));
  // Scale lon padding by 1/cos(lat) so the geographic margin is uniform in km.
  const lonPad = latPad / Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  return [
    [Math.min(...lons) - lonPad, Math.min(...lats) - latPad],
    [Math.max(...lons) + lonPad, Math.max(...lats) + latPad],
  ];
};

type MapViewProps = {
  isMapExpanded: boolean;
  showInspector?: boolean;
  inspectorPanelClassName?: string;
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
  /** Pixel insets reserved for map-internal chrome when fitting bounds. */
  fitChromePadding?: { top: number; right: number; bottom: number; left: number };
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

type PanoramaInteractionState = {
  siteId: string;
  hover: PanoramaFocusPoint | null;
  locked: PanoramaFocusPoint | null;
};

const DEFAULT_MAP_VIEWPORT = {
  center: { lat: 59.9, lon: 10.75 },
  zoom: 8,
};

export function MapView({
  isMapExpanded,
  showInspector = true,
  inspectorPanelClassName,
  showMultiSelectToggle = false,
  readOnly = false,
  canPersist = true,
  onToggleMapExpanded,
  inspectorHeaderActions,
  notice,
  fitBottomInset = 30,
  fitChromePadding = FIT_CHROME_PADDING,
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
  const terrainLoadEpoch = useAppStore((state) => state.terrainLoadEpoch);
  const terrainFetchStatus = useAppStore((state) => state.terrainFetchStatus);
  const terrainLoadingStartedAtMs = useAppStore((state) => state.terrainLoadingStartedAtMs);
  const terrainProgressPercent = useAppStore((state) => state.terrainProgressPercent);
  const terrainProgressTilesLoaded = useAppStore((state) => state.terrainProgressTilesLoaded);
  const terrainProgressTilesTotal = useAppStore((state) => state.terrainProgressTilesTotal);
  const terrainProgressBytesLoaded = useAppStore((state) => state.terrainProgressBytesLoaded);
  const terrainProgressBytesEstimated = useAppStore((state) => state.terrainProgressBytesEstimated);
  const terrainProgressTransientDecodeBytesEstimated = useAppStore(
    (state) => state.terrainProgressTransientDecodeBytesEstimated,
  );
  const terrainProgressPhaseLabel = useAppStore((state) => state.terrainProgressPhaseLabel);
  const terrainProgressPhaseIndex = useAppStore((state) => state.terrainProgressPhaseIndex);
  const terrainProgressPhaseTotal = useAppStore((state) => state.terrainProgressPhaseTotal);
  const terrainMemoryDiagnostics = useAppStore((state) => state.terrainMemoryDiagnostics);
  const propagationModel = useAppStore((state) => state.propagationModel);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const networks = useAppStore((state) => state.networks);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const isSimulationRecomputing = useCoverageStore((state) => state.isSimulationRecomputing);
  const simulationProgress = useCoverageStore((state) => state.simulationProgress);
  const simulationProgressMode = useCoverageStore((state) => state.simulationProgressMode);
  const simulationStepLabel = useCoverageStore((state) => state.simulationStepLabel);
  const simulationRunToken = useCoverageStore((state) => state.simulationRunToken);
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
  const setDiscoveryVisibility = useAppStore((state) => state.setDiscoveryVisibility);
  const setMapDiscoveryMqttNodes = useAppStore((state) => state.setMapDiscoveryMqttNodes);
  const recommendAndFetchTerrainForCurrentArea = useAppStore((state) => state.recommendAndFetchTerrainForCurrentArea);
  const selectedOverlayRadiusOption = useAppStore((state) => state.selectedOverlayRadiusOption);
  const setSelectedOverlayRadiusOption = useAppStore((state) => state.setSelectedOverlayRadiusOption);
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
  const [panoramaInteraction, setPanoramaInteraction] = useState<PanoramaInteractionState | null>(null);
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
  const panoramaLensBaseViewRef = useRef<{
    center: { lat: number; lon: number };
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>(null);

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

  useEffect(() => {
    setDiscoveryVisibility({ libraryVisible: showDiscoverySites, mqttVisible: showDiscoveryMqtt });
  }, [showDiscoverySites, showDiscoveryMqtt, setDiscoveryVisibility]);

  useEffect(() => {
    setMapDiscoveryMqttNodes(mqttNodes);
  }, [mqttNodes, setMapDiscoveryMqttNodes]);

  useEffect(() => {
    const unsubscribe = subscribePanoramaInteraction((event: PanoramaInteractionEvent) => {
      setPanoramaInteraction((current) => {
        if (event.type === "clear") {
          if (!current || current.siteId !== event.siteId) return current;
          return { ...current, hover: null, locked: null };
        }
        if (event.type === "leave") {
          if (!current || current.siteId !== event.siteId) return current;
          return { ...current, hover: null };
        }
        if (event.type === "hover") {
          if (!current || current.siteId !== event.payload.siteId) {
            return { siteId: event.payload.siteId, hover: event.payload, locked: null };
          }
          if (current.locked) return current;
          return { ...current, hover: event.payload };
        }
        if (!current || current.siteId !== event.payload.siteId) {
          return { siteId: event.payload.siteId, hover: null, locked: event.payload };
        }
        const unlock =
          current.locked &&
          Math.abs(current.locked.azimuthDeg - event.payload.azimuthDeg) < 0.01;
        return {
          ...current,
          locked: unlock ? null : event.payload,
          hover: unlock ? current.hover : null,
        };
      });
    });
    return unsubscribe;
  }, []);

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
  const singleSelectedSite = selectionCount === 1 ? selectedSites[0] ?? null : null;
  const previousSelectionCountRef = useRef(selectionCount);
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

  useEffect(() => {
    if (!singleSelectedSite) {
      setPanoramaInteraction(null);
      return;
    }
    setPanoramaInteraction((current) => {
      if (!current) return current;
      if (current.siteId === singleSelectedSite.id) return current;
      return null;
    });
  }, [singleSelectedSite?.id]);

  const activePanoramaFocus = panoramaInteraction?.locked ?? panoramaInteraction?.hover ?? null;
  const panoramaHoverLensEnabled = Boolean(activePanoramaFocus?.mapHoverZoomEnabled);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (
      !singleSelectedSite ||
      !activePanoramaFocus ||
      activePanoramaFocus.siteId !== singleSelectedSite.id ||
      !panoramaHoverLensEnabled
    ) {
      const previous = panoramaLensBaseViewRef.current;
      if (previous) {
        map.easeTo({
          center: [previous.center.lon, previous.center.lat],
          zoom: previous.zoom,
          bearing: previous.bearing,
          pitch: previous.pitch,
          duration: 260,
          essential: true,
        });
      }
      panoramaLensBaseViewRef.current = null;
      return;
    }

    if (!panoramaLensBaseViewRef.current) {
      const center = map.getCenter();
      panoramaLensBaseViewRef.current = {
        center: { lat: center.lat, lon: center.lng },
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    }
    const baseZoom = panoramaLensBaseViewRef.current?.zoom ?? map.getZoom();
    map.easeTo({
      center: [activePanoramaFocus.endpoint.lon, activePanoramaFocus.endpoint.lat],
      zoom: Math.max(2.8, Math.min(13, baseZoom - 0.8)),
      duration: 220,
      essential: true,
    });
  }, [
    singleSelectedSite?.id,
    singleSelectedSite?.position.lat,
    singleSelectedSite?.position.lon,
    activePanoramaFocus?.siteId,
    activePanoramaFocus?.endpoint.lat,
    activePanoramaFocus?.endpoint.lon,
    panoramaHoverLensEnabled,
  ]);
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
  useEffect(() => {
    const previousSelectionCount = previousSelectionCountRef.current;
    previousSelectionCountRef.current = selectionCount;
    const nextOption = resolveOverlayRadiusOptionForSelectionTransition({
      previousSelectionCount,
      selectionCount,
      option: selectedOverlayRadiusOption,
    });
    if (nextOption !== selectedOverlayRadiusOption) {
      setSelectedOverlayRadiusOption(nextOption);
    }
  }, [selectionCount, selectedOverlayRadiusOption, setSelectedOverlayRadiusOption]);

  const hasPassFailTopology = selectionCount >= 1;
  const hasRelayTopology = selectionCount >= 2;
  const hasMinimumTopology = sites.length >= 1;
  const analysisTargetSites = selectionCount === 1 ? selectedSites : sites;
  const normalizedOverlayRadiusOption = resolveOverlayRadiusOptionForSelectionTransition({
    previousSelectionCount: selectionCount,
    selectionCount,
    option: selectedOverlayRadiusOption,
  });
  const targetRadiusKm = useMemo(
    () => resolveTargetOverlayRadiusKm(selectionCount, normalizedOverlayRadiusOption),
    [selectionCount, normalizedOverlayRadiusOption],
  );
  const loadedRadiusCapKm = useMemo(
    () => resolveLoadedOverlayRadiusCapKm(analysisTargetSites, targetRadiusKm, srtmTiles, 20),
    [analysisTargetSites, targetRadiusKm, srtmTiles],
  );
  const overlayRadiusKm = useMemo(
    () =>
      Math.min(
        targetRadiusKm,
        Math.min(
          loadedRadiusCapKm,
          resolveEffectiveOverlayRadiusKm({
            selectionCount,
            option: normalizedOverlayRadiusOption,
            selectedSingleSite: selectionCount === 1 ? selectedSites[0] ?? null : null,
            srtmTiles,
            isTerrainFetching,
          }),
        ),
      ),
    [
      targetRadiusKm,
      normalizedOverlayRadiusOption,
      loadedRadiusCapKm,
      selectionCount,
      selectedSites,
      srtmTiles,
      isTerrainFetching,
    ],
  );
  const overlayRadiusOptions = optionsForSelectionCount(selectionCount);
  const loaded30mTileKeys = useMemo(
    () => new Set(srtmTiles.filter((tile) => tile.sourceId === "copernicus30").map((tile) => tile.key)),
    [srtmTiles],
  );
  const targetRadiusBounds = useMemo(
    () => simulationAreaBoundsForSites(analysisTargetSites, { overlayRadiusKm: targetRadiusKm }),
    [analysisTargetSites, targetRadiusKm],
  );
  const requiredTargetRadiusTileKeys = useMemo(
    () =>
      targetRadiusBounds
        ? tilesForBounds(
            targetRadiusBounds.minLat,
            targetRadiusBounds.maxLat,
            targetRadiusBounds.minLon,
            targetRadiusBounds.maxLon,
          )
        : [],
    [targetRadiusBounds],
  );
  const missingTargetRadiusTileCount = useMemo(
    () => requiredTargetRadiusTileKeys.filter((key) => !loaded30mTileKeys.has(key)).length,
    [requiredTargetRadiusTileKeys, loaded30mTileKeys],
  );
  const targetRadiusTerrainSignature = `${targetRadiusKm}|${requiredTargetRadiusTileKeys.join(",")}`;
  const targetRadiusFetchAttemptRef = useRef("");
  useEffect(() => {
    if (coverageVizMode === "none") {
      targetRadiusFetchAttemptRef.current = "";
      return;
    }
    if (!analysisTargetSites.length || missingTargetRadiusTileCount <= 0) {
      targetRadiusFetchAttemptRef.current = "";
      return;
    }
    if (isTerrainFetching || isTerrainRecommending) return;
    if (targetRadiusFetchAttemptRef.current === targetRadiusTerrainSignature) return;
    targetRadiusFetchAttemptRef.current = targetRadiusTerrainSignature;
    void recommendAndFetchTerrainForCurrentArea(targetRadiusKm);
  }, [
    coverageVizMode,
    analysisTargetSites.length,
    missingTargetRadiusTileCount,
    isTerrainFetching,
    isTerrainRecommending,
    normalizedOverlayRadiusOption,
    targetRadiusTerrainSignature,
    recommendAndFetchTerrainForCurrentArea,
    targetRadiusKm,
  ]);
  const overlayMaskArea = useMemo(
    () => buildBufferedSelectionArea(analysisTargetSites, overlayRadiusKm),
    [analysisTargetSites, overlayRadiusKm],
  );
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

  const panoramaRayFeatures = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        selectionCount === 1 &&
        singleSelectedSite &&
        activePanoramaFocus &&
        activePanoramaFocus.siteId === singleSelectedSite.id
          ? [
              {
                type: "Feature" as const,
                properties: { id: "panorama-ray" },
                geometry: {
                  type: "LineString" as const,
                  coordinates: [
                    [singleSelectedSite.position.lon, singleSelectedSite.position.lat],
                    [activePanoramaFocus.endpoint.lon, activePanoramaFocus.endpoint.lat],
                  ],
                },
              },
            ]
          : [],
    }),
    [selectionCount, singleSelectedSite, activePanoramaFocus],
  );

  const overlayResolutionScale = useMemo(() => {
    if (analysisBoundsDiagonalKm > 600) return 0.52;
    if (analysisBoundsDiagonalKm > 400) return 0.64;
    if (analysisBoundsDiagonalKm > 250) return 0.76;
    return 1;
  }, [analysisBoundsDiagonalKm]);
  const largeAreaOptimizationActive = overlayResolutionScale < 1;

  // During a site drag, force low-res (24) to keep overlay recomputations cheap.
  // During simulation recompute, keep using the last completed grid size to avoid
  // blocking the UI while a higher-resolution recompute is still preparing.
  const selectedGridSize = Number(selectedCoverageResolution);
  const [lastCompletedGridSize, setLastCompletedGridSize] = useState(24);
  useEffect(() => {
    if (isSimulationRecomputing) return;
    if (!Number.isFinite(selectedGridSize) || selectedGridSize < 24) return;
    setLastCompletedGridSize(selectedGridSize);
  }, [isSimulationRecomputing, selectedGridSize]);
  const effectiveGridSize =
    isDraggingSite || !Number.isFinite(selectedGridSize) || selectedGridSize < 24
      ? 24
      : isTerrainFetching
        ? 24
      : isSimulationRecomputing
        ? lastCompletedGridSize
        : selectedGridSize;

  const overlayDimensions = useMemo(() => {
    const bounds = analysisBounds ?? computeCoverageBounds(samplesForOverlay);
    if (!bounds) return { width: 24, height: 24 };
    return computeOverlayDimensions(bounds, effectiveGridSize, overlayResolutionScale);
  }, [analysisBounds, samplesForOverlay, effectiveGridSize, overlayResolutionScale]);

  const overlayBounds = useMemo(() => analysisBounds ?? computeCoverageBounds(samplesForOverlay), [analysisBounds, samplesForOverlay]);
  const resolutionOptionLabels = useMemo(() => {
    const options = [
      { gridSize: 24, name: "1x" },
      { gridSize: 42, name: "2x" },
      { gridSize: 84, name: "4x" },
      { gridSize: 168, name: "8x" },
    ] as const;
    return options.map(({ gridSize, name }) => {
      const fallback = { rows: gridSize, cols: gridSize, totalSamples: gridSize * gridSize };
      const dims = overlayBounds ? computeCoverageGridDimensions(gridSize, overlayBounds, 1) : fallback;
      const isDefault = gridSize === 24;
      return {
        value: String(gridSize) as "24" | "42" | "84" | "168",
        label: `${name} (${dims.rows}x${dims.cols}, ${dims.totalSamples} samples)${isDefault ? " - Default" : ""}`,
      };
    });
  }, [overlayBounds]);
  const effectiveBandStepDb = useMemo(() => {
    if (!overlayBounds) return 5;
    return bandStepMode === "auto" ? autoBandStepDb(samplesForOverlay, overlayBounds) : bandStepMode;
  }, [overlayBounds, samplesForOverlay, bandStepMode]);
  const overlayLongTaskWarnedRef = useRef<Set<string>>(new Set());
  const showOverlayDiagnostics =
    import.meta.env.DEV || (typeof window !== "undefined" && window.location.hostname === "localhost");
  const coverageOverlaySchedulerRef = useRef<ReturnType<typeof createLatestOnlyTaskScheduler> | null>(null);
  const terrainOverlaySchedulerRef = useRef<ReturnType<typeof createLatestOnlyTaskScheduler> | null>(null);
  if (!coverageOverlaySchedulerRef.current) {
    coverageOverlaySchedulerRef.current = createLatestOnlyTaskScheduler();
  }
  if (!terrainOverlaySchedulerRef.current) {
    terrainOverlaySchedulerRef.current = createLatestOnlyTaskScheduler();
  }
  const coverageOverlayRunCounterRef = useRef(0);
  const terrainOverlayRunCounterRef = useRef(0);
  const latestCoverageRunTokenRef = useRef("");
  const coverageOverlayCacheRef = useRef(
    createLruCache<OverlayRaster & { minDbm?: number; maxDbm?: number }>(4),
  );
  const terrainOverlayCacheRef = useRef(createLruCache<OverlayRaster>(3));
  const [overlayJobsInFlight, setOverlayJobsInFlight] = useState(0);
  const [overlayProgressMode, setOverlayProgressMode] = useState<"determinate" | "indeterminate">("indeterminate");
  const [overlayProgressPercent, setOverlayProgressPercent] = useState<number | null>(null);
  const overlayProgressByPipelineRef = useRef<{ coverage: number | null; terrain: number | null }>({
    coverage: null,
    terrain: null,
  });
  const syncOverlayProgressState = useCallback(() => {
    const coverageProgress = overlayProgressByPipelineRef.current.coverage;
    const terrainProgress = overlayProgressByPipelineRef.current.terrain;
    const numeric = [coverageProgress, terrainProgress].filter((value): value is number => typeof value === "number");
    if (!numeric.length) {
      setOverlayProgressMode("indeterminate");
      setOverlayProgressPercent(null);
      return;
    }
    setOverlayProgressMode("determinate");
    setOverlayProgressPercent(Math.max(...numeric));
  }, []);
  const setOverlayPipelineProgress = useCallback(
    (pipeline: "coverage" | "terrain", percent: number | null) => {
      const normalized =
        typeof percent === "number" && Number.isFinite(percent)
          ? Math.max(0, Math.min(100, Math.round(percent)))
          : null;
      if (overlayProgressByPipelineRef.current[pipeline] === normalized) return;
      overlayProgressByPipelineRef.current[pipeline] = normalized;
      syncOverlayProgressState();
    },
    [syncOverlayProgressState],
  );
  const beginOverlayJob = useCallback((pipeline: "coverage" | "terrain") => {
    let finished = false;
    setOverlayJobsInFlight((count) => count + 1);
    setOverlayPipelineProgress(pipeline, null);
    return () => {
      if (finished) return;
      finished = true;
      setOverlayJobsInFlight((count) => Math.max(0, count - 1));
      setOverlayPipelineProgress(pipeline, null);
    };
  }, [setOverlayPipelineProgress]);
  const [coverageOverlay, setCoverageOverlay] = useState<(OverlayRaster & { minDbm?: number; maxDbm?: number }) | null>(null);
  const [simulationTerrainOverlay, setSimulationTerrainOverlay] = useState<OverlayRaster | null>(null);

  const logOverlaySchedulerEvent = useCallback(
    (
      pipeline: "coverage" | "terrain",
      event: "queued" | "deduped-active" | "deduped-queued" | "cache-hit" | "started",
      signature: string,
      extra?: Record<string, unknown>,
    ) => {
      if (!showOverlayDiagnostics) return;
      console.info("[simulation-overlay-scheduler]", {
        pipeline,
        event,
        signature,
        ...(extra ?? {}),
      });
    },
    [showOverlayDiagnostics],
  );

  useEffect(() => {
    if (simulationRunToken) {
      latestCoverageRunTokenRef.current = simulationRunToken;
      return;
    }
    if (!isSimulationRecomputing) {
      latestCoverageRunTokenRef.current = "";
    }
  }, [simulationRunToken, isSimulationRecomputing]);

  useEffect(() => {
    return () => {
      coverageOverlaySchedulerRef.current?.dispose();
      terrainOverlaySchedulerRef.current?.dispose();
    };
  }, []);

  const overlaySampleDigest = useMemo(() => {
    let hash = FNV_OFFSET_BASIS;
    for (const sample of samplesForOverlay) {
      hash = updateFvnHash(hash, roundHashValue(sample.lat, 100_000));
      hash = updateFvnHash(hash, roundHashValue(sample.lon, 100_000));
      hash = updateFvnHash(hash, roundHashValue(sample.valueDbm, 10));
    }
    return hash.toString(16);
  }, [samplesForOverlay]);
  const propagationEnvironmentDigest = useMemo(
    () =>
      [
        propagationEnvironment.clutterHeightM,
        propagationEnvironment.polarization,
        propagationEnvironment.groundDielectric,
        propagationEnvironment.groundConductivity,
        propagationEnvironment.radioClimate,
        propagationEnvironment.atmosphericBendingNUnits,
      ]
        .map((value) => String(value ?? ""))
        .join(":"),
    [propagationEnvironment],
  );
  const selectedSiteDigest = useMemo(() => selectedSiteIds.join(","), [selectedSiteIds]);

  useEffect(() => {
    const scheduler = coverageOverlaySchedulerRef.current!;
    const cancelCoveragePipeline = (clearOverlay: boolean) => {
      scheduler.clearQueue();
      scheduler.cancelActive();
      setOverlayPipelineProgress("coverage", null);
      if (clearOverlay) setCoverageOverlay(null);
    };

    if (coverageVizMode === "none") {
      cancelCoveragePipeline(true);
      return;
    }
    if (!overlayBounds) {
      cancelCoveragePipeline(true);
      return;
    }

    const mode = coverageVizMode;
    if (mode === "passfail" && (!activeSelectionLink || !selectedFromSite || !hasPassFailTopology)) {
      cancelCoveragePipeline(true);
      return;
    }
    if (mode === "relay" && (!activeSelectionLink || !selectedFromSite || !selectedToSite || !hasRelayTopology)) {
      cancelCoveragePipeline(true);
      return;
    }

    const signature = [
      mode,
      overlayBounds.minLat.toFixed(5),
      overlayBounds.maxLat.toFixed(5),
      overlayBounds.minLon.toFixed(5),
      overlayBounds.maxLon.toFixed(5),
      overlayDimensions.width,
      overlayDimensions.height,
      effectiveBandStepDb,
      samplesForOverlay.length,
      overlaySampleDigest,
      srtmTiles.length,
      terrainLoadEpoch,
      effectiveGridSize,
      overlayRadiusKm,
      activeSelectionLink?.id ?? "",
      selectedFromSite?.id ?? "",
      selectedToSite?.id ?? "",
      propagationEnvironmentDigest,
      rxSensitivityTargetDbm,
      environmentLossDb,
      selectedSiteDigest,
    ].join("|");
    const cached = coverageOverlayCacheRef.current.get(signature);
    if (cached) {
      scheduler.clearQueue();
      scheduler.cancelActive();
      setOverlayPipelineProgress("coverage", null);
      logOverlaySchedulerEvent("coverage", "cache-hit", signature);
      setCoverageOverlay(cached);
      return;
    }

    const enqueueResult = scheduler.enqueue({
      signature,
      run: async (taskContext) => {
        const endOverlayJob = beginOverlayJob("coverage");
        const taskBudget = overlayTaskBudgetForMode(mode);
        coverageOverlayRunCounterRef.current += 1;
        const perfRunId =
          latestCoverageRunTokenRef.current || `overlay:${mode}:${coverageOverlayRunCounterRef.current}`;
        const overlayBuildStartedAt = performance.now();
        let lastReportedProgress = -2;

        const onLongTask = (payload: {
          phase: string;
          signature: string;
          durationMs: number;
          processed: number;
          total: number;
        }) => {
          if (!showOverlayDiagnostics) return;
          const warnKey = `${payload.phase}|${payload.signature}`;
          const warned = overlayLongTaskWarnedRef.current;
          if (warned.has(warnKey)) return;
          warned.add(warnKey);
          if (warned.size > 80) warned.clear();
          console.warn("[simulation-long-task]", {
            scope: "overlay",
            ...payload,
          });
        };

        const onProgress = (payload: { percent: number }) => {
          if (taskContext.isCancelled()) return;
          if (payload.percent < 100 && payload.percent - lastReportedProgress < 2) return;
          lastReportedProgress = payload.percent;
          setOverlayPipelineProgress("coverage", payload.percent);
        };

        const terrainSampler = (lat: number, lon: number) => sampleSrtmElevation(srtmTiles, lat, lon);

        try {
          const context = {
            phase: mode,
            signature,
            frameBudgetMs: taskBudget.frameBudgetMs,
            longTaskMs: taskBudget.longTaskMs,
            shouldCancel: taskContext.isCancelled,
            onLongTask,
            onProgress,
          } as const;
          let rasterPixels: OverlayRasterPixels | null = null;
          if (mode === "heatmap" || mode === "contours") {
            rasterPixels = await buildCoverageOverlayPixelsAsync(
              overlayBounds,
              samplesForOverlay,
              mode,
              effectiveBandStepDb,
              overlayDimensions,
              overlayPointMask,
              terrainSampler,
              context,
            );
          } else if (mode === "passfail") {
            const receiverAntennaHeightM = selectedToSite?.antennaHeightM ?? selectedFromSite!.antennaHeightM ?? 2;
            const receiverRxGainDbi =
              selectedToSite?.rxGainDbi ?? selectedFromSite!.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi;
            rasterPixels = await buildSourcePassFailOverlayPixelsAsync(
              overlayBounds,
              selectedFromSite!,
              activeSelectionLink!,
              receiverAntennaHeightM,
              receiverRxGainDbi,
              propagationEnvironment,
              rxSensitivityTargetDbm,
              environmentLossDb,
              terrainSampler,
              overlayDimensions,
              effectiveGridSize,
              overlayPointMask,
              context,
            );
          } else if (mode === "relay") {
            rasterPixels = await buildRelayCandidateOverlayPixelsAsync(
              overlayBounds,
              selectedFromSite!,
              selectedToSite!,
              activeSelectionLink!,
              propagationEnvironment,
              environmentLossDb,
              terrainSampler,
              overlayDimensions,
              effectiveGridSize,
              overlayPointMask,
              context,
            );
          }

          const overlayBuildCompletedAt = performance.now();
          if (taskContext.isCancelled()) {
            recordSimulationRunCancelled({
              runId: perfRunId,
              phase: "overlay",
              reason: "token-mismatch-after-build",
              signature,
              mode,
            });
            return;
          }
          if (!rasterPixels) {
            setCoverageOverlay(null);
            return;
          }
          const raster = overlayPixelsToDataUrl(rasterPixels);
          const overlayEncodeCompletedAt = performance.now();
          if (taskContext.isCancelled()) {
            recordSimulationRunCancelled({
              runId: perfRunId,
              phase: "overlay",
              reason: "token-mismatch-after-encode",
              signature,
              mode,
            });
            return;
          }
          recordSimulationOverlayPerf({
            runId: perfRunId,
            mode,
            buildDurationMs: overlayBuildCompletedAt - overlayBuildStartedAt,
            encodeDurationMs: overlayEncodeCompletedAt - overlayBuildCompletedAt,
            width: rasterPixels.width,
            height: rasterPixels.height,
            pixelCount: rasterPixels.width * rasterPixels.height,
            gridSize: effectiveGridSize,
            effectiveRadiusKm: overlayRadiusKm,
          });
          const overlayValue = raster ? { ...raster } : null;
          if (overlayValue) {
            coverageOverlayCacheRef.current.set(signature, overlayValue);
          }
          setOverlayPipelineProgress("coverage", 100);
          setCoverageOverlay(overlayValue);
        } catch (error) {
          if (error instanceof OverlayTaskCancelledError) {
            recordSimulationRunCancelled({
              runId: perfRunId,
              phase: "overlay",
              reason: "overlay-task-cancelled-error",
              signature,
              mode,
            });
            return;
          }
          console.error("Failed to render simulation overlay", error);
        } finally {
          endOverlayJob();
        }
      },
    } satisfies LatestOnlyTask);
    if (enqueueResult !== "started") {
      logOverlaySchedulerEvent("coverage", enqueueResult, signature, {
        activeMode: mode,
      });
      return;
    }
    logOverlaySchedulerEvent("coverage", "started", signature, {
      activeMode: mode,
    });
  }, [
    coverageVizMode,
    overlayBounds,
    activeSelectionLink,
    selectedFromSite,
    selectedToSite,
    hasPassFailTopology,
    hasRelayTopology,
    overlayDimensions,
    overlayPointMask,
    srtmTiles,
    terrainLoadEpoch,
    effectiveBandStepDb,
    samplesForOverlay,
    overlaySampleDigest,
    propagationEnvironment,
    propagationEnvironmentDigest,
    rxSensitivityTargetDbm,
    environmentLossDb,
    effectiveGridSize,
    overlayRadiusKm,
    selectedSiteDigest,
    showOverlayDiagnostics,
    beginOverlayJob,
    setOverlayPipelineProgress,
    logOverlaySchedulerEvent,
  ]);
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

  useEffect(() => {
    const scheduler = terrainOverlaySchedulerRef.current!;
    const cancelTerrainPipeline = (clearOverlay: boolean) => {
      scheduler.clearQueue();
      scheduler.cancelActive();
      setOverlayPipelineProgress("terrain", null);
      if (clearOverlay) setSimulationTerrainOverlay(null);
    };

    if (!showTerrainOverlay || !hasSimulationTerrain || !analysisBounds) {
      cancelTerrainPipeline(true);
      return;
    }

    const signature = [
      "terrain",
      analysisBounds.minLat.toFixed(5),
      analysisBounds.maxLat.toFixed(5),
      analysisBounds.minLon.toFixed(5),
      analysisBounds.maxLon.toFixed(5),
      overlayDimensions.width,
      overlayDimensions.height,
      srtmTiles.length,
      terrainLoadEpoch,
      selectedSiteDigest,
      overlayRadiusKm,
    ].join("|");
    const cached = terrainOverlayCacheRef.current.get(signature);
    if (cached) {
      scheduler.clearQueue();
      scheduler.cancelActive();
      setOverlayPipelineProgress("terrain", null);
      logOverlaySchedulerEvent("terrain", "cache-hit", signature);
      setSimulationTerrainOverlay(cached);
      return;
    }

    const enqueueResult = scheduler.enqueue({
      signature,
      run: async (taskContext) => {
        const endOverlayJob = beginOverlayJob("terrain");
        const taskBudget = overlayTaskBudgetForMode("terrain");
        terrainOverlayRunCounterRef.current += 1;
        const perfRunId =
          latestCoverageRunTokenRef.current || `overlay:terrain:${terrainOverlayRunCounterRef.current}`;
        const overlayBuildStartedAt = performance.now();
        let lastReportedProgress = -2;

        const onLongTask = (payload: {
          phase: string;
          signature: string;
          durationMs: number;
          processed: number;
          total: number;
        }) => {
          if (!showOverlayDiagnostics) return;
          const warnKey = `${payload.phase}|${payload.signature}`;
          const warned = overlayLongTaskWarnedRef.current;
          if (warned.has(warnKey)) return;
          warned.add(warnKey);
          if (warned.size > 80) warned.clear();
          console.warn("[simulation-long-task]", {
            scope: "overlay",
            ...payload,
          });
        };

        const onProgress = (payload: { percent: number }) => {
          if (taskContext.isCancelled()) return;
          if (payload.percent < 100 && payload.percent - lastReportedProgress < 2) return;
          lastReportedProgress = payload.percent;
          setOverlayPipelineProgress("terrain", payload.percent);
        };

        try {
          const rasterPixels = await buildTerrainShadeOverlayPixelsAsync(
            analysisBounds,
            (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
            overlayDimensions,
            overlayPointMask,
            {
              phase: "terrain-shade",
              signature,
              frameBudgetMs: taskBudget.frameBudgetMs,
              longTaskMs: taskBudget.longTaskMs,
              shouldCancel: taskContext.isCancelled,
              onLongTask,
              onProgress,
            },
          );
          const overlayBuildCompletedAt = performance.now();
          if (taskContext.isCancelled()) {
            recordSimulationRunCancelled({
              runId: perfRunId,
              phase: "overlay",
              reason: "token-mismatch-after-build",
              signature,
              mode: "terrain",
            });
            return;
          }
          if (!rasterPixels) {
            setSimulationTerrainOverlay(null);
            return;
          }
          const raster = overlayPixelsToDataUrl(rasterPixels);
          const overlayEncodeCompletedAt = performance.now();
          if (taskContext.isCancelled()) {
            recordSimulationRunCancelled({
              runId: perfRunId,
              phase: "overlay",
              reason: "token-mismatch-after-encode",
              signature,
              mode: "terrain",
            });
            return;
          }
          recordSimulationOverlayPerf({
            runId: perfRunId,
            mode: "terrain",
            buildDurationMs: overlayBuildCompletedAt - overlayBuildStartedAt,
            encodeDurationMs: overlayEncodeCompletedAt - overlayBuildCompletedAt,
            width: rasterPixels.width,
            height: rasterPixels.height,
            pixelCount: rasterPixels.width * rasterPixels.height,
            gridSize: effectiveGridSize,
            effectiveRadiusKm: overlayRadiusKm,
          });
          const overlayValue = raster ? { url: raster.url, coordinates: raster.coordinates } : null;
          if (overlayValue) {
            terrainOverlayCacheRef.current.set(signature, overlayValue);
          }
          setOverlayPipelineProgress("terrain", 100);
          setSimulationTerrainOverlay(overlayValue);
        } catch (error) {
          if (error instanceof OverlayTaskCancelledError) {
            recordSimulationRunCancelled({
              runId: perfRunId,
              phase: "overlay",
              reason: "overlay-task-cancelled-error",
              signature,
              mode: "terrain",
            });
            return;
          }
          console.error("Failed to render terrain overlay", error);
        } finally {
          endOverlayJob();
        }
      },
    } satisfies LatestOnlyTask);
    if (enqueueResult !== "started") {
      logOverlaySchedulerEvent("terrain", enqueueResult, signature);
      return;
    }
    logOverlaySchedulerEvent("terrain", "started", signature);
  }, [
    showTerrainOverlay,
    hasSimulationTerrain,
    analysisBounds,
    srtmTiles,
    terrainLoadEpoch,
    overlayDimensions,
    overlayPointMask,
    selectedSiteDigest,
    effectiveGridSize,
    overlayRadiusKm,
    showOverlayDiagnostics,
    beginOverlayJob,
    setOverlayPipelineProgress,
    logOverlaySchedulerEvent,
  ]);

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
  const terrainPhasePrefix =
    isTerrainFetching && terrainProgressPhaseTotal > 0
      ? `Phase ${Math.max(1, terrainProgressPhaseIndex)}/${terrainProgressPhaseTotal}${
          terrainProgressPhaseLabel ? `: ${terrainProgressPhaseLabel}` : ""
        }`
      : null;
  const terrainProgressLabel =
    isTerrainFetching && hasTerrainDownloadProgress && terrainProgressTilesTotal > 0
      ? `${terrainPhasePrefix ? `${terrainPhasePrefix} — ` : ""}Loading terrain ${terrainProgressPercent}% — ${formatMb(
          terrainProgressBytesLoaded,
        )} of ~${formatMb(
          terrainProgressBytesEstimated || terrainProgressBytesLoaded,
        )} (${terrainProgressTilesLoaded}/${terrainProgressTilesTotal} tiles)`
      : null;
  const terrainPreparingLabel =
    isTerrainFetching && !hasTerrainDownloadProgress
      ? terrainProgressTilesTotal > 0
        ? `${terrainPhasePrefix ? `${terrainPhasePrefix} — ` : ""}Preparing terrain download... (${terrainProgressTilesLoaded}/${terrainProgressTilesTotal} tiles queued)`
        : "Preparing terrain download..."
      : null;
  const backgroundBusyLabel = (isTerrainFetching
    ? terrainProgressLabel || terrainPreparingLabel || terrainFetchStatus || "Loading terrain data..."
    : isTerrainRecommending
      ? terrainFetchStatus || "Checking terrain dataset coverage..."
      : "") + keepWorkingSuffix;
  const simulationBusyIndicator = useMemo(
    () =>
      resolveSimulationBusyIndicatorState({
        isSimulationRecomputing,
        simulationProgressMode,
        simulationStepLabel,
        simulationProgress,
        overlayJobsInFlight,
        overlayProgressMode,
        overlayProgressPercent,
        isBackgroundBusy,
        backgroundBusyLabel,
        isTerrainFetching,
        hasTerrainDownloadProgress,
        terrainProgressPercent,
        terrainProgressTilesTotal,
      }),
    [
      isSimulationRecomputing,
      simulationProgressMode,
      simulationStepLabel,
      simulationProgress,
      overlayJobsInFlight,
      overlayProgressMode,
      overlayProgressPercent,
      isBackgroundBusy,
      backgroundBusyLabel,
      isTerrainFetching,
      hasTerrainDownloadProgress,
      terrainProgressPercent,
      terrainProgressTilesTotal,
    ],
  );
  const showLocalTerrainDiagnostics =
    import.meta.env.DEV || (typeof window !== "undefined" && window.location.hostname === "localhost");
  useEffect(() => {
    if (!showLocalTerrainDiagnostics) return;
    const rawThresholdMb = localStorage.getItem("linksim-dev-terrain-memory-warn-mb");
    const thresholdMb = Number(rawThresholdMb ?? "4096");
    if (!Number.isFinite(thresholdMb) || thresholdMb <= 0) return;
    const retainedMb = terrainMemoryDiagnostics.retainedBytesTotal / (1024 * 1024);
    if (retainedMb < thresholdMb) return;
    console.warn(
      `[terrain-memory] retained decoded terrain is ${retainedMb.toFixed(1)} MB (threshold ${thresholdMb} MB)`,
      terrainMemoryDiagnostics,
    );
  }, [showLocalTerrainDiagnostics, terrainMemoryDiagnostics]);
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
      case "npolar":
        return 18;
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
    computeSiteFitBounds: (fitSites) => computeSiteFitBounds(fitSites, overlayRadiusKm),
    fitChromePadding,
    clamp,
    setInteractionViewState,
    updateMapViewport,
  });
  useEffect(() => {
    if (!fitControlActive || !fitSitesEpoch || !isMapLoaded || !mapRef.current) return;
    const bounds = computeSiteFitBounds(sites, overlayRadiusKm);
    if (!bounds) return;
    mapRef.current.fitBounds(bounds, {
      padding: { ...fitChromePadding, bottom: fitBottomInset },
      animate: true,
      linear: false,
      duration: 900,
      maxZoom: 14,
    });
    setInteractionViewState(null);
  }, [
    fitControlActive,
    fitSitesEpoch,
    isMapLoaded,
    sites,
    overlayRadiusKm,
    fitBottomInset,
    fitChromePadding.left,
    fitChromePadding.right,
    fitChromePadding.top,
    fitChromePadding.bottom,
  ]);
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
        <div className="map-controls-group map-controls-group-utility map-controls-utility-pill ui-surface-pill">
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
        <aside className={`map-inspector ${inspectorPanelClassName ?? ""}`.trim()} aria-live="polite">
          {inspectorHeaderActions ? (
            <div className="map-inspector-header-row">{inspectorHeaderActions}</div>
          ) : null}
          {simulationBusyIndicator ? (
            <div className="map-inspector-section">
              <p className="map-inspector-line">
                {simulationBusyIndicator.label || "Working in background..."}
              </p>
              <div className="map-progress-track">
                {simulationBusyIndicator.progressMode === "determinate" ? (
                  <div className="map-progress-fill" style={{ width: `${simulationBusyIndicator.progressPercent ?? 0}%` }} />
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
                  <span>Simulation Resolution</span>
                  <select
                    className="locale-select"
                    onChange={(event) => setSelectedCoverageResolution(event.target.value as "24" | "42" | "84" | "168")}
                    value={selectedCoverageResolution}
                  >
                    {resolutionOptionLabels.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {coverageVizMode !== "none" && (
                <label className="map-inspector-map-setting">
                  <span>Simulation Radius</span>
                  <select
                    className="locale-select"
                    onChange={(event) =>
                      setSelectedOverlayRadiusOption(event.target.value as SimulationOverlayRadiusOption)}
                    value={normalizedOverlayRadiusOption}
                  >
                    {overlayRadiusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "200" ? "200 km (Slow)" : `${option} km`}
                      </option>
                    ))}
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
            {showLocalTerrainDiagnostics ? (
              <>
                <p>
                  Terrain memory (retained decoded): {formatMb(terrainMemoryDiagnostics.retainedBytesTotal)} [
                  30m {formatMb(terrainMemoryDiagnostics.retainedBytesByDataset.copernicus30)}, 90m{" "}
                  {formatMb(terrainMemoryDiagnostics.retainedBytesByDataset.copernicus90)}, manual{" "}
                  {formatMb(terrainMemoryDiagnostics.retainedBytesByDataset.manual)}]
                </p>
                <p>
                  Terrain tiles by dataset: 30m {terrainMemoryDiagnostics.tileCountsByDataset.copernicus30}, 90m{" "}
                  {terrainMemoryDiagnostics.tileCountsByDataset.copernicus90}, manual{" "}
                  {terrainMemoryDiagnostics.tileCountsByDataset.manual}, other{" "}
                  {terrainMemoryDiagnostics.tileCountsByDataset.other}
                </p>
                <p>
                  Terrain decode overhead (in-flight estimate):{" "}
                  {formatMb(terrainProgressTransientDecodeBytesEstimated)}
                </p>
              </>
            ) : null}
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
        renderWorldCopies={resolvedBasemap.provider !== "kartverket" && resolvedBasemap.provider !== "npolar"}
        initialViewState={{
          longitude: activeViewState.longitude,
          latitude: activeViewState.latitude,
          zoom: activeViewState.zoom,
        }}
        mapStyle={useFallbackMapStyle ? fallbackMapStyle : resolvedBasemap.style}
        onLoad={() => setIsMapLoaded(true)}
        onError={() => {
          if (!useFallbackMapStyle && resolvedBasemap.provider !== "kartverket" && resolvedBasemap.provider !== "npolar") {
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
        <Source data={panoramaRayFeatures} id="panorama-ray-path" type="geojson">
          <Layer {...panoramaRayLayer(profileColor)} />
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
        {selectionCount === 1 && activePanoramaFocus && singleSelectedSite && activePanoramaFocus.siteId === singleSelectedSite.id ? (
          <Marker
            anchor="center"
            latitude={activePanoramaFocus.endpoint.lat}
            longitude={activePanoramaFocus.endpoint.lon}
          >
            <div className="profile-map-cursor panorama-map-cursor" />
          </Marker>
        ) : null}
      </Map>
    </div>
  );
}
