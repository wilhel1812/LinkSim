import { extent, max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { ArrowLeftRight, PanelBottomClose, PanelBottomOpen } from "lucide-react";
import { FloatingPopover } from "./ui/FloatingPopover";
import { MapControlButton } from "./ui/MapControlButton";
import { PanelToolbar } from "./ui/PanelToolbar";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  classifyPassFailState,
  computeSourceCentricRxMetrics,
  passFailStateLabel,
  type PassFailState,
} from "../lib/passFailState";
import { buildProfileChartSvgProps } from "../lib/profileChartSvg";
import { buildHoverProfileSegments } from "../lib/profileHoverSegments";
import { dispatchProfileDraftSiteRequest } from "../lib/profileDraftEvent";
import { buildProfile } from "../lib/propagation";
import { StateDot } from "./StateDot";
import { buildSelectionEffectiveLink } from "../lib/selectionEffectiveLink";
import { atmosphericBendingNUnitsToKFactor } from "../lib/terrainLoss";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { sampleSrtmElevation } from "../lib/srtm";
import { tilesForBounds } from "../lib/terrainTiles";
import { useAppStore } from "../store/appStore";

const M = { t: 14, r: 28, b: 34, l: 50 };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

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

const earthBulgeM = (distanceKm: number, t: number): number => {
  const earthRadiusM = 6_371_000;
  const dTotalM = Math.max(1, distanceKm * 1000);
  const x = dTotalM * t;
  return (x * (dTotalM - x)) / (2 * earthRadiusM);
};

type LinkProfileChartProps = {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  showExpandToggle?: boolean;
  rowControls?: ReactNode;
  panelClassName?: string;
};

