import { resolveSingleSiteBonusRadiusKm } from "./singleSiteBonusRadius";
import { simulationAreaBoundsForSites } from "./simulationArea";
import { tilesForBounds } from "./terrainTiles";
import type { Site, SrtmTile } from "../types/radio";

export type SimulationOverlayRadiusOption = "auto" | "20" | "50" | "100" | "200";

const SINGLE_SITE_OPTIONS: SimulationOverlayRadiusOption[] = ["auto", "100", "200"];
const MULTI_SITE_OPTIONS: SimulationOverlayRadiusOption[] = ["20", "50", "100"];

export const optionsForSelectionCount = (selectionCount: number): SimulationOverlayRadiusOption[] =>
  selectionCount === 1 ? SINGLE_SITE_OPTIONS : MULTI_SITE_OPTIONS;

export const defaultOptionForSelectionCount = (selectionCount: number): SimulationOverlayRadiusOption =>
  selectionCount === 1 ? "auto" : "20";

export const normalizeOverlayRadiusOptionForSelectionCount = (
  selectionCount: number,
  option: unknown,
): SimulationOverlayRadiusOption => {
  const candidate = typeof option === "string" ? (option as SimulationOverlayRadiusOption) : null;
  const allowed = optionsForSelectionCount(selectionCount);
  if (candidate && allowed.includes(candidate)) return candidate;
  return defaultOptionForSelectionCount(selectionCount);
};

export const isOverlayRadiusOption = (value: unknown): value is SimulationOverlayRadiusOption =>
  typeof value === "string" &&
  (["auto", "20", "50", "100", "200"] as const).includes(value as SimulationOverlayRadiusOption);

export const resolveEffectiveOverlayRadiusKm = (params: {
  selectionCount: number;
  option: SimulationOverlayRadiusOption;
  selectedSingleSite: Pick<Site, "position"> | null;
  srtmTiles: ReadonlyArray<SrtmTile>;
  isTerrainFetching: boolean;
}): number => {
  const { selectionCount, option, selectedSingleSite, srtmTiles, isTerrainFetching } = params;
  if (selectionCount === 1) {
    if (option === "auto") {
      if (!selectedSingleSite || isTerrainFetching) return 20;
      return resolveSingleSiteBonusRadiusKm(selectedSingleSite, srtmTiles, { baseRadiusKm: 20, maxRadiusKm: 100 });
    }
    const fixed = Number(option);
    return Number.isFinite(fixed) ? Math.max(20, fixed) : 20;
  }
  const fixed = option === "20" || option === "50" || option === "100" ? Number(option) : 20;
  return fixed;
};

export const resolveTargetOverlayRadiusKm = (
  selectionCount: number,
  option: SimulationOverlayRadiusOption,
): number =>
  selectionCount === 1
    ? option === "auto"
      ? 100
      : Number(option)
    : option === "20" || option === "50" || option === "100"
      ? Number(option)
      : 20;

export const resolveLoadedOverlayRadiusCapKm = (
  sites: Pick<Site, "position">[],
  targetRadiusKm: number,
  srtmTiles: ReadonlyArray<SrtmTile>,
  minimumRadiusKm = 20,
): number => {
  if (!sites.length) return minimumRadiusKm;
  const loaded30m = new Set(srtmTiles.filter((tile) => tile.sourceId === "copernicus30").map((tile) => tile.key));
  if (!loaded30m.size) return minimumRadiusKm;

  const minRadiusKm = Math.max(1, minimumRadiusKm);
  const maxRadiusKm = Math.max(minRadiusKm, Math.round(targetRadiusKm));
  const hasCoverageForRadius = (radiusKm: number): boolean => {
    const bounds = simulationAreaBoundsForSites(sites, { overlayRadiusKm: radiusKm });
    if (!bounds) return false;
    const needed = tilesForBounds(bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon);
    if (!needed.length) return false;
    return needed.every((key) => loaded30m.has(key));
  };

  if (!hasCoverageForRadius(minRadiusKm)) return minRadiusKm;
  let low = minRadiusKm;
  let high = maxRadiusKm;
  while (low < high) {
    const mid = Math.ceil((low + high + 1) / 2);
    if (hasCoverageForRadius(mid)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
};
