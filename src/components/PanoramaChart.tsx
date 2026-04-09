import { scaleLinear } from "d3-scale";
import { Compass, Maximize2, Minimize2, Trees, Waves, ZoomIn } from "lucide-react";
import { createPortal } from "react-dom";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
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
import { buildDepthBands, buildNearBiasedDepthFractions, depthStyleForBand, resolveRenderedEndpoint } from "../lib/panoramaRender";
import { cardinalLabelForAzimuth, formatAzimuthTick, fovScaleToSpanDeg, mod360, normalizeFovScale, resolvePanoramaWindow, unwrapAzimuthForWindow } from "../lib/panoramaView";
import { centerForScaledWindow, centerForScrollLeft, normalizeScrollLeftToMiddleCycle, scrollLeftForCenter } from "../lib/panoramaViewport";
import { passFailStateLabel } from "../lib/passFailState";
import { sampleSrtmElevation } from "../lib/srtm";
import { useAppStore } from "../store/appStore";
import { UiSlider } from "./UiSlider";

const M = { t: 14, r: 20, b: 32, l: 46 };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

type PanoramaChartProps = {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  showExpandToggle?: boolean;
  rowControls?: ReactNode;
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

export function PanoramaChart({ isExpanded, onToggleExpanded, showExpandToggle = true, rowControls }: PanoramaChartProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const panScrollRef = useRef<HTMLDivElement | null>(null);
  const suppressPanScrollSyncRef = useRef(false);
  const wavesButtonRef = useRef<HTMLButtonElement | null>(null);
  const fovButtonRef = useRef<HTMLButtonElement | null>(null);
  const sliderPopoverRef = useRef<HTMLDivElement | null>(null);
  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ distance: number; fovScale: number; spanDeg: number; centerDeg: number } | null>(null);

  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportCenterAzimuthDeg, setViewportCenterAzimuthDeg] = useState(180);
  const [includeClutter, setIncludeClutter] = useState(false);
  const [verticalBlend, setVerticalBlend] = useState(1);
  const [mapHoverZoomEnabled, setMapHoverZoomEnabled] = useState(false);
  const [fovScale, setFovScale] = useState(1.5);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [pinnedTarget, setPinnedTarget] = useState<HoverTarget | null>(null);
  const [openSliderPopover, setOpenSliderPopover] = useState<"fov" | "vertical" | null>(null);
  const [sliderPopoverPos, setSliderPopoverPos] = useState<{ left: number; top: number } | null>(null);

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

  const baseSchedulerRef = useRef(createLatestOnlyTaskScheduler());
  const detailSchedulerRef = useRef(createLatestOnlyTaskScheduler());
  const cacheRef = useRef<Map<string, PanoramaResult>>(new Map());
  const [basePanorama, setBasePanorama] = useState<PanoramaResult | null>(null);
  const [detailPanorama, setDetailPanorama] = useState<PanoramaResult | null>(null);

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
    if (!selectedSiteEffective || !selectedNetwork) {
      setBasePanorama(null);
      setDetailPanorama(null);
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

    const baseSampling = qualityToSampling("drag");
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

    const detailSignature = [
      "panorama-detail",
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
      detailCenterBucketDeg.toFixed(3),
      detailSampling.azimuthStepDeg,
      detailSampling.radialSamples,
      terrainLoadEpoch,
      srtmTiles.length,
      nodeCandidates.length,
      rxSensitivityTargetDbm,
      environmentLossDb,
    ].join("|");

    const cachedBase = cacheRef.current.get(baseSignature);
    if (cachedBase) setBasePanorama(cachedBase);
    const cachedDetail = cacheRef.current.get(detailSignature);
    if (cachedDetail) {
      setDetailPanorama(cachedDetail);
    } else {
      setDetailPanorama(null);
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
          setDetailPanorama(result);
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

  const panorama = detailPanorama ?? basePanorama;

  const chartWidth = chartSize?.width ?? 0;
  const chartHeight = chartSize?.height ?? 0;
  const panCycleWidthPx = Math.max(1, chartWidth * normalizedFovScale);
  const panTrackWidthPx = panCycleWidthPx * 3;

  useEffect(() => {
    const element = panScrollRef.current;
    if (!element || chartWidth <= 0) return;
    suppressPanScrollSyncRef.current = true;
    element.scrollLeft = scrollLeftForCenter(viewportCenterAzimuthDeg, panCycleWidthPx, chartWidth);
    requestAnimationFrame(() => {
      suppressPanScrollSyncRef.current = false;
    });
  }, [chartWidth, panCycleWidthPx, viewportCenterAzimuthDeg]);

  const xWindow = useMemo(
    () => resolvePanoramaWindow(viewportCenterAzimuthDeg, viewportSpanDeg),
    [viewportCenterAzimuthDeg, viewportSpanDeg],
  );

  const terrainFillGradientId = useMemo(() => `profile-terrain-fill-${Math.random().toString(36).slice(2, 11)}`, []);

  const geometry = useMemo(() => {
    if (!panorama || !chartSize || !panorama.rays.length) return null;

    const xDomainStart = xWindow.startDeg;
    const xDomainEnd = xWindow.endDeg;
    const xSpan = Math.max(0.001, xDomainEnd - xDomainStart);
    const x = scaleLinear().domain([xDomainStart, xDomainEnd]).range([M.l, chartWidth - M.r]);
    const xCenterForUnwrap = xWindow.centerDeg;

    const visibleRays = panorama.rays
      .map((ray) => {
        const xValue = unwrapAzimuthForWindow(ray.azimuthDeg, xCenterForUnwrap);
        return { ray, xValue };
      })
      .filter((entry) => entry.xValue >= xDomainStart && entry.xValue <= xDomainEnd)
      .sort((a, b) => a.xValue - b.xValue);

    if (!visibleRays.length) return null;

    const minHorizon = Math.min(...panorama.rays.map((ray) => ray.horizonAngleDeg));
    const maxHorizon = Math.max(...panorama.rays.map((ray) => ray.horizonAngleDeg));
    const minSampleAngle = Math.min(...panorama.rays.flatMap((ray) => ray.samples.map((sample) => sample.angleDeg)));
    const maxSampleAngle = Math.max(...panorama.rays.flatMap((ray) => ray.samples.map((sample) => sample.angleDeg)));

    const innerWidth = Math.max(1, chartWidth - M.l - M.r);
    const innerHeight = Math.max(1, chartHeight - M.t - M.b);
    const horizonPad = 0.5;

    const fitMin = minHorizon - horizonPad;
    const fitMax = maxHorizon + horizonPad;
    const pixelsPerDegX = innerWidth / xSpan;
    const ySpanDeg = innerHeight / Math.max(0.001, pixelsPerDegX);
    let trueMin = Math.min(0, minSampleAngle - 0.2);
    let trueMax = trueMin + ySpanDeg;
    if (trueMax < maxSampleAngle + 0.2) {
      trueMax = maxSampleAngle + 0.2;
      trueMin = trueMax - ySpanDeg;
    }

    let domainMin = trueMin + (fitMin - trueMin) * clamp(verticalBlend, 0, 1);
    let domainMax = trueMax + (fitMax - trueMax) * clamp(verticalBlend, 0, 1);

    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) {
      domainMin = panorama.minAngleDeg;
      domainMax = panorama.maxAngleDeg;
    }

    const y = scaleLinear().domain([domainMin, domainMax]).range([chartHeight - M.b, M.t]);

    const toPath = (points: { x: number; y: number }[]): string =>
      points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

    const clutterPoints = visibleRays.map(({ ray, xValue }) => ({ x: x(xValue), y: y(ray.clutterHorizonAngleDeg) }));
    const ridgeFractions = buildNearBiasedDepthFractions(10);
    const depthBands = buildDepthBands(
      visibleRays.map((entry) => entry.ray),
      ridgeFractions,
      (ray, sample) => {
        const xValue = unwrapAzimuthForWindow(ray.azimuthDeg, xCenterForUnwrap);
        const angleDeg = sample?.angleDeg ?? ray.horizonAngleDeg;
        return { x: x(xValue), y: y(angleDeg), angleDeg };
      },
    );
    const ridgeBands = depthBands.map((band, bandIndex, all) => ({
      key: `ridge-${bandIndex}`,
      style: depthStyleForBand(bandIndex, all.length),
      lineSegments: band.lineSegments,
      fillPath:
        band.points.length >= 2
          ? `${toPath(band.points)} L${band.points[band.points.length - 1].x.toFixed(2)},${(chartHeight - M.b).toFixed(2)} L${band.points[0].x.toFixed(2)},${(chartHeight - M.b).toFixed(2)} Z`
          : "",
    }));

    const furthestBandFillPath = ridgeBands[ridgeBands.length - 1]?.fillPath ?? "";
    const clutterBasePoints = depthBands[depthBands.length - 1]?.points.map((point) => ({ x: point.x, y: point.y })) ?? clutterPoints;

    const clutterAreaPath = includeClutter
      ? `${toPath(clutterPoints)} ${[...clutterBasePoints]
          .reverse()
          .map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`)
          .join(" ")} Z`
      : "";

    const ticksX = Array.from({ length: 7 }, (_, index) => {
      const ratio = index / 6;
      return xDomainStart + (xDomainEnd - xDomainStart) * ratio;
    });

    const ticksY = [domainMin, (domainMin + domainMax) / 2, domainMax];

    const nodes = panorama.nodes
      .map((node) => {
        const xValue = unwrapAzimuthForWindow(node.azimuthDeg, xCenterForUnwrap);
        return {
          node,
          xValue,
          cx: x(xValue),
          cy: y(node.elevationAngleDeg),
        };
      })
      .filter((entry) => entry.xValue >= xDomainStart && entry.xValue <= xDomainEnd);

    return {
      x,
      xWindow,
      y,
      terrainFillPath: furthestBandFillPath,
      clutterPath: includeClutter ? toPath(clutterPoints) : "",
      clutterAreaPath,
      ridgeBands,
      ticksX,
      ticksY,
      nodes,
    };
  }, [panorama, chartSize, chartHeight, chartWidth, verticalBlend, xWindow, includeClutter]);

  const focusTarget = hoverTarget ?? pinnedTarget;
  const focusAzimuthDeg = focusTarget?.azimuthDeg ?? null;

  const activeRay = useMemo(() => {
    if (!panorama || focusAzimuthDeg == null || !panorama.rays.length) return null;
    return panorama.rays.reduce(
      (best, ray) => {
        const dist = Math.abs(unwrapAzimuthForWindow(ray.azimuthDeg, focusAzimuthDeg) - focusAzimuthDeg);
        if (dist < best.distance) return { ray, distance: dist };
        return best;
      },
      { ray: panorama.rays[0], distance: Number.POSITIVE_INFINITY },
    ).ray;
  }, [panorama, focusAzimuthDeg]);

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

  const onPanScroll = useCallback(() => {
    const element = panScrollRef.current;
    if (!element || chartWidth <= 0 || suppressPanScrollSyncRef.current) return;
    const normalized = normalizeScrollLeftToMiddleCycle(element.scrollLeft, panCycleWidthPx);
    if (Math.abs(normalized - element.scrollLeft) > 0.5) {
      suppressPanScrollSyncRef.current = true;
      element.scrollLeft = normalized;
      requestAnimationFrame(() => {
        suppressPanScrollSyncRef.current = false;
      });
    }
    setViewportCenterAzimuthDeg(centerForScrollLeft(normalized, panCycleWidthPx, chartWidth));
  }, [chartWidth, panCycleWidthPx]);

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
    const rect = event.currentTarget.getBoundingClientRect();
    const focalNorm = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    if (event.ctrlKey) {
      event.preventDefault();
      const nextScale = normalizeFovScale(normalizedFovScale * Math.exp(-event.deltaY * 0.01));
      applyFovAtFocal(nextScale, focalNorm);
      return;
    }
    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (dominantDelta === 0) return;
    event.preventDefault();
    const deltaDeg = (dominantDelta / Math.max(1, chartWidth - M.l - M.r)) * viewportSpanDeg;
    setViewportCenterAzimuthDeg((current) => mod360(current + deltaDeg));
  };

  const onPointerDownPanorama = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
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
  };

  const onPointerEndPanorama = (event: React.PointerEvent<HTMLDivElement>) => {
    pinchPointersRef.current.delete(event.pointerId);
    if (pinchPointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
  };

  const onMove = (event: ReactMouseEvent<SVGRectElement>) => {
    if (!geometry || !panorama) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const xPx = M.l + xNorm * (chartWidth - M.l - M.r);
    const yPx = M.t + yNorm * (chartHeight - M.t - M.b);

    const unwrapped = geometry.x.invert(xPx);
    const azimuth = mod360(unwrapped);

    const nearestRay = panorama.rays.reduce(
      (best, ray) => {
        const dist = Math.abs(unwrapAzimuthForWindow(ray.azimuthDeg, azimuth) - azimuth);
        return dist < best.distance ? { ray, distance: dist } : best;
      },
      { ray: panorama.rays[0], distance: Number.POSITIVE_INFINITY },
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
    if (!openSliderPopover) return;
    const anchor = openSliderPopover === "fov" ? fovButtonRef.current : wavesButtonRef.current;
    if (!anchor) return;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      setSliderPopoverPos({ left: rect.left + rect.width / 2, top: rect.top - 8 });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [openSliderPopover]);

  useEffect(() => {
    if (!openSliderPopover) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      const anchor = openSliderPopover === "fov" ? fovButtonRef.current : wavesButtonRef.current;
      if (sliderPopoverRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      setOpenSliderPopover(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      const anchor = openSliderPopover === "fov" ? fovButtonRef.current : wavesButtonRef.current;
      if (sliderPopoverRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      setOpenSliderPopover(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [openSliderPopover]);

  if (!selectedSiteEffective) {
    return (
      <section className="chart-panel chart-panel-empty">
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

  const sliderPopover =
    openSliderPopover && sliderPopoverPos && typeof document !== "undefined"
      ? createPortal(
          <div className="panorama-slider-popover" ref={sliderPopoverRef} style={{ left: `${sliderPopoverPos.left}px`, top: `${sliderPopoverPos.top}px` }}>
            {openSliderPopover === "fov" ? (
              <UiSlider
                ariaLabel="Panorama field of view"
                label="FOV"
                max={4}
                min={1}
                onChange={(value) => setFovScale(normalizeFovScale(value))}
                orientation="vertical"
                step={0.1}
                value={normalizedFovScale}
                valueLabel={`${Math.round(fovScaleToSpanDeg(normalizedFovScale))}°`}
              />
            ) : (
              <UiSlider
                ariaLabel="Panorama vertical exaggeration"
                label="Vertical"
                max={1}
                min={0}
                onChange={(value) => setVerticalBlend(clamp(value, 0, 1))}
                orientation="vertical"
                step={0.05}
                value={verticalBlend}
                valueLabel={`${Math.round(verticalBlend * 100)}%`}
              />
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <section className={`chart-panel ${isExpanded ? "is-expanded" : ""}`}>
      <div className="chart-top-row">
        <h3 className="panorama-header-title">Panorama from {selectedSiteEffective.name}</h3>
        <div className="chart-action-row-controls">
          <button
            aria-label="Adjust vertical scaling"
            className={`chart-endpoint-swap chart-endpoint-icon ${openSliderPopover === "vertical" ? "is-active" : ""}`}
            onClick={() => setOpenSliderPopover((value) => (value === "vertical" ? null : "vertical"))}
            ref={wavesButtonRef}
            title="Vertical scaling"
            type="button"
          >
            <Waves aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label={includeClutter ? "Disable clutter layer" : "Enable clutter layer"}
            className={`chart-endpoint-swap chart-endpoint-icon ${includeClutter ? "is-active" : ""}`}
            onClick={() => setIncludeClutter((value) => !value)}
            title={includeClutter ? "Clutter layer on" : "Clutter layer off"}
            type="button"
          >
            <Trees aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label="Adjust field of view"
            className={`chart-endpoint-swap chart-endpoint-icon ${openSliderPopover === "fov" ? "is-active" : ""}`}
            onClick={() => setOpenSliderPopover((value) => (value === "fov" ? null : "fov"))}
            ref={fovButtonRef}
            title="Field of view"
            type="button"
          >
            <ZoomIn aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label={mapHoverZoomEnabled ? "Disable map hover lens" : "Enable map hover lens"}
            className={`chart-endpoint-swap chart-endpoint-icon ${mapHoverZoomEnabled ? "is-active" : ""}`}
            onClick={() => setMapHoverZoomEnabled((value) => !value)}
            title={mapHoverZoomEnabled ? "Map hover lens on" : "Map hover lens off"}
            type="button"
          >
            <Compass aria-hidden="true" strokeWidth={1.8} />
          </button>
          {showExpandToggle ? (
            <button
              aria-label={isExpanded ? "Exit full screen" : "Full screen"}
              className={`chart-endpoint-swap chart-endpoint-icon ${isExpanded ? "is-active" : ""}`}
              onClick={onToggleExpanded}
              title={isExpanded ? "Exit full screen" : "Full screen"}
              type="button"
            >
              {isExpanded ? <Minimize2 aria-hidden="true" strokeWidth={1.8} /> : <Maximize2 aria-hidden="true" strokeWidth={1.8} />}
            </button>
          ) : null}
          {rowControls}
        </div>
      </div>

      <div className="chart-action-row">
        <div className="chart-hover-state">
          <span className="state-dot state-dot-pass_clear" aria-hidden />
          <span>Visible + pass</span>
          <span className="state-dot state-dot-pass_blocked" aria-hidden />
          <span>Blocked + pass</span>
          <span className="state-dot state-dot-fail_clear" aria-hidden />
          <span>Visible + fail</span>
          <span className="state-dot state-dot-fail_blocked" aria-hidden />
          <span>Blocked + fail</span>
        </div>
      </div>

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
            <svg aria-label="Panorama" height={chartHeight} role="img" width={chartWidth}>
              <defs>
                <linearGradient id={terrainFillGradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="color-mix(in srgb, var(--terrain) 70%, var(--accent) 30%)" stopOpacity="0.86" />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--terrain) 18%, var(--surface-2) 82%)" stopOpacity="0.22" />
                </linearGradient>
              </defs>

              {geometry.ticksY.map((value) => (
                <g className="chart-grid" key={`y-${value.toFixed(2)}`}>
                  <line x1={M.l} x2={chartWidth - M.r} y1={geometry.y(value)} y2={geometry.y(value)} />
                  <text textAnchor="end" x={M.l - 8} y={geometry.y(value) + 4}>
                    {value.toFixed(1)}°
                  </text>
                </g>
              ))}

              {geometry.ticksX.map((value) => (
                <g className="chart-grid" key={`x-${value.toFixed(2)}`}>
                  <line x1={geometry.x(value)} x2={geometry.x(value)} y1={M.t} y2={chartHeight - M.b} />
                  <text textAnchor="middle" x={geometry.x(value)} y={chartHeight - 8}>
                    {formatAzimuthTick(value)}
                  </text>
                </g>
              ))}

              {geometry.terrainFillPath ? <path className="terrain-fill-path" d={geometry.terrainFillPath} fill={`url(#${terrainFillGradientId})`} /> : null}
              {geometry.ridgeBands.map((band) => (
                <g key={band.key}>
                  {band.fillPath ? (
                    <path
                      className="panorama-ridge-band"
                      d={band.fillPath}
                      style={{
                        opacity: band.style.fillOpacity,
                        fill: `color-mix(in srgb, var(--terrain) ${band.style.strokeMixTerrainPct}%, var(--surface-2) 55%)`,
                      }}
                    />
                  ) : null}
                  {band.lineSegments.map((segment, segmentIndex) => (
                    <path
                      className="panorama-ridge-line"
                      d={segment}
                      key={`${band.key}-segment-${segmentIndex}`}
                      style={{
                        strokeWidth: band.style.strokeWidth,
                        strokeOpacity: band.style.strokeOpacity,
                        stroke: `color-mix(in srgb, var(--terrain) ${band.style.strokeMixTerrainPct}%, var(--muted) ${band.style.strokeMixMutedPct}%)`,
                      }}
                    />
                  ))}
                </g>
              ))}
              {includeClutter && geometry.clutterAreaPath ? <path className="panorama-clutter-haze" d={geometry.clutterAreaPath} /> : null}
              {includeClutter && geometry.clutterPath ? <path className="panorama-clutter-line" d={geometry.clutterPath} /> : null}

              {geometry.nodes.map((node) => (
                <circle
                  key={node.node.id}
                  className={`panorama-node panorama-node-${node.node.state} ${node.node.visible ? "is-visible" : "is-hidden"}`}
                  cx={node.cx}
                  cy={node.cy}
                  r={3.2}
                />
              ))}

              {activeRay && focusAzimuthDeg != null ? (
                <line
                  className="profile-cursor"
                  x1={geometry.x(unwrapAzimuthForWindow(activeRay.azimuthDeg, focusAzimuthDeg))}
                  x2={geometry.x(unwrapAzimuthForWindow(activeRay.azimuthDeg, focusAzimuthDeg))}
                  y1={M.t}
                  y2={chartHeight - M.b}
                />
              ) : null}

              <rect
                className="profile-hitbox"
                x={M.l}
                y={M.t}
                width={chartWidth - M.l - M.r}
                height={chartHeight - M.t - M.b}
                onClick={onClick}
                onMouseLeave={onLeave}
                onMouseMove={onMove}
              />
            </svg>
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
          </>
        )}
      </div>

      <div className="panorama-scrollbar" onScroll={onPanScroll} ref={panScrollRef}>
        <div className="panorama-scrollbar-track" style={{ width: `${panTrackWidthPx}px` }} />
      </div>
      {sliderPopover}
    </section>
  );
}