export function LinkProfileChart({
  isExpanded,
  onToggleExpanded,
  showExpandToggle = true,
  rowControls,
  panelClassName,
}: LinkProfileChartProps) {
  const chartPanelRef = useRef<HTMLElement | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [hostAttachRevision, setHostAttachRevision] = useState(0);
  const segmentStateCacheRef = useRef<Map<string, PassFailState[]>>(new Map());
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [terrainSegmentStates, setTerrainSegmentStates] = useState<PassFailState[]>([]);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const hasMeasuredSize = Boolean(chartSize && chartSize.width > 1 && chartSize.height > 1);
  const chartWidth = chartSize?.width ?? 0;
  const chartHeight = chartSize?.height ?? 0;
  const sites = useAppStore((state) => state.sites);
  const links = useAppStore((state) => state.links);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteIds = useAppStore((state) => state.selectedSiteIds);
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
  const siteDragPreview = useAppStore((state) => state.siteDragPreview);
  const propagationModel = useAppStore((state) => state.propagationModel);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const profileRevision = useAppStore(
    (state) =>
      `${state.selectedScenarioId}|${state.selectedLinkId}|${state.links.length}|${state.sites.length}|${state.srtmTiles.length}|${Object.keys(state.siteDragPreview).length}`,
  );

  const setChartHostElement = useCallback((element: HTMLDivElement | null) => {
    if (chartHostRef.current === element) return;
    chartHostRef.current = element;
    setHostAttachRevision((current) => current + 1);
  }, []);

  const baseProfile = getSelectedProfile();
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null;
  const selectedSites = useMemo(
    () => selectedSiteIds.map((id) => sites.find((site) => site.id === id)).filter((site): site is (typeof sites)[number] => Boolean(site)),
    [selectedSiteIds, sites],
  );
  const selectionCount = selectedSites.length;
  const hasMinimumTopology = selectionCount >= 2;
  const tooManySelectedForProfile = selectionCount > 2;
  const selectedFromSiteId =
    selectedSites.length >= 2
      ? temporaryDirectionReversed
        ? selectedSites[selectedSites.length - 1].id
        : selectedSites[0].id
      : selectedLink
        ? temporaryDirectionReversed
          ? selectedLink.toSiteId
          : selectedLink.fromSiteId
        : null;
  const selectedToSiteId =
    selectedSites.length >= 2
      ? temporaryDirectionReversed
        ? selectedSites[0].id
        : selectedSites[selectedSites.length - 1].id
      : selectedLink
        ? temporaryDirectionReversed
          ? selectedLink.fromSiteId
          : selectedLink.toSiteId
        : null;
  const selectedFromSite = selectedFromSiteId ? sites.find((site) => site.id === selectedFromSiteId) ?? null : null;
  const selectedToSite = selectedToSiteId ? sites.find((site) => site.id === selectedToSiteId) ?? null : null;
  const selectedFromSiteEffective = useMemo(() => {
    if (!selectedFromSite) return null;
    const preview = siteDragPreview[selectedFromSite.id];
    if (!preview) return selectedFromSite;
    return {
      ...selectedFromSite,
      position: preview.position,
      groundElevationM: preview.groundElevationM,
    };
  }, [selectedFromSite, siteDragPreview]);
  const selectedToSiteEffective = useMemo(() => {
    if (!selectedToSite) return null;
    const preview = siteDragPreview[selectedToSite.id];
    if (!preview) return selectedToSite;
    return {
      ...selectedToSite,
      position: preview.position,
      groundElevationM: preview.groundElevationM,
    };
  }, [selectedToSite, siteDragPreview]);
  const selectedNetwork = networks.find((network) => network.id === selectedNetworkId) ?? networks[0] ?? null;
  const effectiveLink = useMemo(() => {
    if (!selectedNetwork) return null;
    if (selectedLink) {
      return {
        ...selectedLink,
        frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz ?? selectedLink.frequencyMHz,
      };
    }
    if (!selectedFromSite || !selectedToSite) return null;
    return buildSelectionEffectiveLink({
      fromSite: selectedFromSite,
      toSite: selectedToSite,
      frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz,
    });
  }, [selectedLink, selectedNetwork, selectedFromSite, selectedToSite]);
  const profile = useMemo(() => {
    if (!effectiveLink || !selectedFromSiteEffective || !selectedToSiteEffective) return baseProfile;
    const hasPreview =
      Boolean(siteDragPreview[selectedFromSiteEffective.id]) || Boolean(siteDragPreview[selectedToSiteEffective.id]);
    if (!hasPreview) return baseProfile;
    return buildProfile(
      effectiveLink,
      selectedFromSiteEffective,
      selectedToSiteEffective,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      120,
      { kFactor: atmosphericBendingNUnitsToKFactor(propagationEnvironment.atmosphericBendingNUnits) },
    );
  }, [
    baseProfile,
    effectiveLink,
    selectedFromSiteEffective,
    selectedToSiteEffective,
    siteDragPreview,
    srtmTiles,
    propagationEnvironment.atmosphericBendingNUnits,
  ]);
  const fromSiteName = selectedFromSite?.name ?? "From";
  const toSiteName = selectedToSite?.name ?? "To";
  const terrainBounds = simulationAreaBoundsForSites(selectedSites.length ? selectedSites : sites);
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

  useEffect(() => {
    if (profile.length < 1) return;
    // Default map/profile target should be the current path endpoint.
    setProfileCursorIndex(profile.length - 1);
  }, [profile.length, selectedLinkId, temporaryDirectionReversed, setProfileCursorIndex]);

  useLayoutEffect(() => {
    const element = chartHostRef.current;
    if (!element) return;

    const updateSize = () => {
      const hostRect = element.getBoundingClientRect();
      const parentRect = element.parentElement?.getBoundingClientRect();
      const measuredWidth = Math.round(hostRect.width || parentRect?.width || 0);
      const measuredHeight = Math.round(hostRect.height || parentRect?.height || 0);
      if (measuredWidth <= 1 || measuredHeight <= 1) return;
      const nextWidth = measuredWidth;
      const nextHeight = measuredHeight;
      setChartSize((current) => {
        const changed =
          !current ||
          Math.abs(current.width - nextWidth) > 1 ||
          Math.abs(current.height - nextHeight) > 1;
        return changed ? { width: nextWidth, height: nextHeight } : current;
      });
    };

    updateSize();
    const rafId = requestAnimationFrame(updateSize);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelAnimationFrame(rafId);
      };
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [profile.length, hasMinimumTopology, hostAttachRevision]);

  const geometry = useMemo(() => {
    if (!hasMeasuredSize || profile.length < 2) {
      return {
        hasData: false,
        xForDistance: () => M.l,
        yForElevation: () => chartHeight - M.b,
        terrainPath: "",
        terrainStrokePath: "",
        terrainLineSegments: [] as { d: string; state: PassFailState }[],
        yTicks: [] as { value: number; py: number }[],
        xTicks: [] as { value: number; px: number; anchor: "start" | "middle" | "end" }[],
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

    const x = scaleLinear().domain(safeDistanceDomain).range([M.l, chartWidth - M.r]);
    const y = scaleLinear().domain([safeElevMin - 5, adjustedMax + 5]).range([chartHeight - M.b, M.t]);
    const chartInnerWidth = Math.max(1, chartWidth - M.l - M.r);
    const chartInnerHeight = Math.max(1, chartHeight - M.t - M.b);
    const xTickCount = clamp(Math.round(chartInnerWidth / 140) + 1, 3, 10);
    const yTickCount = clamp(Math.round(chartInnerHeight / 72) + 1, 3, 7);

    const terrainPoints = profile.map((p) => ({ x: x(p.distanceKm), y: y(p.terrainM) }));
    const terrainLineSegments = terrainPoints.slice(1).map((point, i) => ({
      d: linePath([terrainPoints[i], point]),
      state: "pass_clear" as PassFailState,
    }));

    return {
      hasData: true,
      xForDistance: (distanceKm: number) => x(distanceKm),
      yForElevation: (elevation: number) => y(elevation),
      terrainPath: `${linePath(terrainPoints)} L${chartWidth - M.r},${chartHeight - M.b} L${M.l},${chartHeight - M.b} Z`,
      terrainStrokePath: linePath(terrainPoints),
      terrainLineSegments,
      yTicks: Array.from({ length: yTickCount }, (_, i) => {
        const value =
          safeElevMin - 5 + ((adjustedMax - safeElevMin + 10) * i) / Math.max(1, yTickCount - 1);
        return { value, py: y(value) };
      }),
      xTicks: Array.from({ length: xTickCount }, (_, i) => {
        const value =
          safeDistanceDomain[0] +
          ((safeDistanceDomain[1] - safeDistanceDomain[0]) * i) / Math.max(1, xTickCount - 1);
        return {
          value,
          px: x(value),
          anchor:
            (i === 0 ? "start" : i === xTickCount - 1 ? "end" : "middle") as "start" | "middle" | "end",
        };
      }),
    };
  }, [profile, chartWidth, chartHeight, hasMeasuredSize]);
  const svgProps = useMemo(() => buildProfileChartSvgProps(chartWidth, chartHeight), [chartWidth, chartHeight]);

  const segmentStateKey = useMemo(
    () =>
      [
        profileRevision,
        propagationModel,
        rxSensitivityTargetDbm,
        environmentLossDb,
        propagationEnvironment.atmosphericBendingNUnits,
        propagationEnvironment.clutterHeightM,
        propagationEnvironment.polarization,
      ].join("|"),
    [
      profileRevision,
      propagationModel,
      rxSensitivityTargetDbm,
      environmentLossDb,
      propagationEnvironment.atmosphericBendingNUnits,
      propagationEnvironment.clutterHeightM,
      propagationEnvironment.polarization,
    ],
  );

  useEffect(() => {
    if (!geometry.hasData || !selectedFromSiteEffective || !selectedToSiteEffective || !effectiveLink || profile.length < 2) {
      setTerrainSegmentStates([]);
      return;
    }
    const cached = segmentStateCacheRef.current.get(segmentStateKey);
    if (cached && cached.length === profile.length - 1) {
      setTerrainSegmentStates(cached);
      return;
    }

    setTerrainSegmentStates([]);
    const nextStates = new Array<PassFailState>(profile.length - 1);
    let index = 1;
    let cancelled = false;
    let rafId = 0;
    const sampleTerrain = (lat: number, lon: number): number | null => sampleSrtmElevation(srtmTiles, lat, lon);

    const processChunk = () => {
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      while (index < profile.length) {
        const point = profile[index];
        const metrics = computeSourceCentricRxMetrics(
          point.lat,
          point.lon,
          selectedFromSiteEffective,
          effectiveLink,
          selectedToSiteEffective.antennaHeightM,
          selectedToSiteEffective.rxGainDbi,
          sampleTerrain,
          24,
          propagationEnvironment,
        );
        const pass = metrics.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
        const losBlocked = metrics.terrainObstructed;
        nextStates[index - 1] = classifyPassFailState(pass, losBlocked);
        index += 1;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - start >= 8) break;
      }

      if (cancelled) return;
      if (index < profile.length) {
        rafId = requestAnimationFrame(processChunk);
        return;
      }

      const cache = segmentStateCacheRef.current;
      cache.set(segmentStateKey, nextStates);
      if (cache.size > 36) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
      setTerrainSegmentStates(nextStates);
    };

    rafId = requestAnimationFrame(processChunk);
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    geometry.hasData,
    profile,
    selectedFromSiteEffective,
    selectedToSiteEffective,
    effectiveLink,
    propagationModel,
    srtmTiles,
    environmentLossDb,
    rxSensitivityTargetDbm,
    propagationEnvironment,
    segmentStateKey,
  ]);

  const terrainLineSegments = useMemo(() => {
    if (!geometry.hasData) return geometry.terrainLineSegments;
    return geometry.terrainLineSegments.map((segment, index) => ({
      ...segment,
      state: terrainSegmentStates[index] ?? segment.state,
    }));
  }, [
    geometry.terrainLineSegments,
    geometry.hasData,
    terrainSegmentStates,
  ]);

  const clampedCursorIndex = Math.max(0, Math.min(profile.length - 1, profileCursorIndex));
  const cursorPoint = profile[clampedCursorIndex];
  const activeHoverSegments = useMemo(() => {
    if (!effectiveLink || !selectedFromSiteEffective || !selectedToSiteEffective) return [];
    return buildHoverProfileSegments(
      profile,
      clampedCursorIndex,
      selectedFromSiteEffective.antennaHeightM,
      selectedToSiteEffective.antennaHeightM,
      effectiveLink.frequencyMHz,
    );
  }, [
    profile,
    clampedCursorIndex,
    selectedFromSiteEffective,
    selectedToSiteEffective,
    effectiveLink,
  ]);
  const isSplitHoverMode = activeHoverSegments.length > 1;
  const hoverSegmentStates = useMemo(() => {
    const states = new Map<"from-to-cursor" | "to-to-cursor", PassFailState>();
    if (!cursorPoint || !selectedFromSiteEffective || !selectedToSiteEffective || !effectiveLink) return states;

    const forward = computeSourceCentricRxMetrics(
      cursorPoint.lat,
      cursorPoint.lon,
      selectedFromSiteEffective,
      effectiveLink,
      selectedToSiteEffective.antennaHeightM,
      selectedToSiteEffective.rxGainDbi,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      24,
      propagationEnvironment,
    );
    const forwardPass = forward.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
    const forwardBlocked = forward.terrainObstructed;
    states.set("from-to-cursor", classifyPassFailState(forwardPass, forwardBlocked));

    if (isSplitHoverMode) {
      const reverse = computeSourceCentricRxMetrics(
        cursorPoint.lat,
        cursorPoint.lon,
        selectedToSiteEffective,
        effectiveLink,
        selectedFromSiteEffective.antennaHeightM,
        selectedFromSiteEffective.rxGainDbi,
        (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
        24,
        propagationEnvironment,
      );
      const reversePass = reverse.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
      const reverseBlocked = reverse.terrainObstructed;
      states.set("to-to-cursor", classifyPassFailState(reversePass, reverseBlocked));
    }

    return states;
  }, [
    cursorPoint,
    selectedFromSiteEffective,
    selectedToSiteEffective,
    effectiveLink,
    propagationModel,
    srtmTiles,
    propagationEnvironment,
    environmentLossDb,
    rxSensitivityTargetDbm,
    isSplitHoverMode,
  ]);
  const activeLosPaths = useMemo(
    () =>
      activeHoverSegments.map((segment, index) => ({
        id: segment.id,
        path: linePath(
          segment.points.map((point) => ({
            x: geometry.xForDistance(point.distanceKm),
            y: geometry.yForElevation(point.losM),
          })),
        ),
        state: hoverSegmentStates.get(segment.id) ?? "pass_clear",
        isSecondary: index > 0,
      })),
    [activeHoverSegments, geometry, hoverSegmentStates],
  );
  const activeFresnelPaths = useMemo(
    () =>
      activeHoverSegments.map((segment) => {
        const top = segment.points.map((point) => ({
          x: geometry.xForDistance(point.distanceKm),
          y: geometry.yForElevation(point.fresnelTopM),
        }));
        const bottom = segment.points.map((point) => ({
          x: geometry.xForDistance(point.distanceKm),
          y: geometry.yForElevation(point.fresnelBottomM),
        }));
        return areaPath(top, bottom);
      }),
    [activeHoverSegments, geometry],
  );
  const earthCurvatureHorizonPath = useMemo(() => {
    if (profile.length < 2) return "";
    const totalDistanceKm = Math.max(0.001, profile[profile.length - 1]?.distanceKm ?? 0.001);
    const points = profile.map((point) => {
      const t = clamp(point.distanceKm / totalDistanceKm, 0, 1);
      const curvedSeaLevelM = earthBulgeM(totalDistanceKm, t);
      return {
        x: geometry.xForDistance(point.distanceKm),
        y: geometry.yForElevation(curvedSeaLevelM),
      };
    });
    return linePath(points);
  }, [profile, geometry]);
  const cursorStates = useMemo(() => {
    if (!cursorPoint || !selectedFromSiteEffective || !selectedToSiteEffective || !effectiveLink) return null;
    const forwardMetrics = computeSourceCentricRxMetrics(
      cursorPoint.lat,
      cursorPoint.lon,
      selectedFromSiteEffective,
      effectiveLink,
      selectedToSiteEffective.antennaHeightM,
      selectedToSiteEffective.rxGainDbi,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      24,
      propagationEnvironment,
    );
    const forwardPass = forwardMetrics.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
    const forwardBlocked = forwardMetrics.terrainObstructed;
    const forwardState = classifyPassFailState(forwardPass, forwardBlocked);
    const totalDistanceKm = profile[profile.length - 1]?.distanceKm ?? 0;
    const nextStates = [
      {
        key: "from",
        sideLabel: `${fromSiteName} -> Cursor Point`,
        distanceKm: cursorPoint.distanceKm,
        state: forwardState,
        label: passFailStateLabel(forwardState),
        rxAfterEnvLossDbm: forwardMetrics.rxDbm - environmentLossDb,
      },
    ];

    if (!isSplitHoverMode) return nextStates;

    const reverseMetrics = computeSourceCentricRxMetrics(
      cursorPoint.lat,
      cursorPoint.lon,
      selectedToSiteEffective,
      effectiveLink,
      selectedFromSiteEffective.antennaHeightM,
      selectedFromSiteEffective.rxGainDbi,
      (lat, lon) => sampleSrtmElevation(srtmTiles, lat, lon),
      24,
      propagationEnvironment,
    );
    const reversePass = reverseMetrics.rxDbm - environmentLossDb >= rxSensitivityTargetDbm;
    const reverseBlocked = reverseMetrics.terrainObstructed;
    const reverseState = classifyPassFailState(reversePass, reverseBlocked);
    nextStates.push({
      key: "to",
      sideLabel: `${toSiteName} -> Cursor Point`,
      distanceKm: Math.max(0, totalDistanceKm - cursorPoint.distanceKm),
      state: reverseState,
      label: passFailStateLabel(reverseState),
      rxAfterEnvLossDbm: reverseMetrics.rxDbm - environmentLossDb,
    });
    return nextStates;
  }, [
    cursorPoint,
    profile,
    selectedFromSiteEffective,
    selectedToSiteEffective,
    effectiveLink,
    fromSiteName,
    toSiteName,
    isSplitHoverMode,
    propagationModel,
    srtmTiles,
    environmentLossDb,
    rxSensitivityTargetDbm,
    propagationEnvironment,
  ]);
  const footerCursorState = !isSplitHoverMode && cursorStates ? cursorStates[0] : null;
  const splitHoverPopoverPosition = useMemo(() => {
    if (!hoverPosition || !isSplitHoverMode) return null;
    return {
      x: clamp(hoverPosition.x, 180, chartWidth - 180),
      y: clamp(hoverPosition.y - 12, 52, chartHeight - 12),
    };
  }, [hoverPosition, isSplitHoverMode, chartWidth, chartHeight]);

  const onSvgMove = (event: MouseEvent<SVGRectElement>) => {
    if (!geometry.hasData || profile.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xNorm = event.clientX - rect.left;
    const yNorm = event.clientY - rect.top;
    const chartX = (xNorm / rect.width) * chartWidth;
    const chartY = M.t + (yNorm / rect.height) * (chartHeight - M.t - M.b);

    const getNearestProfileIndex = (xCoordinate: number): number => {
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < profile.length; i += 1) {
        const px = geometry.xForDistance(profile[i].distanceKm);
        const d = Math.abs(px - xCoordinate);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = i;
        }
      }
      return nearest;
    };

    const nearest = getNearestProfileIndex(chartX);
    setProfileCursorIndex(nearest);
    setHoverPosition({ x: chartX, y: chartY });
  };

  const onSvgClick = (event: MouseEvent<SVGRectElement>) => {
    if (!geometry.hasData || profile.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xNorm = event.clientX - rect.left;
    const chartX = (xNorm / rect.width) * chartWidth;

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
    const nearestPoint = profile[nearest];
    if (!nearestPoint) return;
    dispatchProfileDraftSiteRequest({ lat: nearestPoint.lat, lon: nearestPoint.lon });
  };

  const onSvgLeave = () => {
    setHoverPosition(null);
    if (profile.length < 1) return;
    setProfileCursorIndex(profile.length - 1);
  };

  if (!hasMinimumTopology) {
    return (
      <section className={`chart-panel chart-panel-empty ${panelClassName ?? ""}`.trim()}>
        <div className="chart-empty">
          Select exactly two sites, or choose a saved link, to show path profile and LOS/Fresnel analysis.
        </div>
      </section>
    );
  }

  if (tooManySelectedForProfile) {
    return (
      <section className={`chart-panel chart-panel-empty ${panelClassName ?? ""}`.trim()}>
        <div className="chart-empty">
          Select exactly two sites, or choose a saved link, to show path profile analysis.
        </div>
      </section>
    );
  }

  return (
    <section className={`chart-panel ${isExpanded ? "is-expanded" : ""} ${panelClassName ?? ""}`.trim()} data-profile-revision={profileRevision} ref={chartPanelRef}>
      <PanelToolbar
        title={
          <div className="chart-endpoints" aria-live="polite">
            <span className="chart-endpoint chart-endpoint-left">{fromSiteName}</span>
            <span className="chart-endpoint-sep" aria-hidden>→</span>
            <span className="chart-endpoint chart-endpoint-right">{toSiteName}</span>
          </div>
        }
        actions={
          <>
            <MapControlButton
              aria-label="Reverse path direction for this view"
              isSelected={temporaryDirectionReversed}
              onClick={toggleTemporaryDirectionReversed}
              title="Temporarily reverse path direction"
            >
              <ArrowLeftRight aria-hidden="true" strokeWidth={1.8} />
            </MapControlButton>
            {showExpandToggle ? (
              <MapControlButton
                aria-label={isExpanded ? "Exit full screen" : "Full screen"}
                isSelected={isExpanded}
                onClick={onToggleExpanded}
                title={isExpanded ? "Exit full screen" : "Full screen"}
              >
                {isExpanded ? <PanelBottomClose aria-hidden="true" strokeWidth={1.8} /> : <PanelBottomOpen aria-hidden="true" strokeWidth={1.8} />}
              </MapControlButton>
            ) : null}
            {rowControls}
          </>
        }
      />
      <div className="chart-action-row">
        <div className="chart-hover-state">
          {cursorPoint && footerCursorState ? (
            <>
              <StateDot state={footerCursorState.state} />
              <span>
                {footerCursorState.label} at {footerCursorState.distanceKm.toFixed(2)} km (
                {footerCursorState.rxAfterEnvLossDbm.toFixed(1)} dBm after env loss)
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="chart-svg-wrap" ref={setChartHostElement}>
      {profile.length < 2 ? (
        <div className="chart-empty">
          <p>Path profile unavailable for the selected link.</p>
        </div>
      ) : hasMeasuredSize && geometry.hasData ? (
        <>
        <svg
          aria-label="Link profile"
          height={svgProps.height}
          role="img"
          width={svgProps.width}
        >
          <defs>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={terrainFillGradientId}
              x1={0}
              x2={0}
              y1={M.t}
              y2={chartHeight - M.b}
            >
              <stop offset="0%" stopColor="var(--terrain)" stopOpacity="0.06" />
              <stop offset="55%" stopColor="var(--terrain)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--terrain)" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          {geometry.yTicks.map((tick) => (
            <g className="chart-grid" key={`y-${tick.value}`}>
              <line x1={M.l} x2={chartWidth - M.r} y1={tick.py} y2={tick.py} />
              <text textAnchor="end" x={M.l - 8} y={tick.py + 4}>
                {tick.value.toFixed(0)}
              </text>
            </g>
          ))}

          {geometry.xTicks.map((tick) => (
            <g className="chart-grid" key={`x-${tick.value}`}>
              <line x1={tick.px} x2={tick.px} y1={M.t} y2={chartHeight - M.b} />
              <text textAnchor={tick.anchor} x={tick.px} y={chartHeight - 8}>
                {tick.value.toFixed(1)} km
              </text>
            </g>
          ))}

          {activeFresnelPaths.map((path, index) => (
            <path className={`fresnel-band ${index > 0 ? "fresnel-band-secondary" : ""}`} d={path} key={`fresnel-${index}`} />
          ))}
          <path className="terrain-fill-path" d={geometry.terrainPath} fill={`url(#${terrainFillGradientId})`} />
          {isSplitHoverMode ? (
            <path className="terrain-line-neutral" d={geometry.terrainStrokePath} />
          ) : (
            terrainLineSegments.map((segment, index) => (
              <path
                className={`terrain-state-${segment.state}`}
                d={segment.d}
                key={`terrain-segment-${index}`}
              />
            ))
          )}
          <path className="earth-curvature-horizon" d={earthCurvatureHorizonPath} />
          {activeLosPaths.map((segment) => (
            <path
              className={`los-path state-${segment.state} ${segment.isSecondary ? "los-path-secondary" : ""}`}
              d={segment.path}
              key={`los-${segment.id}`}
            />
          ))}
          {cursorPoint ? (
            <g className="profile-cursor">
              <line
                x1={geometry.xForDistance(cursorPoint.distanceKm)}
                x2={geometry.xForDistance(cursorPoint.distanceKm)}
                y1={M.t}
                y2={chartHeight - M.b}
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
            width={chartWidth - M.l - M.r}
            height={chartHeight - M.t - M.b}
            onClick={onSvgClick}
            onMouseMove={onSvgMove}
            onMouseLeave={onSvgLeave}
          />
        </svg>
        {splitHoverPopoverPosition && cursorStates && cursorStates.length > 1 ? (
          <FloatingPopover
            open={true}
            onClose={() => {}}
            containerRef={chartPanelRef}
            placement="centered"
            className="panorama-legend-popover"
            estimatedHeight={160}
            estimatedWidth={400}
          >
            {cursorStates.map((state) => (
              <div className="chart-hover-popover-row" key={state.key}>
                <StateDot state={state.state} />
                <span>
                  {state.sideLabel}: {state.label} at {state.distanceKm.toFixed(2)} km ({state.rxAfterEnvLossDbm.toFixed(1)} dBm after env loss)
                </span>
              </div>
            ))}
          </FloatingPopover>
        ) : null}
        </>
      ) : (
        <div className="chart-empty" aria-hidden="true" />
      )}
      </div>
    </section>
  );
}
