import { scaleLinear } from "d3-scale";
import { Surface } from "./ui/Surface";
import { Info, MapPinned, Paintbrush, PanelBottomClose, PanelBottomOpen, Mountain, MountainSnow, RadioTower, Settings, Tags } from "lucide-react";
import { createPortal } from "react-dom";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "../lib/latestOnlyTaskScheduler";
import { dispatchPanoramaInteraction } from "../lib/panoramaEvents";
import {
  buildPanorama,
  qualityToSampling,
  resolvePanoramaSampling,
  type PanoramaNodeCandidate,
  type PanoramaNodeProjection,
  type PanoramaQuality,
  type PanoramaRay,
  type PanoramaResult,
  type PanoramaRaySample,
} from "../lib/panorama";
import { composePanoramaWindow } from "../lib/panoramaCompose";
import { resolveVisiblePanoramaLabels, type PanoramaLabelCandidate } from "../lib/panoramaLabels";
import { loadPanoramaPeaks, type PanoramaPeakCandidate } from "../lib/panoramaPeaks";
import { isPeakLosVisible, nearestSampleForDistance } from "../lib/panoramaLos";
import { buildDepthBands, buildNearBiasedDepthFractions, resolveRenderedEndpoint } from "../lib/panoramaRender";
import { cardinalLabelForAzimuth, formatAzimuthTick, fovScaleToSpanDeg, FOV_SCALE_DEFAULT, FOV_SCALE_MAX, FOV_SCALE_MIN, mod360, normalizeFovScale, resolvePanoramaWindow, unwrapAzimuthForWindow } from "../lib/panoramaView";
import { centerForScaledWindow } from "../lib/panoramaViewport";
import { passFailStateLabel } from "../lib/passFailState";
import { sampleSrtmElevation } from "../lib/srtm";
import { useAppStore } from "../store/appStore";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { UiSlider } from "./UiSlider";
import { interpolateHeatmapColor } from "../themes/heatmapColors";

const M = { t: 22, r: 20, b: 32, l: 46 };
const LABEL_RAIL_HEIGHT = 34;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
type Rgb = { r: number; g: number; b: number };

const parseRgb = (value: string): Rgb | null => {
  const text = value.trim();
  if (!text) return null;
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].toLowerCase();
    if (raw.length === 3) {
      return {
        r: Number.parseInt(raw[0] + raw[0], 16),
        g: Number.parseInt(raw[1] + raw[1], 16),
        b: Number.parseInt(raw[2] + raw[2], 16),
      };
    }
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!rgb) return null;
  return {
    r: clamp(Math.round(Number(rgb[1])), 0, 255),
    g: clamp(Math.round(Number(rgb[2])), 0, 255),
    b: clamp(Math.round(Number(rgb[3])), 0, 255),
  };
};

const toCanvasColor = (color: Rgb, alpha: number): string =>
  `rgba(${clamp(Math.round(color.r), 0, 255)}, ${clamp(Math.round(color.g), 0, 255)}, ${clamp(Math.round(color.b), 0, 255)}, ${clamp(alpha, 0, 1).toFixed(3)})`;

const blendRgb = (a: Rgb, b: Rgb, t: number): Rgb => {
  const ratio = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * ratio),
    g: Math.round(a.g + (b.g - a.g) * ratio),
    b: Math.round(a.b + (b.b - a.b) * ratio),
  };
};

const brightenRgb = (color: Rgb, amount: number): Rgb => {
  if (amount === 0) return color;
  if (amount > 0) return blendRgb(color, { r: 255, g: 255, b: 255 }, clamp(amount, 0, 1));
  return blendRgb(color, { r: 0, g: 0, b: 0 }, clamp(-amount, 0, 1));
};

const resolveCssColor = (value: string, fallback: string): string => {
  if (typeof document === "undefined") return fallback;
  const sample = document.createElement("span");
  sample.style.color = value;
  document.body.appendChild(sample);
  const resolved = getComputedStyle(sample).color;
  sample.remove();
  return resolved || fallback;
};

type PanoramaChartProps = {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  showExpandToggle?: boolean;
  rowControls?: ReactNode;
  panelClassName?: string;
};

type HoverTarget =
  | {
      kind: "terrain";
      x: number;
      y: number;
      azimuthDeg: number;
      sample: PanoramaRaySample | null;
      ray: PanoramaRay;
    }
  | {
      kind: "node";
      x: number;
      y: number;
      azimuthDeg: number;
      node: PanoramaNodeProjection;
    };

const pointerDistance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

