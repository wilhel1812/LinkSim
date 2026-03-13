import { extent, max } from "d3-array";
import { scaleLinear } from "d3-scale";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import {
  classifyPassFailState,
  computeSourceCentricRxMetrics,
  passFailStateLabel,
  type PassFailState,
} from "../lib/passFailState";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { sampleSrtmElevation } from "../lib/srtm";
import { tilesForBounds } from "../lib/ve2dbeTerrainClient";
import { useAppStore } from "../store/appStore";

const W = 1200;
const H = 260;
const M = { t: 14, r: 10, b: 34, l: 36 };

const linePath = (points: { x: number; y: number }[]): string =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

const areaPath = (
  upper: { x: number; y: number }[],
  lower: { x: number; y: number }[],
): string => {
  const top = linePath(upper);
  const bottom = [...lower]
    .reverse()
    .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  return `${top} ${bottom} Z`;
};

export function LinkProfileChart() {
  const sites = useAppStore((state) => state.sites);
  const links = useAppStore((state) => state.links);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const getSelectedProfile = useAppStore((state) => state.getSelectedProfile);
  const profileCursorIndex = useAppStore((state) => state.profileCursorIndex);
  const setProfileCursorIndex = useAppStore((state) => state.setProfileCursorIndex);
  const temporaryDirectionReversed = useAppStore((state) => state.temporaryDirectionReversed);
  const toggleTemporaryDirectionReversed = useAppStore((state) => state.toggleTemporaryDirectionReversed);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const isTerrainFetching = useAppStore((state) => state.isTerrainFetching);
  const isTerrainRecommending = useAppStore((state) => state.isTerrainRecommending);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const networks = useAppStore((state) => state.networks);
  const propagationModel = useAppStore((state) => state.propagationModel);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const coverageResolutionMode = useAppStore((state) => state.coverageResolutionMode);
  const profileRevision = useAppStore(
    (state) =>
      `${state.selectedScenarioId}|${state.selectedLinkId}|${state.links.length}|${state.sites.length}|${state.srtmTiles.length}`,
  );
  const profile = getSelectedProfile();
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0] ?? null;
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
  const selectedFromSite = selectedFromSiteId ? sites.find((site) => site.id === selectedFromSiteId) ?? null : null;
  const selectedToSite = selectedToSiteId ? sites.find((site) => site.id === selectedToSiteId) ?? null : null;
  const selectedNetwork = networks.find((network) => network.id === selectedNetworkId) ?? networks[0] ?? null;
  const effectiveLink =
    selectedLink && selectedNetwork
      ? {
          ...selectedLink,
          frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz ?? selectedLink.frequencyMHz,
        }
      : null;
  const fromSiteName = selectedFromSite?.name ?? "From";
  const toSiteName = selectedToSite?.name ?? "To";
  const terrainBounds = simulationAreaBoundsForSites(sites);
  const requiredTerrainTileKeys = terrainBounds
    ? tilesForBounds(terrainBounds.minLat, terrainBounds.maxLat, terrainBounds.minLon, terrainBounds.maxLon)
    : [];
  const loadedTileKeys = new Set(srtmTiles.map((tile) => tile.key));
  const missingTerrainTileKeys = requiredTerrainTileKeys.filter((key) => !loadedTileKeys.has(key));
  const terrainIsStaleForCurrentArea = requiredTerrainTileKeys.length > 0 && missingTerrainTileKeys.length > 0;
  const autoFetchAttemptRef = useRef("");
  const terrainSignature = `${requiredTerrainTileKeys.join(",")}|missing:${missingTerrainTileKeys.join(",")}`;
  const terrainFillGradientId = useMemo(
    () => `profile-terrain-fill-${Math.random().toString(36).slice(2, 11)}`,
    [],
  );

  useEffect(() => {
    if (!terrainIsStaleForCurrentArea) {
      autoFetchAttemptRef.current = "";
      return;
    }
    if (isTerrainFetching || isTerrainRecommending) return;
    if (autoFetchAttemptRef.current === terrainSignature) return;
    autoFetchAttemptRef.current = terrainSignature;
    void recommendAndFetchTerrainForCurrentArea();
  }, [
    terrainIsStaleForCurrentArea,
    isTerrainFetching,
    isTerrainRecommending,
    recommendAndFetchTerrainForCurrentArea,
    terrainSignature,
  ]);

  const geometry = useMemo(() => {
    if (profile.length < 2) {
      return {
        hasData: false,
        xForDistance: () => M.l,
        yForElevation: () => H - M.b,
        terrainPath: "",
        terrainLineSegments: [] as { d: string; state: PassFailState }[],
        losPath: "",
        fresnelPath: "",
        yTicks: [] as { value: number; py: number }[],
        xTicks: [] as { value: number; px: number }[],
      };
    }

    const rawDistanceDomain = extent(profile, (p) => p.distanceKm);
    const distanceDomain: [number, number] =
      rawDistanceDomain[0] !== undefined && rawDistanceDomain[1] !== undefined
        ? [rawDistanceDomain[0], rawDistanceDomain[1]]
        : [0, 1];
    const safeDistanceDomain: [number, number] =
      distanceDomain[0] === distanceDomain[1]
        ? [distanceDomain[0], distanceDomain[0] + 0.001]
        : distanceDomain;

    const elevMax = max(profile, (p) => Math.max(p.terrainM, p.fresnelTopM)) ?? 10;
    const elevMin = Math.min(...profile.map((p) => Math.min(p.terrainM, p.fresnelBottomM)));
    const safeElevMin = Number.isFinite(elevMin) ? elevMin : 0;
    const safeElevMax = Number.isFinite(elevMax) ? elevMax : 10;
    const adjustedMax = safeElevMax <= safeElevMin ? safeElevMin + 1 : safeElevMax;

    const x = scaleLinear().domain(safeDistanceDomain).range([M.l, W - M.r]);
    const y = scaleLinear().domain([safeElevMin - 5, adjustedMax + 5]).range([H - M.b, M.t]);

    const terrainPoints = profile.map((p) => ({ x: x(p.distanceKm), y: y(p.terrainM) }));
    const losPoints = profile.map((p) => ({ x: x(p.distanceKm), y: y(p.losM) }));
    const fresnelTop = profile.map((p) => ({ x: x(p.distanceKm), y: y(p.fresnelTopM) }));
    const fresnelBottom = profile.map((p) => ({ x: x(p.distanceKm), y: y(p.fresnelBottomM) }));

    const terrainLineSegments = terrainPoints.slice(1).map((point, i) => ({
      d: linePath([terrainPoints[i], point]),
      state: "pass_clear" as PassFailState,
    }));

    return {
      hasData: true,
      xForDistance: (distanceKm: number) => x(distanceKm),
      yForElevation: (elevation: number) => y(elevation),
      terrainPath: `${linePath(terrainPoints)} L${W - M.r},${H - M.b} L${M.l},${H - M.b} Z`,
      terrainLineSegments,
      losPath: linePath(losPoints),
      fresnelPath: areaPath(fresnelTop, fresnelBottom),
      yTicks: Array.from({ length: 5 }, (_, i) => {
        const value = safeElevMin - 5 + ((adjustedMax - safeElevMin + 10) * i) / 4;
        return { value, py: y(value) };
      }),
      xTicks: Array.from({ length: 6 }, (_, i) => {
        const value =
          safeDistanceDomain[0] +
          ((safeDistanceDomain[1] - safeDistanceDomain[0]) * i) / 5;
        return { value, px: x(value) };
      }),
    };
  }, [profile]);

  const terrainLineSegments = useMemo(() => {
    if (!geometry.hasData || !selectedFromSite || !selectedToSite || !effectiveLink) return geometry.terrainLineSegments;
    return profile.slice(1).map((point, index) => {
      const metrics = computeSourceCentricRxMetrics(
        point.lat,
        point.lon,
        selectedFromSite,
        effectiveLink,
        selectedToSite.antennaHeightM,
        propagationModel,
        (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
        coverageResolutionMode === "high" ? 80 : 24,
      );
      const pass = metrics.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
      const losBlocked = propagationModel === "ITM" && metrics.terrainObstructed;
      const state = classifyPassFailState(pass, losBlocked);
      return {
        d: geometry.terrainLineSegments[index]?.d ?? "",
        state,
      };
    });
  }, [
    geometry.hasData,
    geometry.terrainLineSegments,
    profile,
    selectedFromSite,
    selectedToSite,
    effectiveLink,
    propagationModel,
    srtmTiles,
    coverageResolutionMode,
    environmentLossDb,
    rxSensitivityTargetDbm,
  ]);

  const clampedCursorIndex = Math.max(0, Math.min(profile.length - 1, profileCursorIndex));
  const cursorPoint = profile[clampedCursorIndex];
  const cursorState = useMemo(() => {
    if (!cursorPoint || !selectedFromSite || !selectedToSite || !effectiveLink) return null;
    const metrics = computeSourceCentricRxMetrics(
      cursorPoint.lat,
      cursorPoint.lon,
      selectedFromSite,
      effectiveLink,
      selectedToSite.antennaHeightM,
      propagationModel,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      coverageResolutionMode === "high" ? 80 : 24,
    );
    const pass = metrics.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
    const losBlocked = propagationModel === "ITM" && metrics.terrainObstructed;
    const state = classifyPassFailState(pass, losBlocked);
    return {
      state,
      label: passFailStateLabel(state),
      rxDbm: metrics.rxDbm,
    };
  }, [
    cursorPoint,
    selectedFromSite,
    selectedToSite,
    effectiveLink,
    propagationModel,
    srtmTiles,
    coverageResolutionMode,
    environmentLossDb,
    rxSensitivityTargetDbm,
  ]);

  const onSvgMove = (event: MouseEvent<SVGRectElement>) => {
    if (!geometry.hasData || profile.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xNorm = event.clientX - rect.left;
    const chartX = (xNorm / rect.width) * W;

    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < profile.length; i += 1) {
      const px = geometry.xForDistance(profile[i].distanceKm);
      const d = Math.abs(px - chartX);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = i;
      }
    }
    setProfileCursorIndex(nearest);
  };

  return (
    <section className="chart-panel" data-profile-revision={profileRevision}>
      {terrainIsStaleForCurrentArea ? (
        <div className="terrain-alert" role="status">
          <p>
            Terrain data is out of date for the current analysis area. Missing {missingTerrainTileKeys.length} of{" "}
            {requiredTerrainTileKeys.length} required tile(s).
          </p>
          <button
            className="inline-action"
            onClick={() => void recommendAndFetchTerrainForCurrentArea()}
            type="button"
          >
            Refresh Terrain Data
          </button>
        </div>
      ) : null}
      <div className="chart-endpoints" aria-live="polite">
        <span className="chart-endpoint chart-endpoint-left">{fromSiteName}</span>
        <span className="chart-endpoint-sep" aria-hidden>
          →
        </span>
        <span className="chart-endpoint chart-endpoint-right">{toSiteName}</span>
      </div>
      {!geometry.hasData ? (
        <div className="chart-empty">
          <p>Path profile unavailable for the selected link.</p>
        </div>
      ) : (
        <svg aria-label="Link profile" role="img" viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={terrainFillGradientId}
              x1={0}
              x2={0}
              y1={M.t}
              y2={H - M.b}
            >
              <stop offset="0%" stopColor="var(--terrain)" stopOpacity="0.06" />
              <stop offset="55%" stopColor="var(--terrain)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--terrain)" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          {geometry.yTicks.map((tick) => (
            <g className="chart-grid" key={`y-${tick.value}`}>
              <line x1={M.l} x2={W - M.r} y1={tick.py} y2={tick.py} />
              <text x={M.l - 8} y={tick.py + 4}>
                {tick.value.toFixed(0)}
              </text>
            </g>
          ))}

          {geometry.xTicks.map((tick) => (
            <g className="chart-grid" key={`x-${tick.value}`}>
              <line x1={tick.px} x2={tick.px} y1={M.t} y2={H - M.b} />
              <text x={tick.px} y={H - 8}>
                {tick.value.toFixed(1)} km
              </text>
            </g>
          ))}

          <path className="fresnel-band" d={geometry.fresnelPath} />
          <path className="terrain-fill-path" d={geometry.terrainPath} fill={`url(#${terrainFillGradientId})`} />
          {terrainLineSegments.map((segment, index) => (
            <path
              className={`terrain-state-${segment.state}`}
              d={segment.d}
              key={`terrain-segment-${index}`}
            />
          ))}
          <path className="los-path" d={geometry.losPath} />
          {cursorPoint ? (
            <g className="profile-cursor">
              <line
                x1={geometry.xForDistance(cursorPoint.distanceKm)}
                x2={geometry.xForDistance(cursorPoint.distanceKm)}
                y1={M.t}
                y2={H - M.b}
              />
              <circle
                cx={geometry.xForDistance(cursorPoint.distanceKm)}
                cy={geometry.yForElevation(cursorPoint.terrainM)}
                r={4}
              />
            </g>
          ) : null}
          <rect
            className="profile-hitbox"
            x={M.l}
            y={M.t}
            width={W - M.l - M.r}
            height={H - M.t - M.b}
            onMouseMove={onSvgMove}
          />
        </svg>
      )}
      <div className="chart-footer-row">
        <div className="chart-hover-state">
          {cursorPoint && cursorState ? (
            <>
              <span className={`state-dot state-dot-${cursorState.state}`} aria-hidden />
              <span>
                {cursorState.label} at {cursorPoint.distanceKm.toFixed(2)} km (
                {(cursorState.rxDbm - environmentLossDb).toFixed(1)} dBm after env loss)
              </span>
            </>
          ) : null}
        </div>
        <button
          aria-label="Reverse path direction for this view"
          className={`chart-endpoint-swap ${temporaryDirectionReversed ? "is-active" : ""}`}
          onClick={toggleTemporaryDirectionReversed}
          title="Temporarily reverse path direction"
          type="button"
        >
          Flip Direction
        </button>
        <div />
      </div>
    </section>
  );
}
