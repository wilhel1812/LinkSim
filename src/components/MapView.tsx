import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Egg, Fullscreen, Layers, Locate, LocateFixed, Maximize2, Minimize2, Play, Rabbit, RefreshCw, Square, SquareStack, ToggleLeft, ToggleRight, ZoomIn, ZoomOut } from "lucide-react";
import { CompactDetails, CompactDetailsSummary } from "./ui/CompactDetails";
import { FloatingPopover } from "./ui/FloatingPopover";
import { MapControlButton } from "./ui/MapControlButton";
import { Surface } from "./ui/Surface";
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
import { buildCoverageTargetContourFeatures } from "../lib/coverageContour";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { sampleSrtmElevation } from "../lib/srtm";
import { getUiErrorMessage } from "../lib/uiError";
import { getSiteIconOption, resolveSiteIconKey } from "../lib/siteIcons";
import { useThemeVariant } from "../hooks/useThemeVariant";
import {
  BASEMAP_CATEGORIES,
  DEFAULT_BASEMAP_STYLE_ID,
  getCategoryForStyleId,
  getCartoFallbackStyle,
  getDefaultStyleIdForCategory,
  getStylesForCategory,
  resolveBasemapSelection,
  type BasemapCategory,
} from "../lib/basemaps";
import {
  PROFILE_DRAFT_SITE_REQUEST_EVENT,
  type ProfileDraftSiteRequestDetail,
} from "../lib/profileDraftEvent";
import { subscribePanoramaInteraction, type PanoramaFocusPoint, type PanoramaInteractionEvent } from "../lib/panoramaEvents";
import { useAppStore } from "../store/appStore";
import { isAutomaticCalculationLocked, useCoverageStore } from "../store/coverageStore";
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
  buildMeshExtensionOverlayPixelsAsync,
  buildRelayCandidateOverlayPixelsAsync,
  buildSourcePassFailOverlayPixelsAsync,
  buildTerrainShadeOverlayPixelsAsync,
  overlayPixelsToDataUrl,
  OverlayTaskCancelledError,
  type OverlayRasterPixels,
} from "../lib/overlayRaster";
import { overlayTaskBudgetForMode } from "../lib/overlayTaskBudget";
import {
  meshExtensionSiteDigest,
  overlayGuideTitleForMode,
  overlayModesForSelectionCount,
  type MapOverlayMode,
} from "../lib/mapOverlayMode";
import {
  recordSimulationOverlayPerf,
  recordSimulationRunCancelled,
} from "../lib/simulationPerf";
import {
  resolveMonotonicOverlayProgress,
  resolveSimulationBusyIndicatorState,
  shouldDeferOverlayRasterization,
} from "../lib/simulationBusyIndicator";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "../lib/latestOnlyTaskScheduler";
import { createLruCache } from "../lib/lruCache";
import { SimulationResultsSection } from "./SimulationResultsSection";
import { ActionButton } from "./ActionButton";
import { StateDot } from "./StateDot";
import { useMapControls } from "./map/useMapControls";
import { animateMapToCenter, fitMapToBounds, resolveMapCameraPadding } from "./map/mapCamera";
import { PanelToolbar } from "./ui/PanelToolbar";
import { SimulationLoadingOverlay } from "./SimulationLoadingOverlay";
import { resolveSimulationOverlayTransition } from "../lib/simulationLoadingOverlay";

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

// Full-world polygon used for the themed basemap color overlay.
const WORLD_POLYGON_GEOJSON = {
  type: "Feature" as const,
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
  },
  properties: {},
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

const panoramaRayLayer = (color: string): LayerProps => ({
  id: "panorama-ray-line",
  type: "line",
  paint: {
    "line-color": color,
    "line-width": 2.8,
    "line-opacity": 0.88,
  },
});

const coverageRasterLayer = (loading: boolean): LayerProps => {
  const transition = resolveSimulationOverlayTransition(loading);
  return {
    id: "coverage-overlay-layer",
    type: "raster",
    paint: {
      "raster-opacity": transition.coverageOpacity,
      "raster-opacity-transition": {
        duration: transition.durationMs,
      },
      "raster-contrast": 0.08,
      "raster-saturation": 0.02,
    },
  };
};

const targetContourHaloLayer = (color: string, loading: boolean): LayerProps => ({
  id: "coverage-target-contour-halo-layer",
  type: "line",
  paint: {
    "line-color": color,
    "line-width": 2.5,
    "line-opacity": loading ? 0 : 0.82,
    "line-opacity-transition": {
      duration: resolveSimulationOverlayTransition(loading).durationMs,
    },
  },
});

const targetContourLineLayer = (color: string, loading: boolean): LayerProps => ({
  id: "coverage-target-contour-line-layer",
  type: "line",
  paint: {
    "line-color": color,
    "line-width": 1.2,
    "line-opacity": loading ? 0 : 0.96,
    "line-opacity-transition": {
      duration: resolveSimulationOverlayTransition(loading).durationMs,
    },
  },
});

const terrainRasterPaint = {
  "raster-opacity": 0.62,
  "raster-contrast": 0.16,
  "raster-saturation": -0.06,
};

const userLocationAccuracyLayer = (color: string): LayerProps => ({
  id: "user-location-accuracy-layer",
  type: "fill",
  paint: {
    "fill-color": color,
    "fill-opacity": 0.16,
    "fill-outline-color": color,
  },
});

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
const fmtAccuracy = (value: number | null): string =>
  typeof value === "number" && Number.isFinite(value) ? `accuracy ${Math.round(value)} m` : "accuracy unavailable";

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
type CoverageSampleLite = { lat: number; lon: number; valueDbm: number; weakestDbm?: number };
type OverlayRaster = {
  url: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  minDbm?: number;
  maxDbm?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
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
  /** Left-side element in the inspector toolbar (e.g. panel toggle button). */
  inspectorPanelToggle?: ReactNode;
  /** Right-side actions in the inspector toolbar (e.g. share button, mobile size controls). */
  inspectorActions?: ReactNode;
/** Pixel inset for the bottom edge when computing fitBounds, to avoid UI chrome. */
  fitBottomInset?: number;
  /** Pixel insets reserved for map-internal chrome when fitting bounds. */
  fitChromePadding?: { top: number; right: number; bottom: number; left: number };
  onPublishNotice?: (notice: { id: string; message: string; tone: "info" | "warning" | "error"; persistent: boolean }) => void;
};

type MarkerActionButtonProps = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  pointerTail?: boolean;
  pointerTone?: "accent" | "selection" | "temporary";
  tone?: "default" | "muted";
  onActivate: (event: MouseEvent<HTMLElement>) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

function MarkerActionButton({
  ariaLabel,
  children,
  className,
  pointerTail = false,
  pointerTone = "accent",
  tone = "default",
  onActivate,
  onMouseEnter,
  onMouseLeave,
}: MarkerActionButtonProps) {
  return (
    <Surface
      as="button"
      aria-label={ariaLabel}
      className={className}
      variant="pill"
      pointerTail={pointerTail}
      pointerTone={pointerTone}
      tone={tone}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate(event);
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </Surface>
  );
}

function SiteMarkerIcon({ site }: { site: Pick<Site, "name" | "antennaHeightM" | "iconKey"> }) {
  const { Icon } = getSiteIconOption(resolveSiteIconKey(site));
  return <Icon aria-hidden="true" className="map-site-icon" size={15} strokeWidth={1.8} />;
}

type PendingNewSiteDraft = {
  lat: number;
  lon: number;
};

type UserLocationFix = {
  lat: number;
  lon: number;
  accuracyM: number | null;
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

const SITE_PIN_MARKER_OFFSET: [number, number] = [0, -11];
const USER_LOCATION_ZOOM = 12;
const USER_LOCATION_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
};
const USER_LOCATION_NOTICE_ID = "user-location";
const READ_ONLY_SIMULATION_SITE_HELP = "Read-only: you need edit permission to add sites to this simulation.";
const READ_ONLY_SIMULATION_SITE_EDIT_HELP =
  "Read-only: you need edit permission to move or edit sites in this simulation.";

