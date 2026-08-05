import { simulationAreaBoundsForSites } from "./simulationArea";
import { tilesForBounds } from "./terrainTiles";
import type { Site, SrtmTile } from "../types/radio";

export type SimulationOverlayRadiusOption = "20" | "50" | "100" | "200";

const SHARED_OPTIONS: SimulationOverlayRadiusOption[] = ["20", "50", "100", "200"];

export const optionsForSelectionCount = (selectionCount: number): SimulationOverlayRadiusOption[] =>
  selectionCount >= 0 ? SHARED_OPTIONS : SHARED_OPTIONS;

export const defaultOptionForSelectionCount = (selectionCount: number): SimulationOverlayRadiusOption =>
  selectionCount === 1 ? "50" : "20";

export const normalizeOverlayRadiusOptionForSelectionCount = (
  selectionCount: number,
  option: unknown,
): SimulationOverlayRadiusOption => {
  const candidate = typeof option === "string" ? (option as SimulationOverlayRadiusOption) : null;
  const allowed = optionsForSelectionCount(selectionCount);
  if (candidate && allowed.includes(candidate)) return candidate;
  return defaultOptionForSelectionCount(selectionCount);
};

export const resolveOverlayRadiusOptionForSelectionTransition = (params: {
  previousSelectionCount: number;
  selectionCount: number;
  option: unknown;
}): SimulationOverlayRadiusOption => {
  const normalized = normalizeOverlayRadiusOptionForSelectionCount(params.selectionCount, params.option);
  const previousWasSingle = params.previousSelectionCount === 1;
  const currentIsSingle = params.selectionCount === 1;
  if (previousWasSingle !== currentIsSingle) {
    return defaultOptionForSelectionCount(params.selectionCount);
  }
  return normalized;
};

export const isOverlayRadiusOption = (value: unknown): value is SimulationOverlayRadiusOption =>
  typeof value === "string" &&
  (["20", "50", "100", "200"] as const).includes(value as SimulationOverlayRadiusOption);

export const resolveTargetOverlayRadiusKm = (
  selectionCount: number,
  option: SimulationOverlayRadiusOption,
): number =>
  selectionCount >= 0 && (option === "20" || option === "50" || option === "100" || option === "200")
    ? Number(option)
    : 20;

export const resolveRequiredOverlayTerrainTileKeys = (
  sites: Pick<Site, "position">[],
  targetRadiusKm: number,
): string[] => {
  const bounds = simulationAreaBoundsForSites(sites, { overlayRadiusKm: targetRadiusKm });
  return bounds ? tilesForBounds(bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon) : [];
};

export const resolveMissingOverlayTerrainTileKeys = (
  sites: Pick<Site, "position">[],
  targetRadiusKm: number,
  srtmTiles: ReadonlyArray<SrtmTile>,
): string[] => {
  const loaded30m = new Set(
    srtmTiles.filter((tile) => tile.sourceId === "copernicus30").map((tile) => tile.key),
  );
  return resolveRequiredOverlayTerrainTileKeys(sites, targetRadiusKm).filter(
    (key) => !loaded30m.has(key),
  );
};
