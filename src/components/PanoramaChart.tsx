import { scaleLinear } from "d3-scale";
import { Compass, Maximize2, Minimize2, Trees, Waves, ZoomIn } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "../lib/latestOnlyTaskScheduler";
import { dispatchPanoramaInteraction } from "../lib/panoramaEvents";
import {
  buildPanorama,
  resolvePanoramaSampling,
  type PanoramaNodeCandidate,
  type PanoramaNodeProjection,
  type PanoramaQuality,
  type PanoramaRay,
  type PanoramaResult,
  type PanoramaRaySample,
} from "../lib/panorama";
import { buildDepthBands, buildNearBiasedDepthFractions, depthStyleForBand, resolveRenderedEndpoint } from "../lib/panoramaRender";
import {
  cardinalLabelForAzimuth,
  chartXNormToAzimuthDeg,
  formatAzimuthTick,
  fovScaleToSpanDeg,
  normalizeFovScale,
  resolvePanoramaWindow,
  unwrapAzimuthForWindow,
} from "../lib/panoramaView";
import { passFailStateLabel } from "../lib/passFailState";
import { sampleSrtmElevation } from "../lib/srtm";
import { useAppStore } from "../store/appStore";

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

export function PanoramaChart({ isExpanded, onToggleExpanded, showExpandToggle = true, rowControls }: PanoramaChartProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [hoverAzimuth, setHoverAzimuth] = useState<number | null>(null);
  const [includeClutter, setIncludeClutter] = useState(false);
  const [fitScaleMode, setFitScaleMode] = useState(true);
  const [mapHoverZoomEnabled, setMapHoverZoomEnabled] = useState(false);
  const [zoomModeEnabled, setZoomModeEnabled] = useState(true);
  const [fovScale, setFovScale] = useState(1.5);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);

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

  const schedulerRef = useRef(createLatestOnlyTaskScheduler());
  const cacheRef = useRef<Map<string, PanoramaResult>>(new Map());
  const [panorama, setPanorama] = useState<PanoramaResult | null>(null);

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
    if (!selectedSiteEffective || !selectedNetwork) {
      setPanorama(null);
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

    const effectiveFovScale = normalizeFovScale(fovScale);
    const windowSpanDeg = zoomModeEnabled ? fovScaleToSpanDeg(effectiveFovScale) : 360;
    const windowCenterDegRaw = hoverAzimuth ?? 180;
    const sampling = resolvePanoramaSampling(quality, { zoomModeEnabled, fovScale: effectiveFovScale });
    const centerBucketSizeDeg = Math.max(1, Math.round(sampling.azimuthStepDeg * 4));
    const windowCenterBucketDeg = Math.round(windowCenterDegRaw / centerBucketSizeDeg) * centerBucketSizeDeg;
    const signature = [
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
      zoomModeEnabled ? "zoom:on" : "zoom:off",
      effectiveFovScale.toFixed(2),
      windowSpanDeg.toFixed(3),
      windowCenterBucketDeg.toFixed(3),
      sampling.azimuthStepDeg,
      sampling.radialSamples,
      terrainLoadEpoch,
      srtmTiles.length,
      nodeCandidates.length,
      rxSensitivityTargetDbm,
      environmentLossDb,
    ].join("|");

    const cached = cacheRef.current.get(signature);
    if (cached) {
      setPanorama(cached);
      return;
    }

    const scheduler = schedulerRef.current;
    scheduler.clearQueue();
    scheduler.cancelActive();

    scheduler.enqueue({
      signature,
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
            azimuthStepDeg: sampling.azimuthStepDeg,
            radialSamples: sampling.radialSamples,
            windowCenterDeg: zoomModeEnabled ? windowCenterBucketDeg : undefined,
            windowSpanDeg: zoomModeEnabled ? windowSpanDeg : undefined,
          },
        });
        if (context.isCancelled()) return;
        cacheRef.current.set(signature, result);
        if (cacheRef.current.size > 40) {
          const oldest = cacheRef.current.keys().next().value;
          if (oldest) cacheRef.current.delete(oldest);
        }
        setPanorama(result);
      },
    } satisfies LatestOnlyTask);
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
    zoomModeEnabled,
    fovScale,
    hoverAzimuth,
  ]);

  const chartWidth = chartSize?.width ?? 0;
  const chartHeight = chartSize?.height ?? 0;

  const xWindow = useMemo(() => {
    if (!zoomModeEnabled) return null;
    return resolvePanoramaWindow(hoverAzimuth ?? 180, fovScaleToSpanDeg(fovScale));
  }, [zoomModeEnabled, hoverAzimuth, fovScale]);

  const terrainFillGradientId = useMemo(() => `profile-terrain-fill-${Math.random().toString(36).slice(2, 11)}`, []);

  const geometry = useMemo(() => {
    if (!panorama || !chartSize || !panorama.rays.length) return null;

    const useWindow = Boolean(xWindow);
    const xDomainStart = xWindow?.startDeg ?? 0;
    const xDomainEnd = xWindow?.endDeg ?? 360;
    const xSpan = Math.max(0.001, xDomainEnd - xDomainStart);
    const x = scaleLinear().domain([xDomainStart, xDomainEnd]).range([M.l, chartWidth - M.r]);
    const xCenterForUnwrap = xWindow?.centerDeg ?? 180;

    const visibleRays = panorama.rays
      .map((ray) => {
        const xValue = useWindow ? unwrapAzimuthForWindow(ray.azimuthDeg, xCenterForUnwrap) : ray.azimuthDeg;
        return { ray, xValue };
      })
      .filter((entry) => !useWindow || (entry.xValue >= xDomainStart && entry.xValue <= xDomainEnd))
      .sort((a, b) => a.xValue - b.xValue);

    if (!visibleRays.length) return null;

    const minHorizon = Math.min(...panorama.rays.map((ray) => ray.horizonAngleDeg));
    const maxHorizon = Math.max(...panorama.rays.map((ray) => ray.horizonAngleDeg));
    const minSampleAngle = Math.min(
      ...panorama.rays.flatMap((ray) => ray.samples.map((sample) => sample.angleDeg)),
    );
    const maxSampleAngle = Math.max(
      ...panorama.rays.flatMap((ray) => ray.samples.map((sample) => sample.angleDeg)),
    );

    const innerWidth = Math.max(1, chartWidth - M.l - M.r);
    const innerHeight = Math.max(1, chartHeight - M.t - M.b);
    const horizonPad = 0.5;

    let domainMin: number;
    let domainMax: number;
    if (fitScaleMode) {
      domainMin = minHorizon - horizonPad;
      domainMax = maxHorizon + horizonPad;
    } else {
      const pixelsPerDegX = innerWidth / xSpan;
      const ySpanDeg = innerHeight / Math.max(0.001, pixelsPerDegX);
      const seaLevelAnchorDeg = Math.min(0, minSampleAngle - 0.2);
      domainMin = seaLevelAnchorDeg;
      domainMax = domainMin + ySpanDeg;
      if (domainMax < maxSampleAngle + 0.2) {
        domainMax = maxSampleAngle + 0.2;
        domainMin = domainMax - ySpanDeg;
      }
    }

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
        const xValue = useWindow ? unwrapAzimuthForWindow(ray.azimuthDeg, xCenterForUnwrap) : ray.azimuthDeg;
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
    const clutterBasePoints =
      depthBands[depthBands.length - 1]?.points.map((point) => ({ x: point.x, y: point.y })) ??
      clutterPoints;

    const clutterAreaPath = includeClutter
      ? `${toPath(clutterPoints)} ${[...clutterBasePoints]
          .reverse()
          .map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`)
          .join(" ")} Z`
      : "";

    const ticksX = xWindow
      ? Array.from({ length: 7 }, (_, index) => {
          const ratio = index / 6;
          return xDomainStart + (xDomainEnd - xDomainStart) * ratio;
        })
      : [0, 60, 120, 180, 240, 300, 360];

    const ticksY = [domainMin, (domainMin + domainMax) / 2, domainMax];

    const nodes = panorama.nodes
      .map((node) => {
        const xValue = useWindow ? unwrapAzimuthForWindow(node.azimuthDeg, xCenterForUnwrap) : node.azimuthDeg;
        return {
          node,
          xValue,
          cx: x(xValue),
          cy: y(node.elevationAngleDeg),
        };
      })
      .filter((entry) => !useWindow || (entry.xValue >= xDomainStart && entry.xValue <= xDomainEnd));

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
  }, [panorama, chartSize, chartHeight, chartWidth, fitScaleMode, xWindow, includeClutter]);

  const activeRay = useMemo(() => {
    if (!panorama || hoverAzimuth == null || !panorama.rays.length) return null;
    const nearest = panorama.rays.reduce(
      (best, ray) => {
        const dist = Math.abs(unwrapAzimuthForWindow(ray.azimuthDeg, hoverAzimuth) - hoverAzimuth);
        if (dist < best.distance) return { ray, distance: dist };
        return best;
      },
      { ray: panorama.rays[0], distance: Number.POSITIVE_INFINITY },
    );
    return nearest.ray;
  }, [panorama, hoverAzimuth]);

  useEffect(() => {
    if (!selectedSiteEffective) return;
    const renderedEndpoint = resolveRenderedEndpoint({
      hoveredNode: hoverTarget?.kind === "node" ? hoverTarget.node : null,
      hoveredSample: hoverTarget?.kind === "terrain" ? hoverTarget.sample : null,
      hoveredAzimuthDeg: hoverTarget?.azimuthDeg ?? null,
      fallbackRay: activeRay,
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
        mapHoverZoomEnabled,
      },
    });
  }, [selectedSiteEffective, activeRay, hoverTarget, mapHoverZoomEnabled]);

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    if (!geometry || !panorama) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const xPx = M.l + xNorm * (chartWidth - M.l - M.r);
    const yPx = M.t + yNorm * (chartHeight - M.t - M.b);

    const azimuth = chartXNormToAzimuthDeg(xNorm);
    setHoverAzimuth(azimuth);

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
    setHoverAzimuth(null);
    setHoverTarget(null);
    if (!selectedSiteEffective) return;
    dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
  };

  if (!selectedSiteEffective) {
    return (
      <section className="chart-panel chart-panel-empty">
        <div className="chart-empty">Select one site to show panorama analysis.</div>
      </section>
    );
  }

  const hoverPopover = hoverTarget
    ? hoverTarget.kind === "terrain"
      ? {
          title: `${hoverTarget.azimuthDeg.toFixed(1)}°${cardinalLabelForAzimuth(hoverTarget.azimuthDeg) ? ` (${cardinalLabelForAzimuth(hoverTarget.azimuthDeg)})` : ""}`,
          rows: [
            `Coordinates: ${hoverTarget.sample?.lat.toFixed(5)}, ${hoverTarget.sample?.lon.toFixed(5)}`,
            `Distance: ${hoverTarget.sample?.distanceKm.toFixed(2)} km`,
            `Terrain elevation: ${Math.round(hoverTarget.sample?.terrainM ?? 0)} m`,
            `Status: ${hoverTarget.sample && hoverTarget.sample.angleDeg > hoverTarget.sample.maxAngleBeforeDeg ? "Horizon crest" : "Blocked before horizon"}`,
          ],
        }
      : {
          title: `${hoverTarget.node.name}`,
          rows: [
            `${hoverTarget.node.azimuthDeg.toFixed(1)}°${cardinalLabelForAzimuth(hoverTarget.node.azimuthDeg) ? ` (${cardinalLabelForAzimuth(hoverTarget.node.azimuthDeg)})` : ""}`,
            `Coordinates: ${hoverTarget.node.lat.toFixed(5)}, ${hoverTarget.node.lon.toFixed(5)}`,
            `Distance: ${hoverTarget.node.distanceKm.toFixed(2)} km`,
            `${passFailStateLabel(hoverTarget.node.state)} • ${hoverTarget.node.visible ? "Visible" : "Blocked"}`,
            `Clearance margin: ${hoverTarget.node.clearanceMarginM.toFixed(1)} m`,
          ],
        }
    : null;

  return (
    <section className={`chart-panel ${isExpanded ? "is-expanded" : ""}`}>
      <div className="chart-top-row">
        <h3 className="panorama-header-title">Panorama from {selectedSiteEffective.name}</h3>
        <div className="chart-action-row-controls">
          <button
            aria-label={fitScaleMode ? "Switch to true-scale mode" : "Switch to fit-scale mode"}
            className={`chart-endpoint-swap chart-endpoint-icon ${fitScaleMode ? "is-active" : ""}`}
            onClick={() => setFitScaleMode((value) => !value)}
            title={fitScaleMode ? "Fit scale" : "True scale"}
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
            aria-label={zoomModeEnabled ? "Disable chart zoom mode" : "Enable chart zoom mode"}
            className={`chart-endpoint-swap chart-endpoint-icon ${zoomModeEnabled ? "is-active" : ""}`}
            onClick={() => setZoomModeEnabled((value) => !value)}
            title={zoomModeEnabled ? "Chart zoom mode on" : "Chart zoom mode off"}
            type="button"
          >
            <ZoomIn aria-hidden="true" strokeWidth={1.8} />
          </button>
          {zoomModeEnabled ? (
            <label className="panorama-fov-control">
              <span className="panorama-fov-label">FOV</span>
              <input
                aria-label="Panorama FOV"
                className="panorama-fov-slider"
                max={4}
                min={1}
                onChange={(event) => setFovScale(normalizeFovScale(Number(event.currentTarget.value)))}
                step={0.1}
                type="range"
                value={fovScale}
              />
              <span className="panorama-fov-value">{fovScale.toFixed(1)}x</span>
            </label>
          ) : null}
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

      <div className="chart-svg-wrap" ref={chartHostRef}>
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

              {activeRay ? (
                <line
                  className="profile-cursor"
                  x1={geometry.x(geometry.xWindow ? unwrapAzimuthForWindow(activeRay.azimuthDeg, geometry.xWindow.centerDeg) : activeRay.azimuthDeg)}
                  x2={geometry.x(geometry.xWindow ? unwrapAzimuthForWindow(activeRay.azimuthDeg, geometry.xWindow.centerDeg) : activeRay.azimuthDeg)}
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
                onMouseLeave={onLeave}
                onMouseMove={onMove}
              />
            </svg>
            {hoverPopover && hoverTarget ? (
              <div
                className="chart-hover-popover"
                style={{
                  left: `${clamp(hoverTarget.x, 170, chartWidth - 170)}px`,
                  top: `${clamp(hoverTarget.y - 12, 46, chartHeight - 14)}px`,
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
    </section>
  );
}
