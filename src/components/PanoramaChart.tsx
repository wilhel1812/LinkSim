import { scaleLinear } from "d3-scale";
import { Lock, Maximize2, Minimize2, Trees, Unlock, Waves } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "../lib/latestOnlyTaskScheduler";
import { dispatchPanoramaInteraction } from "../lib/panoramaEvents";
import { buildPanorama, destinationForDistanceKm, qualityToSampling, type PanoramaNodeCandidate, type PanoramaQuality, type PanoramaResult } from "../lib/panorama";
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

export function PanoramaChart({ isExpanded, onToggleExpanded, showExpandToggle = true, rowControls }: PanoramaChartProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [hoverAzimuth, setHoverAzimuth] = useState<number | null>(null);
  const [lockedAzimuth, setLockedAzimuth] = useState<number | null>(null);
  const [includeClutter, setIncludeClutter] = useState(false);
  const [verticalExaggeration, setVerticalExaggeration] = useState(true);

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

    const enqueueResult = scheduler.enqueue({
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

    if (enqueueResult === "started") return;
  }, [selectedSiteEffective, selectedNetwork, links, propagationEnvironment, includeClutter, quality, srtmTiles, nodeCandidates, rxSensitivityTargetDbm, environmentLossDb]);

  const chartWidth = chartSize?.width ?? 0;
  const chartHeight = chartSize?.height ?? 0;

  const geometry = useMemo(() => {
    if (!panorama || !chartSize) return null;
    const yPadding = 2;
    const yScaleSpan = (panorama.maxAngleDeg - panorama.minAngleDeg) + yPadding * 2;
    const exaggeration = verticalExaggeration ? 1.45 : 1;
    const yCenter = (panorama.maxAngleDeg + panorama.minAngleDeg) / 2;
    const yDomain: [number, number] = [
      yCenter - (yScaleSpan / 2) / exaggeration,
      yCenter + (yScaleSpan / 2) / exaggeration,
    ];
    const x = scaleLinear().domain([0, 360]).range([M.l, chartWidth - M.r]);
    const y = scaleLinear().domain(yDomain).range([chartHeight - M.b, M.t]);

    const silhouettePoints = panorama.rays.map((ray) => ({ x: x(ray.azimuthDeg), y: y(ray.horizonAngleDeg) }));
    const d = silhouettePoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const area = `${d} L${chartWidth - M.r},${chartHeight - M.b} L${M.l},${chartHeight - M.b} Z`;

    return {
      x,
      y,
      d,
      area,
      ticksX: [0, 60, 120, 180, 240, 300, 360],
      ticksY: [yDomain[0], (yDomain[0] + yDomain[1]) / 2, yDomain[1]],
    };
  }, [panorama, chartSize, chartWidth, chartHeight, verticalExaggeration]);

  const activeAzimuth = lockedAzimuth ?? hoverAzimuth;
  const activeRay = useMemo(() => {
    if (!panorama || activeAzimuth == null) return null;
    const steps = panorama.rays.length;
    if (!steps) return null;
    const index = Math.round((activeAzimuth / 360) * steps) % steps;
    return panorama.rays[index] ?? null;
  }, [panorama, activeAzimuth]);

  useEffect(() => {
    if (!selectedSiteEffective) return;
    if (!activeRay) {
      dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
      return;
    }
    const endpoint = destinationForDistanceKm(
      selectedSiteEffective.position,
      activeRay.azimuthDeg,
      Math.max(0.1, activeRay.horizonDistanceKm || activeRay.maxDistanceKm),
    );
    dispatchPanoramaInteraction({
      type: "hover",
      payload: {
        siteId: selectedSiteEffective.id,
        azimuthDeg: activeRay.azimuthDeg,
        endpoint,
        horizonDistanceKm: activeRay.horizonDistanceKm,
      },
    });
  }, [selectedSiteEffective, activeRay, lockedAzimuth]);

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 1) return;
    const xNorm = (event.clientX - rect.left) / rect.width;
    const azimuth = clamp(xNorm * 360, 0, 360);
    setHoverAzimuth(azimuth);
  };

  const onLeave = () => {
    setHoverAzimuth(null);
    if (!selectedSiteEffective) return;
    dispatchPanoramaInteraction({ type: "leave", siteId: selectedSiteEffective.id });
  };

  const onClick = () => {
    if (activeAzimuth == null || !selectedSiteEffective || !activeRay) return;
    const endpoint = destinationForDistanceKm(
      selectedSiteEffective.position,
      activeRay.azimuthDeg,
      Math.max(0.1, activeRay.horizonDistanceKm || activeRay.maxDistanceKm),
    );
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

  return (
    <section className={`chart-panel ${isExpanded ? "is-expanded" : ""}`}>
      <div className="chart-top-row">
        <div className="chart-endpoints" aria-live="polite">
          <span className="chart-endpoint chart-endpoint-left">{selectedSiteEffective.name}</span>
          <span className="chart-endpoint-sep" aria-hidden>
            →
          </span>
          <span className="chart-endpoint chart-endpoint-right">Panorama</span>
        </div>
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
          <svg aria-label="Panorama" height={chartHeight} role="img" width={chartWidth}>
            {geometry.ticksY.map((value) => (
              <g className="chart-grid" key={`y-${value.toFixed(2)}`}>
                <line x1={M.l} x2={chartWidth - M.r} y1={geometry.y(value)} y2={geometry.y(value)} />
                <text textAnchor="end" x={M.l - 8} y={geometry.y(value) + 4}>
                  {value.toFixed(1)}°
                </text>
              </g>
            ))}

            {geometry.ticksX.map((value) => (
              <g className="chart-grid" key={`x-${value}`}>
                <line x1={geometry.x(value)} x2={geometry.x(value)} y1={M.t} y2={chartHeight - M.b} />
                <text textAnchor="middle" x={geometry.x(value)} y={chartHeight - 8}>
                  {value.toFixed(0)}°
                </text>
              </g>
            ))}

            <path className="terrain-fill-path" d={geometry.area} />
            <path className="terrain-line-neutral" d={geometry.d} />

            {panorama.nodes.map((node) => (
              <g key={node.id}>
                <circle
                  className={`panorama-node panorama-node-${node.state} ${node.visible ? "is-visible" : "is-hidden"}`}
                  cx={geometry.x(node.azimuthDeg)}
                  cy={geometry.y(node.elevationAngleDeg)}
                  r={3.2}
                />
              </g>
            ))}

            {activeRay ? (
              <line
                className="profile-cursor"
                x1={geometry.x(activeRay.azimuthDeg)}
                x2={geometry.x(activeRay.azimuthDeg)}
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
        )}
      </div>
    </section>
  );
}
