import { extent, max } from "d3-array";
import { scaleLinear } from "d3-scale";
import type { MouseEvent } from "react";
import { useMemo } from "react";
import { t } from "../i18n/locales";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { tilesForBounds } from "../lib/ve2dbeTerrainClient";
import { useAppStore } from "../store/appStore";

const W = 840;
const H = 240;
const M = { t: 16, r: 18, b: 30, l: 48 };

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
  const locale = useAppStore((state) => state.locale);
  const links = useAppStore((state) => state.links);
  const sites = useAppStore((state) => state.sites);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const getSelectedProfile = useAppStore((state) => state.getSelectedProfile);
  const profileCursorIndex = useAppStore((state) => state.profileCursorIndex);
  const setProfileCursorIndex = useAppStore((state) => state.setProfileCursorIndex);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const profileRevision = useAppStore(
    (state) =>
      `${state.selectedScenarioId}|${state.selectedLinkId}|${state.links.length}|${state.sites.length}|${state.srtmTiles.length}`,
  );
  const profile = getSelectedProfile();
  const selectedLink = links.find((link) => link.id === selectedLinkId);
  const fromSiteName = sites.find((site) => site.id === selectedLink?.fromSiteId)?.name ?? "From";
  const toSiteName = sites.find((site) => site.id === selectedLink?.toSiteId)?.name ?? "To";
  const terrainBounds = simulationAreaBoundsForSites(sites);
  const requiredTerrainTileKeys = terrainBounds
    ? tilesForBounds(terrainBounds.minLat, terrainBounds.maxLat, terrainBounds.minLon, terrainBounds.maxLon)
    : [];
  const loadedTileKeys = new Set(srtmTiles.map((tile) => tile.key));
  const missingTerrainTileKeys = requiredTerrainTileKeys.filter((key) => !loadedTileKeys.has(key));
  const terrainIsStaleForCurrentArea = requiredTerrainTileKeys.length > 0 && missingTerrainTileKeys.length > 0;

  const geometry = useMemo(() => {
    if (profile.length < 2) {
      return {
        hasData: false,
        xForDistance: () => M.l,
        yForElevation: () => H - M.b,
        terrainPath: "",
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

    return {
      hasData: true,
      xForDistance: (distanceKm: number) => x(distanceKm),
      yForElevation: (elevation: number) => y(elevation),
      terrainPath: `${linePath(terrainPoints)} L${W - M.r},${H - M.b} L${M.l},${H - M.b} Z`,
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

  const clampedCursorIndex = Math.max(0, Math.min(profile.length - 1, profileCursorIndex));
  const cursorPoint = profile[clampedCursorIndex];

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
      <header className="chart-header">
        <h2>{t(locale, "pathProfile")}</h2>
        <p>{t(locale, "profileSubtitle")}</p>
      </header>
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
          <path className="terrain-path" d={geometry.terrainPath} />
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
    </section>
  );
}