const userLocationErrorMessage = (error: GeolocationPositionError): string => {
  if (error.code === error.PERMISSION_DENIED) return "Location permission was denied.";
  if (error.code === error.POSITION_UNAVAILABLE) return "Your location is currently unavailable.";
  if (error.code === error.TIMEOUT) return "Location request timed out.";
  return "Could not get your location.";
};

const buildUserLocationAccuracyGeoJson = (fix: UserLocationFix | null) => {
  const accuracyM = fix?.accuracyM;
  if (!fix || typeof accuracyM !== "number" || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return {
      type: "FeatureCollection" as const,
      features: [],
    };
  }
  const pointCount = 64;
  const latRadius = accuracyM / 111_320;
  const lonRadius = latRadius / Math.max(0.1, Math.cos((fix.lat * Math.PI) / 180));
  const coordinates = Array.from({ length: pointCount + 1 }, (_, index) => {
    const angle = (index / pointCount) * Math.PI * 2;
    return [
      fix.lon + Math.cos(angle) * lonRadius,
      fix.lat + Math.sin(angle) * latRadius,
    ];
  });
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "Polygon" as const,
          coordinates: [coordinates],
        },
      },
    ],
  };
};

export function MapView({
  isMapExpanded,
  showInspector = true,
  inspectorPanelClassName,
  showMultiSelectToggle = false,
  readOnly = false,
  canPersist = true,
  onToggleMapExpanded,
  inspectorPanelToggle,
  inspectorActions,
  fitBottomInset = 30,
  fitChromePadding = FIT_CHROME_PADDING,
  onPublishNotice,
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
  const openMapEditor = useAppStore((state) => state.openMapEditor);
  const mapEditor = useAppStore((state) => state.mapEditor);
  const mapEditorSiteDraft = useAppStore((state) => state.mapEditorSiteDraft);
  const setMapEditorSiteDraft = useAppStore((state) => state.setMapEditorSiteDraft);
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
  const completedCoverageRunToken = useCoverageStore((state) => state.completedCoverageRunToken);
  const autoCalculateEnabled = useCoverageStore((state) => state.autoCalculateEnabled);
  const automaticLockNoticeShown = useCoverageStore((state) => state.automaticLockNoticeShown);
  const calculationCycleSource = useCoverageStore((state) => state.calculationCycleSource);
  const markAutomaticLockNoticeShown = useCoverageStore((state) => state.markAutomaticLockNoticeShown);
  const setAutoCalculateEnabled = useCoverageStore((state) => state.setAutoCalculateEnabled);
  const startManualCalculation = useCoverageStore((state) => state.startManualCalculation);
  const stopCalculation = useCoverageStore((state) => state.stopCalculation);
  const finishCalculationCycle = useCoverageStore((state) => state.finishCalculationCycle);
  const isTerrainFetching = useAppStore((state) => state.isTerrainFetching);
  const isTerrainRecommending = useAppStore((state) => state.isTerrainRecommending);
  const basemapStyleId = useAppStore((state) => state.basemapStyleId);
  const setBasemapStyleId = useAppStore((state) => state.setBasemapStyleId);
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
  const cancelTerrainLoad = useAppStore((state) => state.cancelTerrainLoad);
  const selectedOverlayRadiusOption = useAppStore((state) => state.selectedOverlayRadiusOption);
  const setSelectedOverlayRadiusOption = useAppStore((state) => state.setSelectedOverlayRadiusOption);
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
  const [visibleSiteSourcesOpen, setVisibleSiteSourcesOpen] = useState(false);
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
  const [isUserLocationActive, setIsUserLocationActive] = useState(false);
  const [userLocationFix, setUserLocationFix] = useState<UserLocationFix | null>(null);
  const [interactionViewState, setInteractionViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
  } | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  const visibleSiteSourcesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const userLocationWatchIdRef = useRef<number | null>(null);
  const isUserLocationActiveRef = useRef(false);
  const isUserLocationFollowingRef = useRef(false);
  const clearFitControlActiveRef = useRef<() => void>(() => undefined);
  const panoramaLensBaseViewRef = useRef<{
    center: { lat: number; lon: number };
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>(null);
  const editorDraftAnimationKeyRef = useRef("");

  const stopUserLocation = useCallback(() => {
    if (userLocationWatchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(userLocationWatchIdRef.current);
    }
    userLocationWatchIdRef.current = null;
    isUserLocationActiveRef.current = false;
    isUserLocationFollowingRef.current = false;
    setIsUserLocationActive(false);
    setUserLocationFix(null);
  }, []);

  useEffect(() => () => stopUserLocation(), [stopUserLocation]);

  const publishLocationNotice = useCallback(
    (message: string, tone: "info" | "warning" | "error" = "error") => {
      onPublishNotice?.({
        id: USER_LOCATION_NOTICE_ID,
        message,
        tone,
        persistent: false,
      });
    },
    [onPublishNotice],
  );

  const startUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      publishLocationNotice("Your browser does not support location services.");
      return;
    }
    isUserLocationActiveRef.current = true;
    isUserLocationFollowingRef.current = true;
    clearFitControlActiveRef.current();
    setIsUserLocationActive(true);
    setUserLocationFix(null);
    try {
      userLocationWatchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const nextFix: UserLocationFix = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          };
          setUserLocationFix(nextFix);
          if (isUserLocationFollowingRef.current) {
            setInteractionViewState(null);
            const didAnimate = animateMapToCenter(mapRef, {
              center: { lat: nextFix.lat, lon: nextFix.lon },
              zoom: USER_LOCATION_ZOOM,
              padding: resolveMapCameraPadding(fitChromePadding, fitBottomInset),
            });
            if (!didAnimate) {
              updateMapViewport({
                center: { lat: nextFix.lat, lon: nextFix.lon },
                zoom: USER_LOCATION_ZOOM,
              });
            }
          }
        },
        (error) => {
          console.error("[user-location] geolocation watch failed", error);
          publishLocationNotice(userLocationErrorMessage(error));
          stopUserLocation();
        },
        USER_LOCATION_WATCH_OPTIONS,
      );
    } catch (error) {
      console.error("[user-location] geolocation watch failed", error);
      publishLocationNotice("Could not get your location.");
      stopUserLocation();
    }
  }, [
    fitBottomInset,
    fitChromePadding.bottom,
    fitChromePadding.left,
    fitChromePadding.right,
    fitChromePadding.top,
    publishLocationNotice,
    stopUserLocation,
    updateMapViewport,
  ]);

  const toggleUserLocation = useCallback(() => {
    if (isUserLocationActiveRef.current) {
      stopUserLocation();
      return;
    }
    startUserLocation();
  }, [startUserLocation, stopUserLocation]);

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
    if (showDiscoveryMqtt) return;
    setMqttDuplicatePrompt(null);
  }, [showDiscoveryMqtt]);

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
  const meshExtensionSites = selectedSites.length > 0 ? selectedSites : sites;
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
  const visibleLibrarySites = useMemo(
    () =>
      siteLibrary.filter(
        (entry) => !simulationLibrarySiteIds.has(entry.id),
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
  const automaticCalculationLocked = isAutomaticCalculationLocked(
    selectedCoverageResolution,
    normalizedOverlayRadiusOption,
  );
  const previousAutomaticCalculationLockedRef = useRef(automaticCalculationLocked);
  const calculationWorkAllowed =
    (autoCalculateEnabled && !automaticCalculationLocked) || calculationCycleSource === "manual";
  useEffect(() => {
    const becameLocked = automaticCalculationLocked && !previousAutomaticCalculationLockedRef.current;
    previousAutomaticCalculationLockedRef.current = automaticCalculationLocked;
    if (!automaticCalculationLocked) return;
    if (autoCalculateEnabled) setAutoCalculateEnabled(false);
    if (!becameLocked || automaticLockNoticeShown) return;
    markAutomaticLockNoticeShown();
    onPublishNotice?.({
      id: "automatic-calculation-locked",
      message: "Auto calculate was turned off for 100 km or 4x and above. Press Start to calculate.",
      tone: "info",
      persistent: false,
    });
  }, [
    automaticCalculationLocked,
    automaticLockNoticeShown,
    autoCalculateEnabled,
    markAutomaticLockNoticeShown,
    onPublishNotice,
    setAutoCalculateEnabled,
  ]);
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
    if (!calculationWorkAllowed) {
      targetRadiusFetchAttemptRef.current = "";
      return;
    }
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
    calculationWorkAllowed,
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
  const effectiveBandStepDb = 5;
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
  const lastCoverageOverlayCompletionRef = useRef("");
  const lastTerrainOverlayCompletionRef = useRef("");
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
  const overlayProgressFloorRef = useRef<number | null>(null);
  const overlayJobsInFlightRef = useRef(0);
  const syncOverlayProgressState = useCallback(() => {
    const coverageProgress = overlayProgressByPipelineRef.current.coverage;
    const terrainProgress = overlayProgressByPipelineRef.current.terrain;
    const nextProgress = resolveMonotonicOverlayProgress(
      overlayProgressFloorRef.current,
      [coverageProgress, terrainProgress],
    );
    if (nextProgress === null) {
      setOverlayProgressMode("indeterminate");
      setOverlayProgressPercent(null);
      return;
    }
    overlayProgressFloorRef.current = nextProgress;
    setOverlayProgressMode("determinate");
    setOverlayProgressPercent(nextProgress);
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
    if (overlayJobsInFlightRef.current === 0) {
      overlayProgressFloorRef.current = null;
      overlayProgressByPipelineRef.current = { coverage: null, terrain: null };
      setOverlayProgressMode("indeterminate");
      setOverlayProgressPercent(null);
    }
    overlayJobsInFlightRef.current += 1;
    setOverlayJobsInFlight(overlayJobsInFlightRef.current);
    setOverlayPipelineProgress(pipeline, null);
    return () => {
      if (finished) return;
      finished = true;
      overlayJobsInFlightRef.current = Math.max(0, overlayJobsInFlightRef.current - 1);
      setOverlayJobsInFlight(overlayJobsInFlightRef.current);
      setOverlayPipelineProgress(pipeline, null);
      if (overlayJobsInFlightRef.current === 0) {
        overlayProgressFloorRef.current = null;
        overlayProgressByPipelineRef.current = { coverage: null, terrain: null };
        setOverlayProgressMode("indeterminate");
        setOverlayProgressPercent(null);
      }
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
  const selectedSiteRadioDigest = useMemo(() => meshExtensionSiteDigest(meshExtensionSites), [meshExtensionSites]);
  const meshExtensionFrequencyMHz =
    selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? activeSelectionLink?.frequencyMHz ?? 869.618;

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
    if (
      shouldDeferOverlayRasterization({
        isTerrainFetching,
        isTerrainRecommending,
        isSimulationRecomputing,
      })
    ) {
      cancelCoveragePipeline(false);
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
    if (mode === "mesh-extension" && !meshExtensionSites.length) {
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
      selectedSiteRadioDigest,
      meshExtensionFrequencyMHz,
    ].join("|");
    const hasFreshCoverageCompletion =
      calculationCycleSource !== null &&
      completedCoverageRunToken !== "" &&
      lastCoverageOverlayCompletionRef.current !== completedCoverageRunToken;
    if (!calculationWorkAllowed && !hasFreshCoverageCompletion) {
      const snapshot = scheduler.snapshot();
      scheduler.clearQueue();
      if (snapshot.activeSignature && snapshot.activeSignature !== signature) {
        scheduler.cancelActive();
        setOverlayPipelineProgress("coverage", null);
      }
      return;
    }
    if (hasFreshCoverageCompletion) {
      lastCoverageOverlayCompletionRef.current = completedCoverageRunToken;
    }
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
          if (mode === "heatmap" || mode === "contours" || mode === "weakest") {
            const overlaySamples =
              mode === "weakest"
                ? samplesForOverlay.map((sample) => ({
                    ...sample,
                    valueDbm: sample.weakestDbm ?? sample.valueDbm,
                  }))
                : samplesForOverlay;
            rasterPixels = await buildCoverageOverlayPixelsAsync(
              overlayBounds,
              overlaySamples,
              mode === "contours" || mode === "weakest" ? "heatmap" : mode,
              effectiveBandStepDb,
              overlayDimensions,
              overlayPointMask,
              terrainSampler,
              context,
              { rxTargetDbm: rxSensitivityTargetDbm },
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
          } else if (mode === "mesh-extension") {
            rasterPixels = await buildMeshExtensionOverlayPixelsAsync({
              bounds: overlayBounds,
              selectedSites: meshExtensionSites,
              frequencyMHz: meshExtensionFrequencyMHz,
              propagationEnvironment,
              rxTargetDbm: rxSensitivityTargetDbm,
              environmentLossDb,
              terrainSampler,
              dimensions: overlayDimensions,
              candidateGridSize: effectiveGridSize,
              coverageGridSize: effectiveGridSize,
              terrainSamples: 20,
              pointMask: overlayPointMask,
              context,
            });
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
    selectedSiteRadioDigest,
    meshExtensionFrequencyMHz,
    meshExtensionSites,
    selectedNetwork,
    showOverlayDiagnostics,
    beginOverlayJob,
    setOverlayPipelineProgress,
    logOverlaySchedulerEvent,
    calculationWorkAllowed,
    calculationCycleSource,
    completedCoverageRunToken,
    isTerrainFetching,
    isTerrainRecommending,
    isSimulationRecomputing,
  ]);
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

  const weakestSignalRange = useMemo(() => {
    if (!samplesForOverlay.length) return { min: -125, max: -62 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const sample of samplesForOverlay) {
      const value = sample.weakestDbm ?? sample.valueDbm;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { min, max };
  }, [samplesForOverlay]);

  const targetContourFeatures = useMemo(
    () =>
      coverageVizMode === "contours"
        ? buildCoverageTargetContourFeatures(samplesForOverlay, rxSensitivityTargetDbm, overlayBounds, overlayPointMask)
        : { type: "FeatureCollection" as const, features: [] },
    [coverageVizMode, overlayBounds, overlayPointMask, rxSensitivityTargetDbm, samplesForOverlay],
  );
  const showTargetContourLine = coverageVizMode === "contours" && targetContourFeatures.features.length > 0;
  const coverageScaleRange = useMemo(() => {
    if (!coverageOverlay || (coverageVizMode !== "heatmap" && coverageVizMode !== "contours" && coverageVizMode !== "weakest")) {
      return null;
    }
    if (typeof coverageOverlay.minDbm !== "number" || typeof coverageOverlay.maxDbm !== "number") return null;
    return { min: coverageOverlay.minDbm, max: coverageOverlay.maxDbm };
  }, [coverageOverlay, coverageVizMode]);

  const relayRange = useMemo(() => {
    if (!coverageOverlay || coverageVizMode !== "relay") return null;
    if (typeof coverageOverlay.minDbm !== "number" || typeof coverageOverlay.maxDbm !== "number") return null;
    return { min: coverageOverlay.minDbm, max: coverageOverlay.maxDbm };
  }, [coverageOverlay, coverageVizMode]);
  const meshExtensionRange = useMemo(() => {
    if (!coverageOverlay || coverageVizMode !== "mesh-extension") return null;
    if (typeof coverageOverlay.maxAreaKm2 !== "number") return null;
    return {
      minAreaKm2: coverageOverlay.minAreaKm2 ?? 0,
      maxAreaKm2: coverageOverlay.maxAreaKm2,
      minDbm: coverageOverlay.minDbm,
      maxDbm: coverageOverlay.maxDbm,
    };
  }, [coverageOverlay, coverageVizMode]);
  const overlayGuideTitle = overlayGuideTitleForMode(coverageVizMode);

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
    if (
      shouldDeferOverlayRasterization({
        isTerrainFetching,
        isTerrainRecommending,
        isSimulationRecomputing,
      })
    ) {
      cancelTerrainPipeline(false);
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
    const hasFreshCoverageCompletion =
      calculationCycleSource !== null &&
      completedCoverageRunToken !== "" &&
      lastTerrainOverlayCompletionRef.current !== completedCoverageRunToken;
    if (!calculationWorkAllowed && !hasFreshCoverageCompletion) {
      const snapshot = scheduler.snapshot();
      scheduler.clearQueue();
      if (snapshot.activeSignature && snapshot.activeSignature !== signature) {
        scheduler.cancelActive();
        setOverlayPipelineProgress("terrain", null);
      }
      return;
    }
    if (hasFreshCoverageCompletion) {
      lastTerrainOverlayCompletionRef.current = completedCoverageRunToken;
    }
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
    calculationWorkAllowed,
    calculationCycleSource,
    completedCoverageRunToken,
    isTerrainFetching,
    isTerrainRecommending,
    isSimulationRecomputing,
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
  const simulationLoadingOverlayActive =
    Boolean(analysisBounds && overlayPointMask) &&
    (isTerrainFetching || isSimulationRecomputing || overlayJobsInFlight > 0);
  const simulationOverlayTransition = resolveSimulationOverlayTransition(
    simulationLoadingOverlayActive,
  );
  const calculationControlRunning = calculationCycleSource !== null || isSimulationRecomputing;
  const handleStopCalculation = useCallback(() => {
    stopCalculation();
    cancelTerrainLoad();
    coverageOverlaySchedulerRef.current?.clearQueue();
    coverageOverlaySchedulerRef.current?.cancelActive();
    terrainOverlaySchedulerRef.current?.clearQueue();
    terrainOverlaySchedulerRef.current?.cancelActive();
    setOverlayPipelineProgress("coverage", null);
    setOverlayPipelineProgress("terrain", null);
  }, [cancelTerrainLoad, setOverlayPipelineProgress, stopCalculation]);
  useEffect(() => {
    if (!calculationCycleSource || isSimulationRecomputing || overlayJobsInFlight > 0 || isTerrainFetching || isTerrainRecommending) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const coverageState = useCoverageStore.getState();
      const appState = useAppStore.getState();
      const coverageScheduler = coverageOverlaySchedulerRef.current?.snapshot();
      const terrainScheduler = terrainOverlaySchedulerRef.current?.snapshot();
      if (
        coverageState.isSimulationRecomputing ||
        appState.isTerrainFetching ||
        appState.isTerrainRecommending ||
        coverageScheduler?.running ||
        coverageScheduler?.queuedSignature ||
        terrainScheduler?.running ||
        terrainScheduler?.queuedSignature
      ) return;
      finishCalculationCycle();
    }, 240);
    return () => window.clearTimeout(timeoutId);
  }, [
    calculationCycleSource,
    finishCalculationCycle,
    isSimulationRecomputing,
    isTerrainFetching,
    isTerrainRecommending,
    overlayJobsInFlight,
  ]);
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
  useEffect(() => {
    if (!isMapLoaded || mapEditor?.kind !== "site" || !mapEditorSiteDraft) return;
    const animationKey = `${mapEditor.resourceId ?? "new"}:${mapEditorSiteDraft.lat.toFixed(6)}:${mapEditorSiteDraft.lon.toFixed(6)}`;
    if (editorDraftAnimationKeyRef.current === animationKey) return;
    editorDraftAnimationKeyRef.current = animationKey;
    setInteractionViewState(null);
    const didAnimate = animateMapToCenter(mapRef, {
      center: { lat: mapEditorSiteDraft.lat, lon: mapEditorSiteDraft.lon },
      zoom: viewport.zoom,
      padding: resolveMapCameraPadding(fitChromePadding, fitBottomInset),
      duration: 420,
    });
    if (!didAnimate) {
      updateMapViewport({
        center: { lat: mapEditorSiteDraft.lat, lon: mapEditorSiteDraft.lon },
        zoom: viewport.zoom,
      });
    }
  }, [
    fitBottomInset,
    fitChromePadding,
    isMapLoaded,
    mapEditor?.kind,
    mapEditor?.resourceId,
    mapEditorSiteDraft,
    updateMapViewport,
    viewport.zoom,
  ]);
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
      openMapEditor({
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect: {
          top: window.innerHeight / 2,
          right: window.innerWidth / 2,
          bottom: window.innerHeight / 2,
          left: window.innerWidth / 2,
          width: 0,
          height: 0,
        },
        siteSeed: {
          lat: pendingNewSiteDraft.lat,
          lon: pendingNewSiteDraft.lon,
          name: suggestedName,
          insertIntoSimulation: true,
        },
      });
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
    if (!canPersist) {
      setSiteDraftStatus(READ_ONLY_SIMULATION_SITE_EDIT_HELP);
      return;
    }
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
    if (!canPersist) {
      setSiteDraftStatus(READ_ONLY_SIMULATION_SITE_EDIT_HELP);
      return;
    }
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
    if (!canPersist) {
      setSiteDraftStatus(READ_ONLY_SIMULATION_SITE_EDIT_HELP);
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
  };

  const onPendingNewSiteDragEnd = (event: MarkerDragEvent) => {
    const nextPosition = {
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    };
    setPendingNewSiteDraft(nextPosition);
    setSiteDraftStatus(null);
  };

  const setEditorSiteDraftFromMap = (lat: number, lon: number) => {
    const terrainElevation = sampleSrtmElevation(srtmTiles, lat, lon);
    const groundElevationM = Number.isFinite(terrainElevation) ? Math.round(terrainElevation as number) : null;
    setMapEditorSiteDraft({ lat, lon, groundElevationM });
  };

  const onEditorSiteDraftDragEnd = (event: MarkerDragEvent) => {
    setEditorSiteDraftFromMap(event.lngLat.lat, event.lngLat.lng);
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

  const beginUserLocationSiteDraft = () => {
    if (!canPersist || !userLocationFix || pendingNewSiteDraft) return;
    beginPendingNewSiteDraft(userLocationFix.lat, userLocationFix.lon);
  };

  const onMapClick = (event: MapLayerMouseEvent) => {
    const rawTarget = event.originalEvent?.target;
    if (rawTarget instanceof Element && rawTarget.closest(".map-site-surface")) return;
    if (endpointPickTarget) return;
    if (mapEditor?.kind === "site" && mapEditor.isNew) {
      setEditorSiteDraftFromMap(event.lngLat.lat, event.lngLat.lng);
      setArmAddSiteOnNextEmptyMapClick(false);
      setSelectedDiscoveryLibraryEntryId(null);
      return;
    }
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
      setSiteDraftStatus(READ_ONLY_SIMULATION_SITE_HELP);
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
    openMapEditor({
      kind: "site",
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: {
        top: window.innerHeight / 2,
        right: window.innerWidth / 2,
        bottom: window.innerHeight / 2,
        left: window.innerWidth / 2,
        width: 0,
        height: 0,
      },
      siteSeed: {
        lat: node.lat,
        lon: node.lon,
        name: node.longName ?? node.shortName ?? node.nodeId,
        insertIntoSimulation: true,
        sourceMeta: {
          sourceType: "mqtt-feed",
          sourceUrl: "/meshmap/nodes.json",
          nodeId: node.nodeId,
          longName: node.longName,
          shortName: node.shortName,
          hwModel: node.hwModel,
          role: node.role,
        },
      },
    });
    setSiteDraftStatus("Opened MQTT node in the site editor. Review and save to add it.");
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
    openMapEditor({
      kind: "site",
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: {
        top: window.innerHeight / 2,
        right: window.innerWidth / 2,
        bottom: window.innerHeight / 2,
        left: window.innerWidth / 2,
        width: 0,
        height: 0,
      },
      siteSeed: {
        lat: node.lat,
        lon: node.lon,
        name: node.longName ?? node.shortName ?? node.nodeId,
        insertIntoSimulation: true,
        sourceMeta: {
          sourceType: "mqtt-feed",
          sourceUrl: "/meshmap/nodes.json",
          nodeId: node.nodeId,
          longName: node.longName,
          shortName: node.shortName,
          hwModel: node.hwModel,
          role: node.role,
        },
      },
    });
    setSiteDraftStatus(`Opened copy in the site editor for "${mqttDuplicatePrompt.existingName}".`);
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

  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapStyleId, theme, colorTheme),
    [basemapStyleId, theme, colorTheme],
  );
  const fallbackMapStyle = useMemo(() => getCartoFallbackStyle(theme, colorTheme), [theme, colorTheme]);
  // Themed styles show an official style URL + a translucent color overlay using the app's terrain token.
  const themedOverlay = resolvedBasemap.isThemed
    ? { color: variant.cssVars["--terrain"], opacity: theme === "dark" ? 0.1 : 0.08 }
    : null;
  const userLocationAccuracyGeoJson = useMemo(
    () => buildUserLocationAccuracyGeoJson(userLocationFix),
    [userLocationFix],
  );
  const userLocationSelectionColor = variant.cssVars["--selection"] ?? selectedLinkColor;
  // Track the selected category in local state; initialize from the current style's category.
  const [selectedCategory, setSelectedCategory] = useState<BasemapCategory>(
    () => getCategoryForStyleId(basemapStyleId),
  );
  const categoryStyles = useMemo(() => getStylesForCategory(selectedCategory), [selectedCategory]);
  const globalCategoryStyles = useMemo(
    () => categoryStyles.filter((s) => !s.regional),
    [categoryStyles],
  );
  const regionalCategoryStyles = useMemo(
    () => categoryStyles.filter((s) => s.regional),
    [categoryStyles],
  );
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
  clearFitControlActiveRef.current = clearFitControlActive;
  const handleFitToNodes = () => {
    if (isUserLocationActiveRef.current && isUserLocationFollowingRef.current) {
      isUserLocationFollowingRef.current = false;
    }
    fitToNodes();
  };
  useEffect(() => {
    if (!fitControlActive || !fitSitesEpoch || !isMapLoaded || !mapRef.current) return;
    const bounds = computeSiteFitBounds(sites, overlayRadiusKm);
    if (!bounds) return;
    fitMapToBounds(mapRef, bounds, {
      padding: resolveMapCameraPadding(fitChromePadding, fitBottomInset),
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
  const allowedOverlayModes = useMemo(
    () => overlayModesForSelectionCount(selectionCount, sites.length),
    [selectionCount, sites.length],
  );
  useEffect(() => {
    if (allowedOverlayModes.includes(coverageVizMode)) return;
    setCoverageVizMode(selectionCount === 1 ? "passfail" : selectionCount === 2 ? "relay" : "heatmap");
  }, [allowedOverlayModes, coverageVizMode, selectionCount, setCoverageVizMode]);
  const simulationOverlaySelectValue = coverageVizMode;
  const visibleSiteSourceSummary =
    showDiscoverySites && showDiscoveryMqtt
      ? "Simulation + Library + MQTT"
      : showDiscoverySites
        ? "Simulation + Library"
        : showDiscoveryMqtt
          ? "Simulation + MQTT"
          : "Simulation only";
  const setVisibleSiteSource = useCallback((source: "library" | "mqtt", visible: boolean) => {
    if (source === "library") {
      setShowDiscoverySites(visible);
      return;
    }
    setShowDiscoveryMqtt(visible);
  }, []);
  const selectedSite = selectedSites[0] ?? null;
  const selectedDiscoveryLibraryEntry =
    selectedDiscoveryLibraryEntryId
      ? visibleLibrarySites.find((entry) => entry.id === selectedDiscoveryLibraryEntryId) ?? null
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
      canPersist
        ? `Library Sites visible: ${visibleLibrarySites.length}. Click a marker to inspect, then choose Add to Simulation.`
        : `Library Sites visible: ${visibleLibrarySites.length}. Click a marker to inspect it.`,
    );
  }
  if (selectedDiscoveryLibraryEntry && !canPersist) inspectorLines.push(READ_ONLY_SIMULATION_SITE_HELP);
  if (selectedSite && !canPersist) inspectorLines.push(READ_ONLY_SIMULATION_SITE_EDIT_HELP);
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
            <MapControlButton
              aria-label={isMultiSelectMode ? "Disable multi-select" : "Enable multi-select"}
              isSelected={isMultiSelectMode}
              onClick={() => setIsMultiSelectMode((current) => !current)}
              title={isMultiSelectMode ? "Multi-select On" : "Multi-select Off"}
            >
              <SquareStack aria-hidden="true" strokeWidth={1.8} />
            </MapControlButton>
          ) : null}
          <MapControlButton aria-label="Zoom out" onClick={() => zoomBy(-1)} title="Zoom out">
            <ZoomOut aria-hidden="true" strokeWidth={1.8} />
          </MapControlButton>
          <MapControlButton aria-label="Zoom in" onClick={() => zoomBy(1)} title="Zoom in">
            <ZoomIn aria-hidden="true" strokeWidth={1.8} />
          </MapControlButton>
          <MapControlButton
            aria-label="Use my location"
            isSelected={isUserLocationActive}
            onClick={toggleUserLocation}
            title="Use my location"
          >
            {isUserLocationActive ? <LocateFixed aria-hidden="true" strokeWidth={1.8} /> : <Locate aria-hidden="true" strokeWidth={1.8} />}
          </MapControlButton>
          <MapControlButton
            aria-label="Fit map to sites"
            isSelected={fitControlActive}
            onClick={handleFitToNodes}
            title="Fit"
          >
            <Fullscreen aria-hidden="true" strokeWidth={1.8} />
          </MapControlButton>
          <MapControlButton
            aria-label={isMapExpanded ? "Show panels" : "Hide panels"}
            isSelected={isMapExpanded}
            onClick={onToggleMapExpanded}
            title={isMapExpanded ? "Show panels" : "Hide panels"}
          >
            {isMapExpanded ? <Minimize2 aria-hidden="true" strokeWidth={1.8} /> : <Maximize2 aria-hidden="true" strokeWidth={1.8} />}
          </MapControlButton>
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
      {showInspector ? (
        <aside className={`map-inspector ${inspectorPanelClassName ?? ""}`.trim()} aria-live="polite">
          {(inspectorPanelToggle != null || inspectorActions != null) ? (
            <PanelToolbar title={inspectorPanelToggle} actions={inspectorActions} />
          ) : null}
          <div className="map-inspector-section map-calculation-status">
            {simulationBusyIndicator ? (
              <>
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
              </>
            ) : null}
            <div className="map-calculation-controls">
              <ActionButton
                aria-label={
                  automaticCalculationLocked
                    ? "Automatic calculation unavailable at 100 km or 4x and above"
                    : autoCalculateEnabled
                      ? "Turn off automatic calculation"
                      : "Turn on automatic calculation"
                }
                aria-pressed={autoCalculateEnabled}
                className={`map-calculation-control map-calculation-toggle ${autoCalculateEnabled ? "is-on" : "is-off"}`}
                disabled={automaticCalculationLocked}
                onClick={() => setAutoCalculateEnabled(!autoCalculateEnabled)}
                title={
                  automaticCalculationLocked
                    ? "Automatic calculation unavailable at 100 km or 4x and above"
                    : autoCalculateEnabled
                      ? "Turn off automatic calculation"
                      : "Turn on automatic calculation"
                }
                variant="ghost"
              >
                {autoCalculateEnabled ? (
                  <ToggleRight aria-hidden="true" size={20} strokeWidth={1.8} />
                ) : (
                  <ToggleLeft aria-hidden="true" size={20} strokeWidth={1.8} />
                )}
                <span>Auto calculate</span>
              </ActionButton>
              {!autoCalculateEnabled ? (
                <ActionButton
                  aria-label={calculationControlRunning ? "Stop calculation" : "Start calculation"}
                  className={`map-calculation-control map-calculation-action ${calculationControlRunning ? "is-stop" : "is-start"}`}
                  onClick={calculationControlRunning ? handleStopCalculation : startManualCalculation}
                  title={calculationControlRunning ? "Stop calculation" : "Start calculation"}
                  variant="ghost"
                >
                  {calculationControlRunning ? (
                    <Square aria-hidden="true" size={15} strokeWidth={2} />
                  ) : (
                    <Play aria-hidden="true" size={17} strokeWidth={2} />
                  )}
                  <span>{calculationControlRunning ? "Stop" : "Start"}</span>
                </ActionButton>
              ) : null}
            </div>
          </div>
          {showHolidayThemeNotice && activeHolidayTheme ? (
            <div className="map-inspector-section map-holiday-note" role="status">
              <p className="map-inspector-primary map-holiday-note-title">
                <span className="map-holiday-note-icons" aria-hidden="true">
                  {activeHolidayTheme.key === "pride" ? (
                    <span className="map-holiday-pride-icon">
                      <span className="map-holiday-pride-icon-paint" />
                    </span>
                  ) : (
                    <>
                      <Rabbit size={15} strokeWidth={1.8} />
                      <Egg size={14} strokeWidth={1.8} />
                    </>
                  )}
                </span>
                {activeHolidayTheme.message}
              </p>
              <p className="map-inspector-line">
                {isHolidayThemeForced
                  ? `${activeHolidayTheme.title} is active this week.`
                  : `Your preferred theme is active for this ${activeHolidayTheme.key === "pride" ? "Pride week" : "holiday week"}.`}
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
                      onClick={(event) => {
                        const entry = siteLibrary.find((candidate) => candidate.id === inspectorPrimaryLibraryEntryId);
                        if (!entry) {
                          requestOpenSiteLibraryEntry(inspectorPrimaryLibraryEntryId);
                          return;
                        }
                        openMapEditor({
                          kind: "site",
                          resourceId: entry.id,
                          isNew: false,
                          label: entry.name,
                          anchorRect: event.currentTarget.getBoundingClientRect(),
                        });
                      }}
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
          <CompactDetails
              className="compact-details map-inspector-details"
              onToggle={(event) => { const v = event.currentTarget.open; writeSectionBool(UI_SECTION_KEYS.mapViewOverlayGuide, v); setShowOverlayGuide(v); }}
              open={showOverlayGuide}
            >
              <CompactDetailsSummary>Map</CompactDetailsSummary>
              <div className="map-inspector-map-settings">
              <label className="map-inspector-map-setting">
                <span>Category</span>
                <select
                  className="locale-select"
                  onChange={(event) => {
                    const nextCategory = event.target.value as BasemapCategory;
                    setSelectedCategory(nextCategory);
                    const nextStyleId = getDefaultStyleIdForCategory(nextCategory);
                    setBasemapStyleId(nextStyleId);
                    setUseFallbackMapStyle(false);
                    setMapProviderWarning(null);
                  }}
                  value={selectedCategory}
                >
                  {BASEMAP_CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="map-inspector-map-setting">
                <span>Map Style</span>
                <select
                  className="locale-select"
                  onChange={(event) => {
                    setBasemapStyleId(event.target.value);
                    setUseFallbackMapStyle(false);
                    setMapProviderWarning(null);
                  }}
                  value={resolvedBasemap.styleId}
                >
                  {globalCategoryStyles.map((style) => (
                    <option disabled={!style.available} key={style.id} value={style.id}>
                      {style.label}{style.requiresKey && !style.available ? " (key required)" : ""}
                    </option>
                  ))}
                  {regionalCategoryStyles.length > 0 ? (
                    <optgroup label="Regional">
                      {regionalCategoryStyles.map((style) => (
                        <option key={style.id} value={style.id}>
                          {style.label}{style.regional ? ` — ${style.regional.region}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
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
                    const mode = event.target.value as MapOverlayMode;
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
                  {allowedOverlayModes.includes("weakest") ? <option value="weakest">Weakest Site</option> : null}
                  {allowedOverlayModes.includes("contours") ? <option value="contours">Heatmap + Target Line</option> : null}
                  {allowedOverlayModes.includes("passfail") ? <option value="passfail">Pass/Fail</option> : null}
                  {allowedOverlayModes.includes("relay") ? <option value="relay">Relay</option> : null}
                  {allowedOverlayModes.includes("mesh-extension") ? <option value="mesh-extension">Mesh Extension</option> : null}
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
              <div className="map-inspector-map-setting">
                <span>Visible Sites</span>
                <div className="visible-site-sources-control">
                  <ActionButton
                    aria-expanded={visibleSiteSourcesOpen}
                    aria-haspopup="dialog"
                    className="visible-site-sources-trigger"
                    onClick={() => setVisibleSiteSourcesOpen((open) => !open)}
                    ref={visibleSiteSourcesTriggerRef}
                    type="button"
                  >
                    <Layers aria-hidden="true" size={13} strokeWidth={1.8} />
                    <span>{visibleSiteSourceSummary}</span>
                  </ActionButton>
                </div>
                <FloatingPopover
                  className="visible-site-sources-popover"
                  estimatedHeight={120}
                  estimatedWidth={240}
                  onClose={() => setVisibleSiteSourcesOpen(false)}
                  open={visibleSiteSourcesOpen}
                  pointerTail
                  triggerRef={visibleSiteSourcesTriggerRef}
                >
                  <div aria-label="Visible site sources" className="visible-site-sources-popover-content" role="dialog">
                    <p className="visible-site-sources-summary">{visibleSiteSourceSummary}</p>
                    <div className="visible-site-sources-options">
                      <label className="checkbox-field visible-site-source-option">
                        <input
                          checked={showDiscoverySites}
                          onChange={(event) => setVisibleSiteSource("library", event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Library</span>
                      </label>
                      <label className="checkbox-field visible-site-source-option">
                        <input
                          checked={showDiscoveryMqtt}
                          onChange={(event) => setVisibleSiteSource("mqtt", event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>MQTT</span>
                      </label>
                    </div>
                  </div>
                </FloatingPopover>
              </div>
            </div>
            <p>
              Mode: <strong>{overlayGuideTitle}</strong>
            </p>
            {coverageVizMode === "none" ? <p>Overlay is hidden. Use Simulation Overlay to show it again.</p> : null}
            {coverageVizMode === "heatmap" ? (
              <>
                <p>
                  Shows overall coverage strength from your current simulation sites. Think of it as "how good signal
                  should feel if you stand here", using the best available Site signal.
                </p>
                <label className="map-inspector-map-setting map-inspector-map-setting-inline">
                  <span>Draw RX target threshold line</span>
                  <input
                    checked={false}
                    onChange={(event) => setCoverageVizMode(event.currentTarget.checked ? "contours" : "heatmap")}
                    type="checkbox"
                  />
                </label>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{fmtDbm(coverageScaleRange?.min ?? signalRange.min)}</span>
                    <span>{fmtDbm(rxSensitivityTargetDbm)}</span>
                    <span>{fmtDbm(coverageScaleRange?.max ?? signalRange.max)}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">Centered on the RX target, widened to use more of the spectrum for this Simulation.</p>
              </>
            ) : null}
            {coverageVizMode === "weakest" ? (
              <>
                <p>
                  Shows the weakest signal from this point to any Site in the Simulation. Use this when the point must
                  be able to reach every Site, not just the nearest or strongest one.
                </p>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{fmtDbm(coverageScaleRange?.min ?? weakestSignalRange.min)}</span>
                    <span>{fmtDbm(rxSensitivityTargetDbm)}</span>
                    <span>{fmtDbm(coverageScaleRange?.max ?? weakestSignalRange.max)}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">Centered on the RX target, widened to use more of the spectrum for this Simulation.</p>
              </>
            ) : null}
            {coverageVizMode === "contours" ? (
              <>
                <p>Shows the fixed-scale Heatmap with a line where best available Site signal crosses the Simulation RX target.</p>
                <label className="map-inspector-map-setting map-inspector-map-setting-inline">
                  <span>Draw RX target threshold line</span>
                  <input
                    checked
                    onChange={(event) => setCoverageVizMode(event.currentTarget.checked ? "contours" : "heatmap")}
                    type="checkbox"
                  />
                </label>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{fmtDbm(coverageScaleRange?.min ?? rxSensitivityTargetDbm - 20)}</span>
                    <span>RX target</span>
                    <span>{fmtDbm(coverageScaleRange?.max ?? rxSensitivityTargetDbm + 30)}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">The line is the pass/fail threshold; the heatmap shows relative signal shape around it.</p>
              </>
            ) : null}
            {coverageVizMode === "passfail" ? (
              <>
                <p>Go/no-go map with terrain context.</p>
                <ul className="overlay-legend">
                  <li>
                    <StateDot state="pass_clear" />
                    <span>Clear path and meets signal target</span>
                  </li>
                  <li>
                    <StateDot state="pass_blocked" />
                    <span>Blocked path, but still meets signal target</span>
                  </li>
                  <li>
                    <StateDot state="fail_clear" />
                    <span>Clear path, but below signal target</span>
                  </li>
                  <li>
                    <StateDot state="fail_blocked" />
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
            {coverageVizMode === "mesh-extension" ? (
              <>
                <p>
                  Shows where a representative new node can reach any selected Site, or any Simulation Site when none
                  are selected, in both directions while adding terrain that those Sites do not currently cover.
                </p>
                <div className="overlay-scale">
                  <div className="overlay-scale-bar" />
                  <div className="overlay-scale-labels">
                    <span>{(meshExtensionRange?.minAreaKm2 ?? 0).toFixed(1)} km² new</span>
                    <span>{meshExtensionRange ? `${meshExtensionRange.maxAreaKm2.toFixed(1)} km² new` : "More new area"}</span>
                  </div>
                </div>
                <p className="overlay-scale-help">
                  Color shows newly covered area. Opacity shows bidirectional signal to the strongest applicable peer;
                  locations below the RX target are hidden.
                </p>
                <p className="overlay-scale-help">
                  Simulation Resolution controls both candidate placement and added-area precision. Higher resolutions
                  refine coverage boundaries adaptively and can take longer.
                </p>
              </>
            ) : null}
          </CompactDetails>
            <CompactDetails
              className="compact-details map-inspector-details"
              onToggle={(event) => { const v = event.currentTarget.open; writeSectionBool(UI_SECTION_KEYS.mapViewResults, v); setShowResultsSummary(v); }}
              open={showResultsSummary}
            >
              <CompactDetailsSummary infoTipText="Computed link budget summary for the selected path and current channel/model settings.">Results</CompactDetailsSummary>
              <SimulationResultsSection />
            </CompactDetails>
            <CompactDetails
              className="compact-details map-inspector-details"
              onToggle={(event) => { const v = event.currentTarget.open; writeSectionBool(UI_SECTION_KEYS.mapViewSimSummary, v); setShowSimulationSummary(v); }}
              open={showSimulationSummary}
            >
              <CompactDetailsSummary>Simulation Sources</CompactDetailsSummary>

              {/* Simulation section */}
              <div className="map-sim-section">
                <div className="map-sim-section-title">Simulation</div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Model</div>
                  <div className="map-sim-row-value">{propagationModel}</div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Resolution</div>
                  <div className="map-sim-row-value">{selectedCoverageResolution}</div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">View</div>
                  <div className="map-sim-row-value">{coverageVizMode}</div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Network</div>
                  <div className="map-sim-row-value">
                    {selectedNetwork?.name ?? "n/a"} @ {(selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 0).toFixed(3)} MHz
                  </div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Grid</div>
                  <div className="map-sim-row-value">Auto ({overlayDimensions.width}×{overlayDimensions.height})</div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Coverage Area</div>
                  <div className="map-sim-row-value">{analysisBoundsDiagonalKm.toFixed(0)} km diagonal</div>
                </div>
              </div>

              {/* Terrain section */}
              <div className="map-sim-section">
                <div className="map-sim-section-title">Terrain</div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Dataset</div>
                  <div className="map-sim-row-value">
                    {TERRAIN_DATASET_LABEL[terrainDataset]} ({selectedDatasetTileCount} matching tile
                    {selectedDatasetTileCount === 1 ? "" : "s"} · {srtmTiles.length} total loaded)
                  </div>
                </div>
                {terrainSourceSummary.length ? (
                  <div className="map-sim-row">
                    <div className="map-sim-row-label">Sources</div>
                    <ul className="map-sim-sources">
                      {terrainSourceSummary.map((entry) => (
                        <li key={entry.label}>
                          {entry.label} · {entry.count}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="map-sim-row">
                    <div className="map-sim-row-label">Sources</div>
                    <div className="map-sim-row-value">Simulation/manual site elevations</div>
                  </div>
                )}
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Site Elevations</div>
                  <div className="map-sim-row-value">Simulation values</div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Overlay</div>
                  <div className="map-sim-row-value">{showTerrainOverlay ? "Visible" : "Hidden"}</div>
                </div>
                {showLocalTerrainDiagnostics ? (
                  <>
                    <div className="map-sim-row">
                      <div className="map-sim-row-label">Memory (Decoded)</div>
                      <div className="map-sim-row-value">
                        {formatMb(terrainMemoryDiagnostics.retainedBytesTotal)} [30m {formatMb(terrainMemoryDiagnostics.retainedBytesByDataset.copernicus30)}, manual {formatMb(terrainMemoryDiagnostics.retainedBytesByDataset.manual)}]
                      </div>
                    </div>
                    <div className="map-sim-row">
                      <div className="map-sim-row-label">Tile Counts</div>
                      <div className="map-sim-row-value">
                        30m {terrainMemoryDiagnostics.tileCountsByDataset.copernicus30}, manual {terrainMemoryDiagnostics.tileCountsByDataset.manual}, other {terrainMemoryDiagnostics.tileCountsByDataset.other}
                      </div>
                    </div>
                    <div className="map-sim-row">
                      <div className="map-sim-row-label">Decode Overhead</div>
                      <div className="map-sim-row-value">{formatMb(terrainProgressTransientDecodeBytesEstimated)} (in-flight estimate)</div>
                    </div>
                  </>
                ) : null}
              </div>

              {/* Optimization section */}
              <div className="map-sim-section">
                <div className="map-sim-section-title">Rendering</div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Optimization Thresholds</div>
                  <div className="map-sim-row-value">&gt;250 · &gt;400 · &gt;600 km</div>
                </div>
                <div className="map-sim-row">
                  <div className="map-sim-row-label">Status</div>
                  <div className={`map-sim-status ${largeAreaOptimizationActive ? "active" : ""}`}>
                    {largeAreaOptimizationActive ? (
                      <>
                        Active · Preview scale {Math.round(overlayResolutionScale * 100)}%
                      </>
                    ) : (
                      "Inactive at this extent"
                    )}
                  </div>
                </div>
              </div>

              {/* Footnote */}
              <div className="map-sim-footnote">
                Coverage values are terrain-aware when ITM model is selected and terrain tiles are loaded.
              </div>
          </CompactDetails>
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
            setBasemapStyleId(DEFAULT_BASEMAP_STYLE_ID);
            setInteractionViewState({
              longitude: activeViewState.longitude,
              latitude: activeViewState.latitude,
              zoom: Math.min(activeViewState.zoom, 20),
            });
            setMapProviderWarning(
              `${resolvedBasemap.providerLabel} failed (network, quota, or style error).`,
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
            if (isUserLocationActiveRef.current && isUserLocationFollowingRef.current) {
              isUserLocationFollowingRef.current = false;
            }
          }
          setInteractionViewState({
            longitude: event.viewState.longitude,
            latitude: event.viewState.latitude,
            zoom: Math.min(event.viewState.zoom, providerMaxZoom),
          });
        }}
        onMoveEnd={onMoveEnd}
      >
        {themedOverlay ? (
          <Source data={WORLD_POLYGON_GEOJSON} id="theme-tint-source" type="geojson">
            <Layer
              id="theme-tint-overlay"
              paint={{ "fill-color": themedOverlay.color, "fill-opacity": themedOverlay.opacity }}
              type="fill"
            />
          </Source>
        ) : null}

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
                "raster-opacity": simulationLoadingOverlayActive
                  ? 0
                  : coverageOverlay
                    ? 0.34
                    : 0.62,
                "raster-opacity-transition": {
                  duration: simulationOverlayTransition.durationMs,
                },
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
            <Layer {...coverageRasterLayer(simulationLoadingOverlayActive)} />
          </Source>
        ) : null}

        <SimulationLoadingOverlay
          bounds={analysisBounds}
          loading={simulationLoadingOverlayActive}
          pointMask={overlayPointMask}
        />

        {showTargetContourLine ? (
          <Source data={targetContourFeatures} id="coverage-target-contour-source" type="geojson">
            <Layer
              {...targetContourHaloLayer(
                variant.cssVars["--bg"] ?? linkColor,
                simulationLoadingOverlayActive,
              )}
            />
            <Layer
              {...targetContourLineLayer(
                variant.cssVars["--muted"] ?? selectedLinkColor,
                simulationLoadingOverlayActive,
              )}
            />
          </Source>
        ) : null}

        {userLocationFix ? (
          <Source data={userLocationAccuracyGeoJson} id="user-location-accuracy" type="geojson">
            <Layer {...userLocationAccuracyLayer(userLocationSelectionColor)} />
          </Source>
        ) : null}

        <Source data={lineFeatures} id="links" type="geojson">
          <Layer {...mapLineLayer(linkColor, selectedLinkColor)} />
        </Source>

        {sites.map((site) => {
          const isEditedSiteInSimulation =
            mapEditor?.kind === "site" &&
            !mapEditor.isNew &&
            mapEditor.resourceId !== null &&
            site.libraryEntryId === mapEditor.resourceId &&
            mapEditorSiteDraft !== null;
          const isSelected = isEditedSiteInSimulation || (!armAddSiteOnNextEmptyMapClick && selectedSiteSet.has(site.id));
          const pendingMove = pendingSiteMoves[site.id];
          const markerPosition = isEditedSiteInSimulation
            ? { lat: mapEditorSiteDraft.lat, lon: mapEditorSiteDraft.lon }
            : pendingMove?.currentPosition ?? site.position;
          const isTemporarilyMoved = Boolean(pendingMove);
          const isPassFailMode = coverageVizMode === "passfail" && Boolean(selectedFromSite);
          const isRelayMode = coverageVizMode === "relay" && Boolean(selectedFromSite) && Boolean(selectedToSite);
          const isFocusNode = isPassFailMode
            ? site.id === selectedFromSite?.id
            : isRelayMode
              ? site.id === selectedFromSite?.id || site.id === selectedToSite?.id
              : true;
          const markerZIndex = isSelected ? 4 : isTemporarilyMoved ? 3 : isFocusNode ? 2 : 1;
          return (
            <Marker
              anchor="bottom"
              draggable={canPersist}
              key={site.id}
              latitude={markerPosition.lat}
              longitude={markerPosition.lon}
              offset={SITE_PIN_MARKER_OFFSET}
              style={{ zIndex: markerZIndex }}
              onDrag={isEditedSiteInSimulation ? undefined : (event) => onSiteDrag(site.id, event)}
              onDragEnd={isEditedSiteInSimulation ? onEditorSiteDraftDragEnd : (event) => onSiteDragEnd(site.id, event)}
            >
              <MarkerActionButton
                ariaLabel={site.name}
                className={`map-site-surface ${isSelected ? "is-selected" : ""} ${isTemporarilyMoved ? "is-temporary" : ""}`}
                pointerTail
                pointerTone={isSelected ? "selection" : "temporary"}
                tone={isFocusNode ? "default" : "muted"}
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
                <SiteMarkerIcon site={site} />
                <span>{site.name}</span>
              </MarkerActionButton>
            </Marker>
          );
        })}

        {showDiscoverySites
          ? visibleLibrarySites.map((entry) => (
              <Marker
                anchor="bottom"
                key={`discover-site-${entry.id}`}
                latitude={entry.position.lat}
                longitude={entry.position.lon}
                offset={SITE_PIN_MARKER_OFFSET}
                style={{ zIndex: 1 }}
              >
                <MarkerActionButton
                  ariaLabel={entry.name}
                  className="map-site-surface is-temporary"
                  pointerTail
                  pointerTone="temporary"
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
                  <SiteMarkerIcon site={entry} />
                  <span>{entry.name}</span>
                </MarkerActionButton>
              </Marker>
            ))
          : null}

        {showDiscoveryMqtt
          ? (mqttTooDenseInView ? [] : mqttNodesInView).map((node) => (
              <Marker
                anchor="bottom"
                key={`discover-mqtt-${node.nodeId}`}
                latitude={node.lat}
                longitude={node.lon}
                offset={SITE_PIN_MARKER_OFFSET}
                style={{ zIndex: 1 }}
              >
                <MarkerActionButton
                  ariaLabel={node.longName ?? node.shortName ?? node.nodeId}
                  className="map-site-surface is-temporary"
                  pointerTail
                  pointerTone="temporary"
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
            offset={SITE_PIN_MARKER_OFFSET}
            style={{ zIndex: 3 }}
            onDragEnd={onPendingNewSiteDragEnd}
          >
            <Surface variant="pill" className="map-site-surface is-temporary" pointerTail pointerTone="temporary">
              <span>New Site</span>
            </Surface>
          </Marker>
        ) : null}

        {mapEditor?.kind === "site" &&
        mapEditorSiteDraft &&
        (mapEditor.isNew || !sites.some((site) => site.libraryEntryId === mapEditor.resourceId)) ? (
          <Marker
            anchor="bottom"
            draggable={canPersist}
            latitude={mapEditorSiteDraft.lat}
            longitude={mapEditorSiteDraft.lon}
            offset={SITE_PIN_MARKER_OFFSET}
            style={{ zIndex: 4 }}
            onDragEnd={onEditorSiteDraftDragEnd}
          >
            <Surface variant="pill" className="map-site-surface is-selected" pointerTail pointerTone="selection">
              <span>{mapEditor.isNew ? "New Site" : mapEditor.label}</span>
            </Surface>
          </Marker>
        ) : null}

        {userLocationFix ? (
          <Marker
            anchor="center"
            latitude={userLocationFix.lat}
            longitude={userLocationFix.lon}
            style={{ zIndex: pendingNewSiteDraft ? 2 : 5 }}
          >
            <button
              type="button"
              aria-label={`User location, ${userLocationFix.lat.toFixed(5)}, ${userLocationFix.lon.toFixed(5)}, ${fmtAccuracy(userLocationFix.accuracyM)}`}
              className={`user-location-marker ${canPersist && !pendingNewSiteDraft ? "" : "is-muted"}`}
              title="User location"
              onMouseEnter={() =>
                setOverlayHoverInfo({
                  text: `User location · ${userLocationFix.lat.toFixed(5)}, ${userLocationFix.lon.toFixed(5)} · ${fmtAccuracy(userLocationFix.accuracyM)}`,
                })
              }
              onMouseLeave={() => setOverlayHoverInfo(null)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginUserLocationSiteDraft();
              }}
            />
          </Marker>
        ) : null}

        {cursorPoint ? (
          <Marker
            anchor="center"
            latitude={cursorPoint.lat}
            longitude={cursorPoint.lon}
            style={{ zIndex: 0 }}
          >
            <div className="profile-map-cursor" />
          </Marker>
        ) : null}
        {selectionCount === 1 && activePanoramaFocus && singleSelectedSite && activePanoramaFocus.siteId === singleSelectedSite.id ? (
          <Marker
            anchor="center"
            latitude={activePanoramaFocus.endpoint.lat}
            longitude={activePanoramaFocus.endpoint.lon}
            style={{ zIndex: 0 }}
          >
            <div className="profile-map-cursor panorama-map-cursor" />
          </Marker>
        ) : null}
      </Map>
    </div>
  );
}
