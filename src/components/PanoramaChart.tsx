import { scaleLinear } from "d3-scale";
import { Compass, Lock, Maximize2, Minimize2, Trees, Unlock, Waves } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "../lib/latestOnlyTaskScheduler";
import { dispatchPanoramaInteraction } from "../lib/panoramaEvents";
import {
  buildPanorama,
  qualityToSampling,
  type PanoramaNodeCandidate,
  type PanoramaNodeProjection,
  type PanoramaQuality,
  type PanoramaRay,
  type PanoramaResult,
  type PanoramaRaySample,
} from "../lib/panorama";
import { cardinalLabelForAzimuth, formatAzimuthTick, resolvePanoramaWindow, unwrapAzimuthForWindow } from "../lib/panoramaView";
import { passFailStateLabel } from "../lib/passFailState";
import { sampleSrtmElevation } from "../lib/srtm";
import { useAppStore } from "../store/appStore";

const M = { t: 14, r: 20, b: 32, l: 46 };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const normalizeAzimuth = (value: number): number => ((value % 360) + 360) % 360;

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
  const [lockedAzimuth, setLockedAzimuth] = useState<number | null>(null);
  const [includeClutter, setIncludeClutter] = useState(false);
  const [verticalExaggeration, setVerticalExaggeration] = useState(true);
  const [mapHoverZoomEnabled, setMapHoverZoomEnabled] = useState(false);
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

    const sampling = qualityToSampling(quality);
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
      includeClutter ? 1 : 0,
      quality,
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
            includeClutter,
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
    includeClutter,
    quality,
    srtmTiles,
    nodeCandidates,
    rxSensitivityTargetDbm,
    environmentLossDb,
    terrainLoadEpoch,
  ]);

  const chartWidth = chartSize?.width ?? 0;
  const chartHeight = chartSize?.height ?? 0;
  const activeAzimuth = lockedAzimuth ?? hoverAzimuth;

  const xWindow = useMemo(() => {
    if (activeAzimuth == null) return null;
    return resolvePanoramaWindow(activeAzimuth, 90);
  }, [activeAzimuth]);

  const terrainFillGradientId = useMemo(() => `profile-terrain-fill-${Math.random().toString(36).slice(2, 11)}`, []);

  const geometry = useMemo(() => {
    if (!panorama || !chartSize || !panorama.rays.length) return null;
    const yPaddingDeg = 0.6;
    const minHorizon = Math.min(...panorama.rays.map((ray) => ray.horizonAngleDeg));
    const maxHorizon = Math.max(...panorama.rays.map((ray) => ray.horizonAngleDeg));
    const rawMin = minHorizon - yPaddingDeg;
    const rawMax = maxHorizon + yPaddingDeg;
    const domainMin = Number.isFinite(rawMin) ? rawMin : panorama.minAngleDeg;
    const domainMax = Number.isFinite(rawMax) && rawMax > domainMin ? rawMax : domainMin + 3;
    const yRange = chartHeight - M.b - M.t;

    const yForAngle = (angle: number): number => {
      const tRaw = clamp((angle - domainMin) / Math.max(0.001, domainMax - domainMin), 0, 1);
      const t = verticalExaggeration ? Math.pow(tRaw, 0.8) : tRaw;
      return M.t + (1 - t) * yRange;
    };

    const useWindow = Boolean(xWindow);
    const xDomainStart = xWindow?.startDeg ?? 0;
    const xDomainEnd = xWindow?.endDeg ?? 360;
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

    const toPath = (points: { x: number; y: number }[]): string =>
      points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

    const horizonPoints = visibleRays.map(({ ray, xValue }) => ({ x: x(xValue), y: yForAngle(ray.horizonAngleDeg) }));
    const clutterPoints = visibleRays.map(({ ray, xValue }) => ({ x: x(xValue), y: yForAngle(ray.clutterHorizonAngleDeg) }));
    const horizonPath = toPath(horizonPoints);
    const horizonAreaPath = `${horizonPath} L${horizonPoints[horizonPoints.length - 1].x.toFixed(2)},${(chartHeight - M.b).toFixed(2)} L${horizonPoints[0].x.toFixed(2)},${(chartHeight - M.b).toFixed(2)} Z`;

    const ridgeFractions = [0.18, 0.34, 0.52, 0.72, 0.9];
    const ridgeBands = ridgeFractions.map((fraction, bandIndex) => {
      const points = visibleRays.map(({ ray, xValue }) => {
        const sampleIndex = Math.max(0, Math.min(ray.samples.length - 1, Math.round((ray.samples.length - 1) * fraction)));
        const sample = ray.samples[sampleIndex] ?? ray.samples[ray.samples.length - 1];
        return {
          x: x(xValue),
          y: yForAngle(sample?.angleDeg ?? ray.horizonAngleDeg),
        };
      });
      const line = toPath(points);
      const area = `${line} L${points[points.length - 1].x.toFixed(2)},${(chartHeight - M.b).toFixed(2)} L${points[0].x.toFixed(2)},${(chartHeight - M.b).toFixed(2)} Z`;
      return {
        key: `ridge-${bandIndex}`,
        area,
        line,
        opacity: 0.08 + bandIndex * 0.05,
      };
    });

    const clutterAreaPath = includeClutter
      ? `${toPath(clutterPoints)} ${[...horizonPoints]
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
          cy: yForAngle(node.elevationAngleDeg),
        };
      })
      .filter((entry) => !useWindow || (entry.xValue >= xDomainStart && entry.xValue <= xDomainEnd));

    const azimuthForX = (xPx: number): number => normalizeAzimuth(x.invert(xPx));

    return {
      x,
      xWindow,
      yForAngle,
      horizonPath,
      horizonAreaPath,
      clutterPath: includeClutter ? toPath(clutterPoints) : "",
      clutterAreaPath,
      ridgeBands,
      ticksX,
      ticksY,
      nodes,
      visibleRays: visibleRays.map((entry) => entry.ray),
      azimuthForX,
    };
  }, [panorama, chartSize, chartHeight, chartWidth, verticalExaggeration, xWindow, includeClutter]);

  const activeRay = useMemo(() => {
    if (!panorama || activeAzimuth == null || !panorama.rays.length) return null;
    const nearest = panorama.rays.reduce(
      (best, ray) => {
        const dist = Math.abs(unwrapAzimuthForWindow(ray.azimuthDeg, activeAzimuth) - activeAzimuth);
        if (dist < best.distance) return { ray, distance: dist };
        return best;
      },
      { ray: panorama.rays[0], distance: Number.POSITIVE_INFINITY },
    );
    return nearest.ray;
  }, [panorama, activeAzimuth]);

  useEffect(() => {
    if (!selectedSiteEffective) return;
    if (!activeRay) {
      dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
      return;
    }
    const endpoint = {
      lat: activeRay.horizonLat,
      lon: activeRay.horizonLon,
    };
    dispatchPanoramaInteraction({
      type: "hover",
      payload: {
        siteId: selectedSiteEffective.id,
        azimuthDeg: activeRay.azimuthDeg,
        endpoint,
        horizonDistanceKm: activeRay.horizonDistanceKm,
        mapHoverZoomEnabled,
      },
    });
  }, [selectedSiteEffective, activeRay, mapHoverZoomEnabled]);

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    if (!geometry || !panorama) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const xPx = M.l + xNorm * (chartWidth - M.l - M.r);
    const yPx = M.t + yNorm * (chartHeight - M.t - M.b);
    const azimuth = geometry.azimuthForX(xPx);
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

    const sample = nearestRay.samples.find((entry) => Math.abs(entry.distanceKm - nearestRay.horizonDistanceKm) < 0.001) ?? nearestRay.samples[nearestRay.samples.length - 1] ?? null;
    if (!sample) {
      setHoverTarget(null);
      return;
    }

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

  const onClick = () => {
    if (activeAzimuth == null || !selectedSiteEffective || !activeRay) return;
    const endpoint = { lat: activeRay.horizonLat, lon: activeRay.horizonLon };
    if (lockedAzimuth != null) {
      dispatchPanoramaInteraction({ type: "clear", siteId: selectedSiteEffective.id });
      setLockedAzimuth(null);
      return;
    }
    dispatchPanoramaInteraction({
      type: "toggle-lock",
      payload: {
        siteId: selectedSiteEffective.id,
        azimuthDeg: activeRay.azimuthDeg,
        endpoint,
        horizonDistanceKm: activeRay.horizonDistanceKm,
        mapHoverZoomEnabled,
      },
    });
    setLockedAzimuth(activeAzimuth);
  };

  if (!selectedSiteEffective) {
    return (
      <section className="chart-panel chart-panel-empty">
        <div className="chart-empty">Select one site to show panorama analysis.</div>
      </section>
    );
  }

  const cardinal = activeRay ? cardinalLabelForAzimuth(activeRay.azimuthDeg) : null;
  const hoverPopover = hoverTarget
    ? hoverTarget.kind === "terrain"
      ? {
          title: `${hoverTarget.azimuthDeg.toFixed(1)}°${cardinal ? ` (${cardinal})` : ""}`,
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
            aria-label={verticalExaggeration ? "Disable vertical exaggeration" : "Enable vertical exaggeration"}
            className={`chart-endpoint-swap chart-endpoint-icon ${verticalExaggeration ? "is-active" : ""}`}
            onClick={() => setVerticalExaggeration((value) => !value)}
            title={verticalExaggeration ? "Vertical exaggeration on" : "Vertical exaggeration off"}
            type="button"
          >
            <Waves aria-hidden="true" strokeWidth={1.8} />
          </button>
          <button
            aria-label={includeClutter ? "Disable clutter influence" : "Enable clutter influence"}
            className={`chart-endpoint-swap chart-endpoint-icon ${includeClutter ? "is-active" : ""}`}
            onClick={() => setIncludeClutter((value) => !value)}
            title={includeClutter ? "Clutter on" : "Clutter off"}
            type="button"
          >
            <Trees aria-hidden="true" strokeWidth={1.8} />
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
          <button
            aria-label={lockedAzimuth == null ? "Lock hovered direction" : "Unlock direction"}
            className={`chart-endpoint-swap chart-endpoint-icon ${lockedAzimuth == null ? "" : "is-active"}`}
            onClick={() => setLockedAzimuth((current) => (current == null ? activeAzimuth : null))}
            title={lockedAzimuth == null ? "Lock direction" : "Unlock direction"}
            type="button"
          >
            {lockedAzimuth == null ? <Lock aria-hidden="true" strokeWidth={1.8} /> : <Unlock aria-hidden="true" strokeWidth={1.8} />}
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
                  <line x1={M.l} x2={chartWidth - M.r} y1={geometry.yForAngle(value)} y2={geometry.yForAngle(value)} />
                  <text textAnchor="end" x={M.l - 8} y={geometry.yForAngle(value) + 4}>
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

              <path className="terrain-fill-path" d={geometry.horizonAreaPath} fill={`url(#${terrainFillGradientId})`} />
              {geometry.ridgeBands.map((band) => (
                <g key={band.key}>
                  <path className="panorama-ridge-band" d={band.area} style={{ opacity: band.opacity }} />
                  <path className="panorama-ridge-line" d={band.line} style={{ opacity: Math.min(0.7, band.opacity + 0.2) }} />
                </g>
              ))}
              {includeClutter && geometry.clutterAreaPath ? <path className="panorama-clutter-haze" d={geometry.clutterAreaPath} /> : null}
              {includeClutter && geometry.clutterPath ? <path className="panorama-clutter-line" d={geometry.clutterPath} /> : null}
              <path className="terrain-line-neutral" d={geometry.horizonPath} />

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
                onClick={onClick}
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