export function PanoramaChart({ isExpanded, onToggleExpanded, showExpandToggle = true, rowControls, panelClassName }: PanoramaChartProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const legendButtonRef = useRef<HTMLButtonElement | null>(null);
  const legendPopoverRef = useRef<HTMLDivElement | null>(null);
  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ distance: number; fovScale: number; spanDeg: number; centerDeg: number } | null>(null);
  const panDragRef = useRef<{ pointerId: number; startX: number; startCenterDeg: number } | null>(null);
  const scrubDragRef = useRef<{ pointerId: number; startX: number; startCenterDeg: number } | null>(null);
  const wheelGestureUnlockTimerRef = useRef<number | null>(null);
  const [gestureLockActive, setGestureLockActive] = useState(false);

  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportCenterAzimuthDeg, setViewportCenterAzimuthDeg] = useState(180);
  const [exaggeration, setExaggeration] = useState(4);
  const [mapHoverZoomEnabled, setMapHoverZoomEnabled] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [terrainDistanceHeatmap, setTerrainDistanceHeatmap] = useState(false);
  const [fovScale, setFovScale] = useState(FOV_SCALE_DEFAULT);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [pinnedTarget, setPinnedTarget] = useState<HoverTarget | null>(null);
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const [settingsPopoverPos, setSettingsPopoverPos] = useState<{ left: number; top: number; direction: "up" | "down" } | null>(null);
  const [peakCandidates, setPeakCandidates] = useState<PanoramaPeakCandidate[]>([]);
  const [peakLoadStatus, setPeakLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [, setPeakLoadError] = useState<string | null>(null);
  const { theme: themeMode } = useThemeVariant();
  const shadingHazeStart = themeMode === "dark" ? 0.5 : 0;
  const [legendPopoverOpen, setLegendPopoverOpen] = useState(false);
  const [legendPopoverPos, setLegendPopoverPos] = useState<{ left: number; top: number; direction: "up" | "down" } | null>(null);
  const peakErrorLogTsRef = useRef(0);


  const sites = useAppStore((state) => state.sites);
  const links = useAppStore((state) => state.links);
  const selectedSiteIds = useAppStore((state) => state.selectedSiteIds);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const networks = useAppStore((state) => state.networks);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const siteDragPreview = useAppStore((state) => state.siteDragPreview);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const discoveryLibraryVisible = useAppStore((state) => state.discoveryLibraryVisible);
  const discoveryMqttVisible = useAppStore((state) => state.discoveryMqttVisible);
  const mqttNodes = useAppStore((state) => state.mapDiscoveryMqttNodes);
  const terrainLoadEpoch = useAppStore((state) => state.terrainLoadEpoch);

  const selectedSite = useMemo(
    () => selectedSiteIds.map((id) => sites.find((site) => site.id === id)).find((site): site is (typeof sites)[number] => Boolean(site)) ?? null,
    [selectedSiteIds, sites],
  );
  const selectedNetwork = networks.find((network) => network.id === selectedNetworkId) ?? networks[0] ?? null;

  const previewCount = Object.keys(siteDragPreview).length;
  const quality: PanoramaQuality = previewCount > 0 ? "drag" : "full";
  const normalizedFovScale = normalizeFovScale(fovScale);
  const viewportSpanDeg = fovScaleToSpanDeg(normalizedFovScale);

  useLayoutEffect(() => {
    const element = chartHostRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 1 || height <= 1) return;
      setChartSize((current) => {
        if (current && current.width === width && current.height === height) return current;
        return { width, height };
      });
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const host = chartHostRef.current;
    const scrub = scrollbarTrackRef.current;
    if (!host || !scrub) return;
    const captureWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const captureTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener("wheel", captureWheel, { passive: false, capture: true });
    scrub.addEventListener("wheel", captureWheel, { passive: false, capture: true });
    host.addEventListener("touchmove", captureTouchMove, { passive: false, capture: true });
    scrub.addEventListener("touchmove", captureTouchMove, { passive: false, capture: true });
    return () => {
      host.removeEventListener("wheel", captureWheel, true);
      scrub.removeEventListener("wheel", captureWheel, true);
      host.removeEventListener("touchmove", captureTouchMove, true);
      scrub.removeEventListener("touchmove", captureTouchMove, true);
    };
  }, [chartSize]);

  useEffect(() => {
    const root = document.documentElement;
    if (gestureLockActive) root.classList.add("panorama-gesture-lock");
    else root.classList.remove("panorama-gesture-lock");
    return () => root.classList.remove("panorama-gesture-lock");
  }, [gestureLockActive]);

  useEffect(
    () => () => {
      if (wheelGestureUnlockTimerRef.current != null) {
        window.clearTimeout(wheelGestureUnlockTimerRef.current);
        wheelGestureUnlockTimerRef.current = null;
      }
    },
    [],
  );

  const baseSchedulerRef = useRef(createLatestOnlyTaskScheduler());
  const detailSchedulerRef = useRef(createLatestOnlyTaskScheduler());
  const cacheRef = useRef<Map<string, PanoramaResult>>(new Map());
  const detailContextRef = useRef<string>("");
  const [basePanorama, setBasePanorama] = useState<PanoramaResult | null>(null);
  const [detailPanoramas, setDetailPanoramas] = useState<PanoramaResult[]>([]);

  const selectedSiteEffective = useMemo(() => {
    if (!selectedSite) return null;
    const preview = siteDragPreview[selectedSite.id];
    if (!preview) return selectedSite;
    return {
      ...selectedSite,
      position: preview.position,
      groundElevationM: preview.groundElevationM,
    };
  }, [selectedSite, siteDragPreview]);

  const nodeCandidates = useMemo<PanoramaNodeCandidate[]>(() => {
    const simulation = sites.map((site) => ({
      id: `sim:${site.id}`,
      name: site.name,
      lat: site.position.lat,
      lon: site.position.lon,
      groundElevationM: site.groundElevationM,
      antennaHeightM: site.antennaHeightM,
      rxGainDbi: site.rxGainDbi,
    }));

    const libraryById = new Set(simulation.map((entry) => entry.id.replace("sim:", "")));
    const sharedLibrary = discoveryLibraryVisible
      ? siteLibrary
          .filter((entry) => (entry.visibility === "shared" || entry.visibility === "public") && !libraryById.has(entry.id))
          .map((entry) => ({
            id: `lib:${entry.id}`,
            name: entry.name,
            lat: entry.position.lat,
            lon: entry.position.lon,
            groundElevationM: entry.groundElevationM,
            antennaHeightM: entry.antennaHeightM,
            rxGainDbi: entry.rxGainDbi,
          }))
      : [];

    const mqtt = discoveryMqttVisible
      ? mqttNodes.map((node) => ({
          id: `mqtt:${node.nodeId}`,
          name: node.longName ?? node.shortName ?? node.nodeId,
          lat: node.lat,
          lon: node.lon,
          groundElevationM: node.altitudeM ?? 0,
          antennaHeightM: 2,
          rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
        }))
      : [];

    return [...simulation, ...sharedLibrary, ...mqtt];
  }, [sites, siteLibrary, mqttNodes, discoveryLibraryVisible, discoveryMqttVisible]);

  useEffect(() => {
    setPinnedTarget(null);
    setHoverTarget(null);
  }, [selectedSiteEffective?.id]);

  useEffect(() => {
    if (!selectedSiteEffective || !chartSize) {
      setPeakCandidates([]);
      setPeakLoadStatus("idle");
      setPeakLoadError(null);
      return;
    }
    let cancelled = false;
    setPeakLoadStatus("loading");
    setPeakLoadError(null);
    const spanDeg = viewportSpanDeg;
    const centerBucketDeg = Math.max(0.5, Math.round(spanDeg / 12));
    const centerDeg = Math.round(viewportCenterAzimuthDeg / centerBucketDeg) * centerBucketDeg;
    const window = resolvePanoramaWindow(centerDeg, spanDeg);
    void loadPanoramaPeaks({
      origin: selectedSiteEffective.position,
      centerDeg,
      startDeg: window.startDeg,
      endDeg: window.endDeg,
      maxDistanceKm: 500,
      limit: 3200,
      allowNetwork: quality !== "drag",
    }).then((peaks) => {
      if (!cancelled) {
        setPeakCandidates(peaks);
        setPeakLoadStatus("ready");
      }
    }).catch((error) => {
      if (cancelled) return;
      setPeakLoadStatus("error");
      setPeakLoadError(error instanceof Error ? error.message : String(error));
      const now = Date.now();
      if (now - peakErrorLogTsRef.current > 2_000) {
        peakErrorLogTsRef.current = now;
        console.error("[panorama] peak loading failed", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSiteEffective, chartSize, viewportCenterAzimuthDeg, viewportSpanDeg, quality]);

  useEffect(() => {
    if (!selectedSiteEffective || !selectedNetwork) {
      setBasePanorama(null);
      setDetailPanoramas([]);
      return;
    }

    const effectiveLink = links[0]
      ? {
          ...links[0],
          fromSiteId: selectedSiteEffective.id,
          toSiteId: selectedSiteEffective.id,
          frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz,
          txPowerDbm: selectedSiteEffective.txPowerDbm,
          txGainDbi: selectedSiteEffective.txGainDbi,
          rxGainDbi: selectedSiteEffective.rxGainDbi,
          cableLossDb: selectedSiteEffective.cableLossDb,
        }
      : {
          id: "__panorama__",
          fromSiteId: selectedSiteEffective.id,
          toSiteId: selectedSiteEffective.id,
          frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz,
          txPowerDbm: selectedSiteEffective.txPowerDbm,
          txGainDbi: selectedSiteEffective.txGainDbi,
          rxGainDbi: selectedSiteEffective.rxGainDbi,
          cableLossDb: selectedSiteEffective.cableLossDb,
        };

    const baseSampling = { ...qualityToSampling("drag"), azimuthStepDeg: 1 };
    const detailSampling = resolvePanoramaSampling(quality, { zoomModeEnabled: true, fovScale: normalizedFovScale });
    const detailCenterBucketSizeDeg = Math.max(1, Math.round(detailSampling.azimuthStepDeg * 4));
    const detailCenterBucketDeg = Math.round(viewportCenterAzimuthDeg / detailCenterBucketSizeDeg) * detailCenterBucketSizeDeg;

    const baseSignature = [
      "panorama-base",
      selectedSiteEffective.id,
      selectedSiteEffective.position.lat.toFixed(6),
      selectedSiteEffective.position.lon.toFixed(6),
      selectedSiteEffective.groundElevationM,
      selectedSiteEffective.antennaHeightM,
      selectedNetwork.id,
      effectiveLink.frequencyMHz,
      propagationEnvironment.atmosphericBendingNUnits,
      propagationEnvironment.clutterHeightM,
      baseSampling.azimuthStepDeg,
      baseSampling.radialSamples,
      terrainLoadEpoch,
      srtmTiles.length,
      nodeCandidates.length,
      rxSensitivityTargetDbm,
      environmentLossDb,
    ].join("|");

    const detailContextKey = [
      selectedSiteEffective.id,
      selectedSiteEffective.position.lat.toFixed(6),
      selectedSiteEffective.position.lon.toFixed(6),
      selectedSiteEffective.groundElevationM,
      selectedSiteEffective.antennaHeightM,
      selectedNetwork.id,
      effectiveLink.frequencyMHz,
      propagationEnvironment.atmosphericBendingNUnits,
      propagationEnvironment.clutterHeightM,
      quality,
      normalizedFovScale.toFixed(2),
      viewportSpanDeg.toFixed(3),
      detailSampling.azimuthStepDeg,
      detailSampling.radialSamples,
      terrainLoadEpoch,
      srtmTiles.length,
      nodeCandidates.length,
      rxSensitivityTargetDbm,
      environmentLossDb,
    ].join("|");

    const detailSignature = [
      "panorama-detail",
      detailContextKey,
      detailCenterBucketDeg.toFixed(3),
    ].join("|");

    if (detailContextRef.current !== detailContextKey) {
      detailContextRef.current = detailContextKey;
      setDetailPanoramas([]);
    }

    const cachedBase = cacheRef.current.get(baseSignature);
    if (cachedBase) setBasePanorama(cachedBase);
    const cachedDetail = cacheRef.current.get(detailSignature);
    if (cachedDetail) {
      setDetailPanoramas((current) => {
        const bucketKey = cachedDetail.coverageCenterDeg.toFixed(3);
        const next = [...current.filter((entry) => entry.coverageCenterDeg.toFixed(3) !== bucketKey), cachedDetail];
        next.sort((a, b) => a.coverageCenterDeg - b.coverageCenterDeg);
        return next.slice(-12);
      });
    }

    if (!cachedBase) {
      const scheduler = baseSchedulerRef.current;
      scheduler.clearQueue();
      scheduler.cancelActive();
      scheduler.enqueue({
        signature: baseSignature,
        run: async (context) => {
          const result = buildPanorama({
            selectedSite: selectedSiteEffective,
            effectiveLink,
            propagationEnvironment,
            rxSensitivityTargetDbm,
            environmentLossDb,
            quality: "drag",
            terrainSampler: (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
            nodeCandidates,
            options: {
              baseRadiusKm: 50,
              maxRadiusKm: 200,
              azimuthStepDeg: baseSampling.azimuthStepDeg,
              radialSamples: baseSampling.radialSamples,
            },
          });
          if (context.isCancelled()) return;
          cacheRef.current.set(baseSignature, result);
          if (cacheRef.current.size > 90) {
            const oldest = cacheRef.current.keys().next().value;
            if (oldest) cacheRef.current.delete(oldest);
          }
          setBasePanorama(result);
        },
      } satisfies LatestOnlyTask);
    }

    if (!cachedDetail) {
      const scheduler = detailSchedulerRef.current;
      scheduler.clearQueue();
      scheduler.cancelActive();
      scheduler.enqueue({
        signature: detailSignature,
        run: async (context) => {
          const result = buildPanorama({
            selectedSite: selectedSiteEffective,
            effectiveLink,
            propagationEnvironment,
            rxSensitivityTargetDbm,
            environmentLossDb,
            quality,
            terrainSampler: (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
            nodeCandidates,
            options: {
              baseRadiusKm: 50,
              maxRadiusKm: 200,
              azimuthStepDeg: detailSampling.azimuthStepDeg,
              radialSamples: detailSampling.radialSamples,
              windowCenterDeg: detailCenterBucketDeg,
              windowSpanDeg: viewportSpanDeg,
            },
          });
          if (context.isCancelled()) return;
          cacheRef.current.set(detailSignature, result);
          if (cacheRef.current.size > 90) {
            const oldest = cacheRef.current.keys().next().value;
            if (oldest) cacheRef.current.delete(oldest);
          }
          setDetailPanoramas((current) => {
            const bucketKey = result.coverageCenterDeg.toFixed(3);
            const next = [...current.filter((entry) => entry.coverageCenterDeg.toFixed(3) !== bucketKey), result];
            next.sort((a, b) => a.coverageCenterDeg - b.coverageCenterDeg);
            return next.slice(-12);
          });
        },
      } satisfies LatestOnlyTask);
    }
  }, [
    selectedSiteEffective,
    selectedNetwork,
    links,
    propagationEnvironment,
    quality,
    srtmTiles,
    nodeCandidates,
    rxSensitivityTargetDbm,
    environmentLossDb,
    terrainLoadEpoch,
    normalizedFovScale,
    viewportCenterAzimuthDeg,
    viewportSpanDeg,
  ]);

  const panorama = detailPanoramas[detailPanoramas.length - 1] ?? basePanorama;

  const chartWidth = chartSize?.width ?? 0;
  const chartHeight = chartSize?.height ?? 0;

  const xWindow = useMemo(
    () => resolvePanoramaWindow(viewportCenterAzimuthDeg, viewportSpanDeg),
    [viewportCenterAzimuthDeg, viewportSpanDeg],
  );

  const composedWindow = useMemo(
    () =>
      composePanoramaWindow({
        basePanorama,
        detailPanoramas,
        centerDeg: xWindow.centerDeg,
        startDeg: xWindow.startDeg,
        endDeg: xWindow.endDeg,
      }),
    [basePanorama, detailPanoramas, xWindow],
  );

  const geometry = useMemo(() => {
    if (!panorama || !chartSize || !panorama.rays.length) return null;
    const anchorPanorama = basePanorama && basePanorama.rays.length ? basePanorama : panorama;

    const xDomainStart = xWindow.startDeg;
    const xDomainEnd = xWindow.endDeg;
    const xSpan = Math.max(0.001, xDomainEnd - xDomainStart);
    const x = scaleLinear().domain([xDomainStart, xDomainEnd]).range([M.l, chartWidth - M.r]);
    const xCenterForUnwrap = xWindow.centerDeg;
    const plotTop = M.t + LABEL_RAIL_HEIGHT;
    const plotBottom = chartHeight - M.b;

    const visibleRays = composedWindow.rays
      .map((entry) => ({ ray: entry.ray, xValue: entry.xValue, source: entry.source }))
      .sort((a, b) => a.xValue - b.xValue);

    if (!visibleRays.length) return null;

    const minHorizon = Math.min(...anchorPanorama.rays.map((ray) => ray.horizonAngleDeg));
    const maxHorizon = Math.max(...anchorPanorama.rays.map((ray) => ray.horizonAngleDeg));
    // Use the stable 360° base panorama for the Y-domain top anchor so that
    // panning doesn't cause the viewport to jump as detail panoramas load in.
    const stablePanorama = basePanorama ?? anchorPanorama;
    const stableMaxSampleAngle = Math.max(...stablePanorama.rays.flatMap((ray) => ray.samples.map((sample) => sample.angleDeg)));
    const stableMinSampleAngle = Math.min(...stablePanorama.rays.flatMap((ray) => ray.samples.map((sample) => sample.angleDeg)));

    const innerWidth = Math.max(1, chartWidth - M.l - M.r);
    const innerHeight = Math.max(1, plotBottom - plotTop);
    const horizonPad = 0.5;

    const fitMin = minHorizon - horizonPad;
    const fitMax = maxHorizon + horizonPad;
    const pixelsPerDegX = innerWidth / xSpan;
    const ySpanDeg = innerHeight / Math.max(0.001, pixelsPerDegX);
    // Compute the natural vertical span from the stable 360° base panorama so
    // the domain doesn't jump as detail panoramas load while panning.
    let trueMax = stableMaxSampleAngle + 0.2;
    let trueMin = trueMax - ySpanDeg;
    if (trueMin > stableMinSampleAngle - 0.2) {
      trueMin = stableMinSampleAngle - 0.2;
    }

    // 1x = natural proportions (same px/deg vertically and horizontally).
    // Higher exaggeration zooms in on terrain by shrinking the vertical domain.
    const naturalSpan = Math.max(0.001, trueMax - trueMin);
    const domainHeight = naturalSpan / Math.max(1, exaggeration);
    // Anchor the top of the viewport to the stable highest terrain (+ small padding).
    let domainMax = stableMaxSampleAngle + 0.2 + domainHeight * 0.06;
    let domainMin = domainMax - domainHeight;

    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) {
      domainMin = panorama.minAngleDeg;
      domainMax = panorama.maxAngleDeg;
    }

    const y = scaleLinear().domain([domainMin, domainMax]).range([plotBottom, plotTop]);

    const ridgeFractions = buildNearBiasedDepthFractions(10);
    const depthBands = buildDepthBands(
      visibleRays.map((entry) => entry.ray),
      ridgeFractions,
      (ray, sample) => {
        const xValue = unwrapAzimuthForWindow(ray.azimuthDeg, xCenterForUnwrap);
        const angleDeg = sample?.angleDeg ?? ray.horizonAngleDeg;
        return { x: x(xValue), y: y(angleDeg), angleDeg };
      },
      {
        ridgeSnap: {
          enabled: true,
          windowRatio: 0.08,
        },
        smoothing: {
          enabled: true,
          strength: 0.23,
          maxDeviationDeg: 0.24,
          crestGuardDeg: 0.5,
        },
      },
    );
    // Build regular ticks, then inject cardinal directions (N/S/E/W) that fall
    // within the visible window. Deduplicate: if a cardinal is within 5° of a
    // regular tick, the regular tick is dropped in favour of the cardinal.
    const regularTickValues = Array.from({ length: 7 }, (_, index) => {
      const ratio = index / 6;
      return xDomainStart + (xDomainEnd - xDomainStart) * ratio;
    });
    type AzimuthTick = { value: number; isCardinal: boolean; isNorth: boolean };
    const cardinalBases = [0, 90, 180, 270, 360, -90, -180];
    const cardinalTicks: AzimuthTick[] = cardinalBases
      .filter((v) => v >= xDomainStart - 0.5 && v <= xDomainEnd + 0.5)
      .map((v) => ({ value: v, isCardinal: true, isNorth: v % 360 === 0 }));
    const dedupeThreshold = 5;
    const regularTicks: AzimuthTick[] = regularTickValues
      .filter((v) => !cardinalTicks.some((c) => Math.abs(c.value - v) < dedupeThreshold))
      .map((v) => ({ value: v, isCardinal: false, isNorth: false }));
    const ticksX: AzimuthTick[] = [...regularTicks, ...cardinalTicks].sort((a, b) => a.value - b.value);

    const ticksY = [domainMin, (domainMin + domainMax) / 2, domainMax];

    const latestDetail = detailPanoramas[detailPanoramas.length - 1] ?? null;
    const nodeSource = latestDetail?.nodes?.length ? latestDetail.nodes : basePanorama?.nodes ?? panorama.nodes;
    const nodes = nodeSource
      .map((node) => {
        const xValue = unwrapAzimuthForWindow(node.azimuthDeg, xCenterForUnwrap);
        return {
          node,
          xValue,
          cx: x(xValue),
          cy: y(node.elevationAngleDeg),
        };
      })
      .filter((entry) => entry.xValue >= xDomainStart && entry.xValue <= xDomainEnd)
      .filter((entry) => {
        if (entry.node.id.startsWith("sim:")) return true;
        if (entry.node.id.startsWith("lib:") || entry.node.id.startsWith("mqtt:")) return entry.node.visible;
        return true;
      });

    const kFactor = Math.max(0.5, 1 + (propagationEnvironment.atmosphericBendingNUnits - 250) / 153);
    const sourceAbsM = selectedSiteEffective ? selectedSiteEffective.groundElevationM + selectedSiteEffective.antennaHeightM : 0;
    const peakLabels = peakCandidates
      .map((peak) => {
        const xValue = unwrapAzimuthForWindow(peak.azimuthDeg, xCenterForUnwrap);
        if (xValue < xDomainStart || xValue > xDomainEnd) return null;
        const nearestRay = visibleRays.reduce(
          (best, entry) => {
            const dist = Math.abs(entry.xValue - xValue);
            if (dist < best.dist) return { entry, dist };
            return best;
          },
          { entry: visibleRays[0], dist: Number.POSITIVE_INFINITY },
        ).entry.ray;
        const sample = nearestSampleForDistance(nearestRay.samples, peak.distanceKm);
        const visibleLos = isPeakLosVisible({
          samples: nearestRay.samples,
          distanceKm: peak.distanceKm,
          peakElevationM: peak.elevationM,
          sourceAbsM,
          kFactor,
        });
        if (!visibleLos) return null;
        const yAngle = sample?.angleDeg ?? nearestRay.horizonAngleDeg;
        return {
          id: `peak:${peak.id}`,
          source: "peak" as const,
          name: peak.kind === "volcano" ? `🌋 ${peak.name}` : peak.name,
          x: x(xValue),
          y: y(yAngle),
          distanceKm: peak.distanceKm,
          priorityBucket: 1 as const,
          elevationM: peak.elevationM,
        };
      })
      .filter((entry): entry is Exclude<typeof entry, null> => entry !== null);

    const poiLabels: PanoramaLabelCandidate[] = nodes.map((entry) => ({
      id: `poi:${entry.node.id}`,
      source: "poi",
      name: entry.node.name,
      x: entry.cx,
      y: entry.cy,
      distanceKm: entry.node.distanceKm,
      priorityBucket: 0,
      state: entry.node.state,
    }));
    const visibleLabels = showLabels
      ? resolveVisiblePanoramaLabels({
          candidates: [...poiLabels, ...peakLabels],
          chartWidth,
          leftPadding: M.l,
          rightPadding: M.r,
          topY: M.t + 4,
        })
      : [];

    const fitSpan = Math.max(0.001, fitMax - fitMin);
    const trueSpan = Math.max(0.001, trueMax - trueMin);
    const maxVerticalScaleX = Math.max(1, trueSpan / fitSpan);
    return {
      x,
      xWindow,
      y,
      plotTop,
      plotBottom,
      ticksX,
      ticksY,
      nodes,
      labels: visibleLabels,
      maxVerticalScaleX,
      coverageSegments: composedWindow.segments,
      visibleRays,
      depthBands,
    };
  }, [
    panorama,
    basePanorama,
    detailPanoramas,
    composedWindow,
    chartSize,
    chartHeight,
    chartWidth,
    exaggeration,
    xWindow,
    selectedSiteEffective,
    peakCandidates,
    propagationEnvironment.atmosphericBendingNUnits,
    showLabels,
  ]);

  // useLayoutEffect fires synchronously after DOM mutations, same tick as SVG,
  // eliminating the one-frame lag between terrain shading and other chart elements.
  useLayoutEffect(() => {
    const canvas = terrainCanvasRef.current;
    if (!canvas || !geometry || !chartSize) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.max(1, Math.round(chartSize.width * dpr));
    const targetHeight = Math.max(1, Math.round(chartSize.height * dpr));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, chartSize.width, chartSize.height);

    // Resolve CSS color variables once per frame.
    const terrainColor = parseRgb(resolveCssColor("var(--terrain)", "rgb(100,100,100)")) ?? { r: 100, g: 100, b: 100 };
    const surfaceColor = parseRgb(resolveCssColor("var(--surface-2)", "rgb(40,40,40)")) ?? { r: 40, g: 40, b: 40 };
    const textColor = parseRgb(resolveCssColor("var(--text)", "rgb(200,200,200)")) ?? { r: 200, g: 200, b: 200 };
    const mutedColor = parseRgb(resolveCssColor("var(--muted)", "rgb(130,130,130)")) ?? { r: 130, g: 130, b: 130 };
    const borderColor = parseRgb(resolveCssColor("var(--border)", "rgb(80,80,80)")) ?? { r: 80, g: 80, b: 80 };

    const stateColors: Record<string, Rgb> = {
      pass_clear: parseRgb(resolveCssColor("var(--state-pass-clear)", "rgb(76,175,80)")) ?? { r: 76, g: 175, b: 80 },
      pass_blocked: parseRgb(resolveCssColor("var(--state-pass-blocked)", "rgb(255,152,0)")) ?? { r: 255, g: 152, b: 0 },
      fail_clear: parseRgb(resolveCssColor("var(--state-fail-clear)", "rgb(244,67,54)")) ?? { r: 244, g: 67, b: 54 },
      fail_blocked: parseRgb(resolveCssColor("var(--state-fail-blocked)", "rgb(200,50,50)")) ?? { r: 200, g: 50, b: 50 },
    };

    const rays = geometry.visibleRays;
    const cw = chartSize.width;
    const ch = chartSize.height;

    // --- LAYER 1: Terrain quads (rendered opaque to offscreen canvas, composited) ---
    if (rays.length >= 2) {
      const maxDistanceKm = Math.max(
        0.001,
        ...rays.map((entry) => (entry.ray.samples.length ? entry.ray.samples[entry.ray.samples.length - 1]?.distanceKm ?? entry.ray.maxDistanceKm : entry.ray.maxDistanceKm)),
      );
      const validHorizonDistances = rays.map((r) => r.ray.horizonDistanceKm).filter((d): d is number => Number.isFinite(d) && d > 0);
      const maxHorizonDistanceKm = validHorizonDistances.length > 0 ? Math.max(...validHorizonDistances) : maxDistanceKm;
      const maxSampleCount = Math.max(2, ...rays.map((entry) => entry.ray.samples.length));
      const light = { x: -0.62, y: -0.36, z: 0.7 };
      const lightNorm = Math.hypot(light.x, light.y, light.z) || 1;
      const lx = light.x / lightNorm;
      const ly = light.y / lightNorm;
      const lz = light.z / lightNorm;

      // Render terrain to an offscreen canvas at full opacity, then composite.
      // This eliminates seams: adjacent quads rendered semi-transparently would
      // double-render at overlaps, but opaque quads on a separate surface don't.
      const offscreen = document.createElement("canvas");
      offscreen.width = targetWidth;
      offscreen.height = targetHeight;
      const oCtx = offscreen.getContext("2d");
      if (oCtx) {
        oCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        oCtx.clearRect(0, 0, cw, ch);
        oCtx.save();
        oCtx.beginPath();
        oCtx.rect(M.l, geometry.plotTop, cw - M.l - M.r, geometry.plotBottom - geometry.plotTop);
        oCtx.clip();

        // Helper: draw one terrain pass onto oCtx using the given color function.
        const drawTerrainPass = (colorFn: (haze: number, lambert: number, distanceKm?: number) => Rgb) => {
          oCtx.clearRect(0, 0, cw, ch);
          oCtx.save();
          oCtx.beginPath();
          oCtx.rect(M.l, geometry.plotTop, cw - M.l - M.r, geometry.plotBottom - geometry.plotTop);
          oCtx.clip();
          for (let sampleIndex = maxSampleCount - 2; sampleIndex >= 0; sampleIndex -= 1) {
            for (let rayIndex = 0; rayIndex < rays.length - 1; rayIndex += 1) {
              const left = rays[rayIndex];
              const right = rays[rayIndex + 1];
              const s00 = left.ray.samples[sampleIndex];
              const s01 = left.ray.samples[sampleIndex + 1];
              const s10 = right.ray.samples[sampleIndex];
              const s11 = right.ray.samples[sampleIndex + 1];
              if (!s00 || !s01 || !s10 || !s11) continue;

              const x0 = geometry.x(left.xValue);
              const x1 = geometry.x(right.xValue);
              const y00 = geometry.y(s00.angleDeg);
              const y01 = geometry.y(s01.angleDeg);
              const y10 = geometry.y(s10.angleDeg);
              const y11 = geometry.y(s11.angleDeg);

              const dzdx = ((s10.angleDeg - s00.angleDeg) + (s11.angleDeg - s01.angleDeg)) * 0.5;
              const dzdr = ((s01.angleDeg - s00.angleDeg) + (s11.angleDeg - s10.angleDeg)) * 0.5;
              const nx = -dzdx * 0.75;
              const ny = -dzdr * 1.2;
              const nz = 1;
              const norm = Math.hypot(nx, ny, nz) || 1;
              const lambert = Math.max(0, (nx / norm) * lx + (ny / norm) * ly + (nz / norm) * lz);

              const avgDistanceKm = (s00.distanceKm + s01.distanceKm + s10.distanceKm + s11.distanceKm) * 0.25;
              const depth = clamp(avgDistanceKm / maxDistanceKm, 0, 1);
              const haze = Math.pow(depth, 1.15);

              oCtx.fillStyle = toCanvasColor(colorFn(haze, lambert, avgDistanceKm), 1);
              oCtx.beginPath();
              oCtx.moveTo(x0, y00);
              oCtx.lineTo(x1 + 0.5, y10);
              oCtx.lineTo(x1 + 0.5, y11);
              oCtx.lineTo(x0, y01);
              oCtx.closePath();
              oCtx.fill();
            }
          }
          oCtx.restore();
        };

        // Pass 1: Relief shading (always rendered).
        drawTerrainPass((haze, lambert, avgDistanceKm) => {
          let base: Rgb;
          if (terrainDistanceHeatmap && maxHorizonDistanceKm > 0 && avgDistanceKm !== undefined) {
            const normalizedDistance = 1 - avgDistanceKm / maxHorizonDistanceKm;
            base = interpolateHeatmapColor(normalizedDistance);
          } else {
            base = blendRgb(terrainColor, surfaceColor, shadingHazeStart + haze * 0.55);
          }
          const lighten = lambert > 0.4 ? ((lambert - 0.4) / 0.6) * 1.0 : 0;
          const darken = lambert < 0.4 ? ((0.4 - lambert) / 0.4) * 0.7 : 0;
          return brightenRgb(base, lighten - darken);
        });
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      }
    }

    // --- LAYER 2: Grid lines and tick labels ---
    const gridLineColor = toCanvasColor(borderColor, 0.82);
    ctx.strokeStyle = gridLineColor;
    ctx.lineWidth = 1;
    ctx.font = '500 12px "IBM Plex Mono", monospace';
    ctx.fillStyle = toCanvasColor(mutedColor, 1);

    // Y-axis horizontal grid lines
    for (const value of geometry.ticksY) {
      const gy = geometry.y(value);
      ctx.beginPath();
      ctx.moveTo(M.l, gy);
      ctx.lineTo(cw - M.r, gy);
      ctx.stroke();
    }
    // Y-axis labels (right-aligned at left margin)
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const value of geometry.ticksY) {
      ctx.fillText(`${value.toFixed(1)}°`, M.l - 8, geometry.y(value));
    }
    // X-axis bottom labels (no vertical grid lines)
    const dangerColor = parseRgb(resolveCssColor("var(--danger)", "rgb(255,107,107)")) ?? { r: 255, g: 107, b: 107 };
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const tick of geometry.ticksX) {
      const gx = geometry.x(tick.value);
      if (tick.isNorth) {
        ctx.font = '700 12px "IBM Plex Mono", monospace';
        ctx.fillStyle = toCanvasColor(dangerColor, 1);
      } else if (tick.isCardinal) {
        ctx.font = '600 12px "IBM Plex Mono", monospace';
        ctx.fillStyle = toCanvasColor(textColor, 0.9);
      } else {
        ctx.font = '500 12px "IBM Plex Mono", monospace';
        ctx.fillStyle = toCanvasColor(mutedColor, 1);
      }
      ctx.fillText(formatAzimuthTick(tick.value), gx, ch - 8);
    }

    // --- LAYER 3: Node circles (clipped to plot) ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.l, geometry.plotTop, cw - M.l - M.r, geometry.plotBottom - geometry.plotTop);
    ctx.clip();

    // Node circles
    ctx.lineWidth = 1.1;
    for (const entry of geometry.nodes) {
      const stateRgb = stateColors[entry.node.state] ?? textColor;
      const strokeRgb = blendRgb(stateRgb, textColor, 0.6);
      const nodeAlpha = entry.node.visible ? 1 : 0.52;
      ctx.fillStyle = toCanvasColor(stateRgb, nodeAlpha);
      ctx.strokeStyle = toCanvasColor(strokeRgb, nodeAlpha);
      ctx.beginPath();
      ctx.arc(entry.cx, entry.cy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    // --- LAYER 4: Label leader lines (text is rendered as HTML overlay) ---
    const labelLineFallbackRgb = blendRgb(textColor, borderColor, 0.72);

    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (const label of geometry.labels) {
      // POI/site labels: use the state colour for the leader line.
      const lineRgb =
        label.source === "poi" && label.state && stateColors[label.state]
          ? blendRgb(stateColors[label.state]!, textColor, 0.4)
          : labelLineFallbackRgb;
      ctx.strokeStyle = toCanvasColor(lineRgb, 0.84);
      ctx.beginPath();
      ctx.moveTo(label.anchorX, label.lineStartY);
      ctx.lineTo(label.x, label.y);
      ctx.stroke();
    }
  }, [geometry, chartSize, shadingHazeStart, terrainDistanceHeatmap]);

  const focusTarget = hoverTarget ?? pinnedTarget;
  const focusAzimuthDeg = focusTarget?.azimuthDeg ?? null;
  const interactionRays = useMemo(() => {
    const rays = composedWindow.rays.map((entry) => entry.ray);
    return rays.length ? rays : panorama?.rays ?? [];
  }, [composedWindow, panorama]);

  const activeRay = useMemo(() => {
    if (!interactionRays.length || focusAzimuthDeg == null) return null;
    return interactionRays.reduce(
      (best, ray) => {
        const dist = Math.abs(unwrapAzimuthForWindow(ray.azimuthDeg, focusAzimuthDeg) - focusAzimuthDeg);
        if (dist < best.distance) return { ray, distance: dist };
        return best;
      },
      { ray: interactionRays[0], distance: Number.POSITIVE_INFINITY },
    ).ray;
  }, [interactionRays, focusAzimuthDeg]);

  useEffect(() => {
    if (!selectedSiteEffective) return;
    if (!focusTarget) {
      dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
      return;
    }
    const renderedEndpoint = resolveRenderedEndpoint({
      hoveredNode: focusTarget.kind === "node" ? focusTarget.node : null,
      hoveredSample: focusTarget.kind === "terrain" ? focusTarget.sample : null,
      hoveredAzimuthDeg: focusTarget.azimuthDeg,
      fallbackRay: null,
    });
    if (!renderedEndpoint) {
      dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
      return;
    }
    dispatchPanoramaInteraction({
      type: "hover",
      payload: {
        siteId: selectedSiteEffective.id,
        azimuthDeg: renderedEndpoint.azimuthDeg,
        endpoint: renderedEndpoint.endpoint,
        horizonDistanceKm: renderedEndpoint.distanceKm,
        focusMode: hoverTarget ? "hover" : pinnedTarget ? "pinned" : "none",
        viewportCenterAzimuthDeg,
        viewportSpanDeg,
        mapHoverZoomEnabled,
      },
    });
  }, [selectedSiteEffective, focusTarget, hoverTarget, pinnedTarget, viewportCenterAzimuthDeg, viewportSpanDeg, mapHoverZoomEnabled]);

  const onScrubPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollbarTrackRef.current) return;
    setGestureLockActive(true);
    const rect = scrollbarTrackRef.current.getBoundingClientRect();
    const xNorm = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    setViewportCenterAzimuthDeg(xNorm * 360);
    scrubDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startCenterDeg: viewportCenterAzimuthDeg };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onScrubPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubDragRef.current || scrubDragRef.current.pointerId !== event.pointerId || !scrollbarTrackRef.current) return;
    const rect = scrollbarTrackRef.current.getBoundingClientRect();
    const deltaNorm = (event.clientX - scrubDragRef.current.startX) / Math.max(1, rect.width);
    setViewportCenterAzimuthDeg(mod360(scrubDragRef.current.startCenterDeg + deltaNorm * 360));
    event.preventDefault();
  };

  const onScrubPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubDragRef.current?.pointerId === event.pointerId) scrubDragRef.current = null;
    setGestureLockActive(false);
  };

  const applyFovAtFocal = useCallback(
    (nextScale: number, focalNorm: number) => {
      const clamped = normalizeFovScale(nextScale);
      const oldSpan = fovScaleToSpanDeg(normalizedFovScale);
      const newSpan = fovScaleToSpanDeg(clamped);
      const nextCenter = centerForScaledWindow(viewportCenterAzimuthDeg, oldSpan, newSpan, focalNorm);
      setFovScale(clamped);
      setViewportCenterAzimuthDeg(nextCenter);
    },
    [normalizedFovScale, viewportCenterAzimuthDeg],
  );

  const onWheelPanorama = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setGestureLockActive(true);
    if (wheelGestureUnlockTimerRef.current != null) {
      window.clearTimeout(wheelGestureUnlockTimerRef.current);
      wheelGestureUnlockTimerRef.current = null;
    }
    wheelGestureUnlockTimerRef.current = window.setTimeout(() => {
      setGestureLockActive(false);
      wheelGestureUnlockTimerRef.current = null;
    }, 160);
    const rect = event.currentTarget.getBoundingClientRect();
    const focalNorm = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    if (event.ctrlKey) {
      const nextScale = normalizeFovScale(normalizedFovScale * Math.exp(-event.deltaY * 0.01));
      applyFovAtFocal(nextScale, focalNorm);
      return;
    }
    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (dominantDelta === 0) return;
    const deltaDeg = (dominantDelta / Math.max(1, chartWidth - M.l - M.r)) * viewportSpanDeg;
    setViewportCenterAzimuthDeg((current) => mod360(current + deltaDeg));
  };

  const onPointerDownPanorama = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    setGestureLockActive(true);
    panDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startCenterDeg: viewportCenterAzimuthDeg };
    event.currentTarget.setPointerCapture(event.pointerId);
    pinchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchPointersRef.current.size === 2) {
      const [a, b] = [...pinchPointersRef.current.values()];
      pinchStartRef.current = {
        distance: Math.max(1, pointerDistance(a, b)),
        fovScale: normalizedFovScale,
        spanDeg: viewportSpanDeg,
        centerDeg: viewportCenterAzimuthDeg,
      };
    }
  };

  const onPointerMovePanorama = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pinchPointersRef.current.has(event.pointerId)) return;
    pinchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchPointersRef.current.size === 1 && panDragRef.current?.pointerId === event.pointerId) {
      const innerWidth = Math.max(1, chartWidth - M.l - M.r);
      const deltaDeg = ((panDragRef.current.startX - event.clientX) / innerWidth) * viewportSpanDeg;
      setViewportCenterAzimuthDeg(mod360(panDragRef.current.startCenterDeg + deltaDeg));
      event.preventDefault();
      return;
    }
    if (pinchPointersRef.current.size !== 2 || !pinchStartRef.current) return;
    const [a, b] = [...pinchPointersRef.current.values()];
    const distance = Math.max(1, pointerDistance(a, b));
    const rect = event.currentTarget.getBoundingClientRect();
    const midX = (a.x + b.x) * 0.5;
    const focalNorm = clamp((midX - rect.left) / Math.max(1, rect.width), 0, 1);
    const scaleFactor = distance / Math.max(1, pinchStartRef.current.distance);
    const nextScale = normalizeFovScale(pinchStartRef.current.fovScale * scaleFactor);
    const nextSpan = fovScaleToSpanDeg(nextScale);
    const nextCenter = centerForScaledWindow(
      pinchStartRef.current.centerDeg,
      pinchStartRef.current.spanDeg,
      nextSpan,
      focalNorm,
    );
    setFovScale(nextScale);
    setViewportCenterAzimuthDeg(nextCenter);
    event.preventDefault();
  };

  const onPointerEndPanorama = (event: React.PointerEvent<HTMLDivElement>) => {
    pinchPointersRef.current.delete(event.pointerId);
    if (panDragRef.current?.pointerId === event.pointerId) panDragRef.current = null;
    if (pinchPointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (!panDragRef.current && pinchPointersRef.current.size === 0) {
      setGestureLockActive(false);
    }
  };

  const onMove = (event: ReactMouseEvent<SVGRectElement>) => {
    if (!geometry || !interactionRays.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const xPx = M.l + xNorm * (chartWidth - M.l - M.r);
    const yPx = geometry.plotTop + yNorm * (chartHeight - geometry.plotTop - M.b);

    const unwrapped = geometry.x.invert(xPx);
    const azimuth = mod360(unwrapped);

    const nearestRay = interactionRays.reduce(
      (best, ray) => {
        const dist = Math.abs(unwrapAzimuthForWindow(ray.azimuthDeg, azimuth) - azimuth);
        return dist < best.distance ? { ray, distance: dist } : best;
      },
      { ray: interactionRays[0], distance: Number.POSITIVE_INFINITY },
    ).ray;

    let nearestNode: { node: PanoramaNodeProjection; cx: number; cy: number; distancePx: number } | null = null;
    for (const node of geometry.nodes) {
      const dx = node.cx - xPx;
      const dy = node.cy - yPx;
      const distancePx = Math.sqrt(dx * dx + dy * dy);
      if (distancePx > 12) continue;
      if (!nearestNode || distancePx < nearestNode.distancePx) {
        nearestNode = { node: node.node, cx: node.cx, cy: node.cy, distancePx };
      }
    }

    if (nearestNode) {
      setHoverTarget({
        kind: "node",
        x: nearestNode.cx,
        y: nearestNode.cy,
        azimuthDeg: nearestNode.node.azimuthDeg,
        node: nearestNode.node,
      });
      return;
    }

    const sample =
      nearestRay.samples.find((entry) => Math.abs(entry.distanceKm - nearestRay.horizonDistanceKm) < 0.001) ??
      nearestRay.samples[nearestRay.samples.length - 1] ??
      null;

    setHoverTarget({
      kind: "terrain",
      x: xPx,
      y: yPx,
      azimuthDeg: nearestRay.azimuthDeg,
      sample,
      ray: nearestRay,
    });
  };

  const onLeave = () => {
    setHoverTarget(null);
    if (!pinnedTarget && selectedSiteEffective) {
      dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
    }
  };

  const onClick = () => {
    if (!hoverTarget || !selectedSiteEffective) return;
    setPinnedTarget(hoverTarget);
    const renderedEndpoint = resolveRenderedEndpoint({
      hoveredNode: hoverTarget.kind === "node" ? hoverTarget.node : null,
      hoveredSample: hoverTarget.kind === "terrain" ? hoverTarget.sample : null,
      hoveredAzimuthDeg: hoverTarget.azimuthDeg,
      fallbackRay: null,
    });
    if (!renderedEndpoint) return;
    dispatchPanoramaInteraction({
      type: "toggle-lock",
      payload: {
        siteId: selectedSiteEffective.id,
        azimuthDeg: renderedEndpoint.azimuthDeg,
        endpoint: renderedEndpoint.endpoint,
        horizonDistanceKm: renderedEndpoint.distanceKm,
        focusMode: "pinned",
        viewportCenterAzimuthDeg,
        viewportSpanDeg,
        mapHoverZoomEnabled,
      },
    });
  };

  useEffect(() => {
    if (!settingsPopoverOpen) { setSettingsPopoverPos(null); return; }
    const updatePosition = () => {
      const rect = settingsButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedHeight = 290;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const direction: "up" | "down" = spaceAbove >= estimatedHeight + 12 || spaceAbove >= spaceBelow ? "up" : "down";
      const left = clamp(rect.left + rect.width / 2, 84, window.innerWidth - 84);
      setSettingsPopoverPos({ left, top: direction === "up" ? rect.top - 8 : rect.bottom + 8, direction });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [settingsPopoverOpen]);

  useEffect(() => {
    if (!settingsPopoverOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (settingsPopoverRef.current?.contains(target)) return;
      if (settingsButtonRef.current?.contains(target)) return;
      setSettingsPopoverOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (settingsPopoverRef.current?.contains(target)) return;
      if (settingsButtonRef.current?.contains(target)) return;
      setSettingsPopoverOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [settingsPopoverOpen]);

  useEffect(() => {
    if (!legendPopoverOpen) { setLegendPopoverPos(null); return; }
    const updatePosition = () => {
      const rect = legendButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedHeight = 120;
      const spaceAbove = rect.top;
      const direction: "up" | "down" = spaceAbove >= estimatedHeight + 12 ? "up" : "down";
      const left = clamp(rect.left + rect.width / 2, 84, window.innerWidth - 84);
      setLegendPopoverPos({ left, top: direction === "up" ? rect.top - 8 : rect.bottom + 8, direction });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [legendPopoverOpen]);

  useEffect(() => {
    if (!legendPopoverOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (legendPopoverRef.current?.contains(target)) return;
      if (legendButtonRef.current?.contains(target)) return;
      setLegendPopoverOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [legendPopoverOpen]);

  if (!selectedSiteEffective) {
    return (
      <section className={`chart-panel chart-panel-empty ${panelClassName ?? ""}`.trim()}>
        <div className="chart-empty">Select one site to show panorama analysis.</div>
      </section>
    );
  }

  const hoverPopover = focusTarget
    ? focusTarget.kind === "terrain"
      ? {
          title: `${focusTarget.azimuthDeg.toFixed(1)}°${cardinalLabelForAzimuth(focusTarget.azimuthDeg) ? ` (${cardinalLabelForAzimuth(focusTarget.azimuthDeg)})` : ""}`,
          rows: [
            `Coordinates: ${focusTarget.sample?.lat.toFixed(5)}, ${focusTarget.sample?.lon.toFixed(5)}`,
            `Distance: ${focusTarget.sample?.distanceKm.toFixed(2)} km`,
            `Terrain elevation: ${Math.round(focusTarget.sample?.terrainM ?? 0)} m`,
            `Status: ${focusTarget.sample && focusTarget.sample.angleDeg > focusTarget.sample.maxAngleBeforeDeg ? "Horizon crest" : "Blocked before horizon"}`,
          ],
        }
      : {
          title: `${focusTarget.node.name}`,
          rows: [
            `${focusTarget.node.azimuthDeg.toFixed(1)}°${cardinalLabelForAzimuth(focusTarget.node.azimuthDeg) ? ` (${cardinalLabelForAzimuth(focusTarget.node.azimuthDeg)})` : ""}`,
            `Coordinates: ${focusTarget.node.lat.toFixed(5)}, ${focusTarget.node.lon.toFixed(5)}`,
            `Distance: ${focusTarget.node.distanceKm.toFixed(2)} km`,
            `${passFailStateLabel(focusTarget.node.state)} • ${focusTarget.node.visible ? "Visible" : "Blocked"}`,
            `Clearance margin: ${focusTarget.node.clearanceMarginM.toFixed(1)} m`,
          ],
        }
    : null;


  const settingsPopover =
    settingsPopoverOpen && settingsPopoverPos && typeof document !== "undefined"
      ? createPortal(
          <Surface
            variant="card"
            className={`ui-action-popover panorama-settings-popover ${settingsPopoverPos.direction === "down" ? "is-down" : ""}`}
            ref={settingsPopoverRef}
            style={{ left: `${settingsPopoverPos.left}px`, top: `${settingsPopoverPos.top}px` }}
          >
            <ul className="ui-settings-popover-list">
              <li className="ui-settings-popover-row">
                <label className="ui-settings-row-toggle">
                  <span className="ui-settings-toggle-label">Field of view</span>
                  <UiSlider
                    ariaLabel="Panorama field of view"
                    max={FOV_SCALE_MAX}
                    min={FOV_SCALE_MIN}
                    onChange={(value) => setFovScale(normalizeFovScale(value))}
                    step={0.1}
                    value={normalizedFovScale}
                  />
                  <span className="ui-settings-row-slider-value">{`${Math.round(fovScaleToSpanDeg(normalizedFovScale))}°`}</span>
                </label>
              </li>
              <li className="ui-settings-popover-row">
                <label className="ui-settings-row-toggle">
                  <span className="ui-settings-toggle-label">Vertical exaggeration</span>
                  <UiSlider
                    ariaLabel="Panorama vertical exaggeration"
                    max={20}
                    min={1}
                    onChange={(value) => setExaggeration(clamp(value, 1, 20))}
                    step={0.1}
                    value={exaggeration}
                  />
                  <span className="ui-settings-row-slider-value">{`${exaggeration.toFixed(1)}x`}</span>
                </label>
              </li>
              <li className="ui-settings-popover-row">
                <button
                  aria-pressed={mapHoverZoomEnabled}
                  className="ui-settings-row-toggle"
                  onClick={() => setMapHoverZoomEnabled((v) => !v)}
                  type="button"
                >
                  <span className="ui-settings-toggle-label">Center map on hover</span>
                  <span className={`ui-settings-toggle-icon ${mapHoverZoomEnabled ? "is-active" : ""}`}>
                    <MapPinned aria-hidden="true" size={16} strokeWidth={1.8} />
                  </span>
                </button>
              </li>
              <li className="ui-settings-popover-row">
                <button
                  aria-pressed={showLabels}
                  className="ui-settings-row-toggle"
                  onClick={() => setShowLabels((v) => !v)}
                  type="button"
                >
                  <span className="ui-settings-toggle-label">Labels</span>
                  <span className={`ui-settings-toggle-icon ${showLabels ? "is-active" : ""}`}>
                    <Tags aria-hidden="true" size={16} strokeWidth={1.8} />
                  </span>
                </button>
              </li>
              <li className="ui-settings-popover-row">
                <button
                  aria-pressed={terrainDistanceHeatmap}
                  className="ui-settings-row-toggle"
                  onClick={() => setTerrainDistanceHeatmap((v) => !v)}
                  type="button"
                >
                  <span className="ui-settings-toggle-label">Distance heatmap</span>
                  <span className={`ui-settings-toggle-icon ${terrainDistanceHeatmap ? "is-active" : ""}`}>
                    <Paintbrush aria-hidden="true" size={16} strokeWidth={1.8} />
                  </span>
                </button>
              </li>
            </ul>
          </Surface>,
          document.body,
        )
      : null;

  const legendPopover =
    legendPopoverOpen && legendPopoverPos && typeof document !== "undefined"
      ? createPortal(
          <Surface
            variant="card"
            className={`ui-action-popover panorama-legend-popover ${legendPopoverPos.direction === "down" ? "is-down" : ""}`}
            ref={legendPopoverRef}
            style={{ left: `${legendPopoverPos.left}px`, top: `${legendPopoverPos.top}px` }}
          >
            <ul className="panorama-legend-popover-list">
              <li><span className="state-dot state-dot-pass_clear" aria-hidden /><span>Visible + pass</span></li>
              <li><span className="state-dot state-dot-pass_blocked" aria-hidden /><span>Blocked + pass</span></li>
              <li><span className="state-dot state-dot-fail_clear" aria-hidden /><span>Visible + fail</span></li>
              <li><span className="state-dot state-dot-fail_blocked" aria-hidden /><span>Blocked + fail</span></li>
            </ul>
            {terrainDistanceHeatmap ? (
              <div className="panorama-legend-heatmap">
                <p className="panorama-legend-heatmap-title">Terrain distance</p>
                <div className="panorama-legend-heatmap-bar" />
                <div className="panorama-legend-heatmap-labels">
                  <span>Far</span>
                  <span>Near</span>
                </div>
              </div>
            ) : null}
          </Surface>,
          document.body,
        )
      : null;

  const scrubberWidthPct = Math.max(8, (viewportSpanDeg / 360) * 100);
  const scrubberLeftPct = clamp((viewportCenterAzimuthDeg / 360) * 100 - scrubberWidthPct / 2, 0, 100 - scrubberWidthPct);

  return (
    <section className={`chart-panel ${isExpanded ? "is-expanded" : ""} ${panelClassName ?? ""}`.trim()}>
      <div className="chart-top-row">
        <h3 className="panorama-header-title">Panorama from {selectedSiteEffective.name}</h3>
        <div className="chart-action-row-controls">
          <button
            aria-label="Panorama settings"
            className={`chart-endpoint-swap chart-endpoint-icon ${settingsPopoverOpen ? "is-active" : ""}`}
            onClick={() => setSettingsPopoverOpen((v) => !v)}
            ref={settingsButtonRef}
            title="Settings"
            type="button"
          >
            <Settings aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label="Legend"
            className={`chart-endpoint-swap chart-endpoint-icon ${legendPopoverOpen ? "is-active" : ""}`}
            onClick={() => setLegendPopoverOpen((v) => !v)}
            ref={legendButtonRef}
            title="Legend"
            type="button"
          >
            <Info aria-hidden="true" strokeWidth={1.8} />
          </button>
          {showExpandToggle ? (
            <button
              aria-label={isExpanded ? "Exit full screen" : "Full screen"}
              className={`chart-endpoint-swap chart-endpoint-icon ${isExpanded ? "is-active" : ""}`}
              onClick={onToggleExpanded}
              title={isExpanded ? "Exit full screen" : "Full screen"}
              type="button"
            >
              {isExpanded ? <PanelBottomClose aria-hidden="true" strokeWidth={1.8} /> : <PanelBottomOpen aria-hidden="true" strokeWidth={1.8} />}
            </button>
          ) : null}
          {rowControls}
        </div>
      </div>

      {legendPopover}

      <div
        className="chart-svg-wrap"
        onPointerCancel={onPointerEndPanorama}
        onPointerDown={onPointerDownPanorama}
        onPointerMove={onPointerMovePanorama}
        onPointerUp={onPointerEndPanorama}
        onWheel={onWheelPanorama}
        ref={chartHostRef}
      >
        {!geometry || !panorama ? (
          <div className="chart-empty" aria-hidden="true" />
        ) : (
          <>
            <canvas aria-hidden className="panorama-terrain-canvas" ref={terrainCanvasRef} />
            {/* SVG retained only for the hover cursor line and mouse hit-detection rect.
                All visual rendering (terrain, ridge lines, grid, labels, nodes) is on canvas. */}
            <svg aria-label="Panorama" height={chartHeight} role="img" width={chartWidth}>
              {activeRay && focusAzimuthDeg != null ? (
                <g className="profile-cursor">
                  <line
                    x1={geometry.x(unwrapAzimuthForWindow(activeRay.azimuthDeg, focusAzimuthDeg))}
                    x2={geometry.x(unwrapAzimuthForWindow(activeRay.azimuthDeg, focusAzimuthDeg))}
                    y1={geometry.plotTop}
                    y2={chartHeight - M.b}
                  />
                </g>
              ) : null}

              <rect
                className="profile-hitbox"
                x={M.l}
                y={geometry.plotTop}
                width={chartWidth - M.l - M.r}
                height={chartHeight - geometry.plotTop - M.b}
                onClick={onClick}
                onMouseLeave={onLeave}
                onMouseMove={onMove}
              />
            </svg>
            <div aria-hidden className="panorama-label-overlay">
              {geometry.labels.map((label) => {
                const isPoi = label.source === "poi";
                const elevM = label.elevationM ?? null;
                const IconEl = isPoi
                  ? RadioTower
                  : elevM !== null && elevM >= 1000
                    ? MountainSnow
                    : Mountain;
                const stateVar = isPoi && label.state
                  ? `var(--state-${label.state.replace(/_/g, "-")})`
                  : null;
                return (
                  <div
                    className={`panorama-label${isPoi ? " panorama-label-site" : " panorama-label-peak"}`}
                    key={label.id}
                    style={{
                      left: `${label.anchorX}px`,
                      top: `${label.anchorY}px`,
                      ...(stateVar ? { "--panorama-label-state": stateVar } as CSSProperties : {}),
                    }}
                  >
                    {isPoi ? (
                      <span className="panorama-label-pill">
                        <IconEl aria-hidden strokeWidth={1.8} size={10} />
                        <strong>{label.name}</strong>
                      </span>
                    ) : (
                      <>
                        <IconEl aria-hidden strokeWidth={1.8} size={10} />
                        <span>{label.name}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {hoverPopover && focusTarget ? (
              <div
                className="chart-hover-popover"
                style={{
                  left: `${clamp(focusTarget.x, 170, chartWidth - 170)}px`,
                  top: `${clamp(focusTarget.y - 12, 46, chartHeight - 14)}px`,
                }}
              >
                <div className="chart-hover-popover-row"><strong>{hoverPopover.title}</strong></div>
                {hoverPopover.rows.map((row) => (
                  <div className="chart-hover-popover-row" key={row}>{row}</div>
                ))}
              </div>
            ) : null}
            {peakLoadStatus === "loading" && (
              <div className="ui-surface-pill panorama-peaks-loading">
                <div className="map-progress-track">
                  <div className="map-progress-fill map-progress-fill-indeterminate" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div
        className="panorama-scrollbar"
        onPointerDown={onScrubPointerDown}
        onPointerMove={onScrubPointerMove}
        onPointerUp={onScrubPointerEnd}
        onPointerCancel={onScrubPointerEnd}
        ref={scrollbarTrackRef}
      >
        <div
          className="panorama-scrollbar-thumb"
          style={{
            width: `${scrubberWidthPct}%`,
            left: `${scrubberLeftPct}%`,
          }}
        />
      </div>
      {settingsPopover}
    </section>
  );
}
