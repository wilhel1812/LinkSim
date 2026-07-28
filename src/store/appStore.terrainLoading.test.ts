import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const mock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", mock);
  vi.stubGlobal("window", { localStorage: mock, setTimeout, clearTimeout });
  return mock;
});

const terrainClient = vi.hoisted(() => ({
  loadCopernicus30TilesByKeys: vi.fn(),
  clearCopernicusCache: vi.fn(async () => undefined),
}));

vi.mock("../lib/copernicusTerrainClient", () => terrainClient);
vi.mock("../lib/coverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/coverage")>();
  return { ...actual, buildCoverage: vi.fn(() => []), clearTerrainLossCache: vi.fn() };
});
vi.mock("../lib/elevationService", () => ({ fetchElevations: vi.fn(async () => [123]) }));

import { useCoverageStore } from "./coverageStore";
import { useAppStore } from "./appStore";
import type { SrtmTile } from "../types/radio";

const tile = (key: string): SrtmTile => ({
  key,
  latStart: 60,
  lonStart: 9,
  size: 2,
  width: 2,
  height: 2,
  arcSecondSpacing: 1,
  elevations: new Int16Array([1, 2, 3, 4]),
  sourceKind: "auto-fetch",
  sourceId: "copernicus30",
  sourceLabel: "Copernicus GLO-30",
  sourceDetail: key,
});

describe("appStore GLO-30 terrain lifecycle", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    useAppStore.setState({
      sites: [
        {
          id: "site-1",
          name: "Alpha",
          position: { lat: 60.1, lon: 9.1 },
          groundElevationM: 100,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
      srtmTiles: [tile("N59E008")],
      isTerrainFetching: false,
      isTerrainRecommending: false,
      terrainLoadEpoch: 0,
    });
  });

  it("loads only missing keys with concurrency two and recomputes once", async () => {
    terrainClient.loadCopernicus30TilesByKeys.mockResolvedValue({
      tiles: [tile("N59E009")],
      failedTiles: [],
      fetchedTiles: ["N59E009"],
      cacheHits: [],
    });
    const recompute = vi.spyOn(useCoverageStore.getState(), "recomputeCoverage").mockImplementation(() => {
      expect(useAppStore.getState().isTerrainFetching).toBe(false);
      expect(useAppStore.getState().srtmTiles.some((entry) => entry.key === "N59E009")).toBe(true);
    });

    await useAppStore.getState().recommendAndFetchTerrainForCurrentArea(20);

    expect(terrainClient.loadCopernicus30TilesByKeys).toHaveBeenCalledWith(
      expect.not.arrayContaining(["N59E008"]),
      expect.objectContaining({ concurrency: 2, signal: expect.any(AbortSignal) }),
    );
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().terrainProgressPercent).toBe(100);
  });

  it("recomputes once after an all-unavailable load has settled", async () => {
    terrainClient.loadCopernicus30TilesByKeys.mockResolvedValue({
      tiles: [],
      failedTiles: ["N59E009"],
      fetchedTiles: [],
      cacheHits: [],
    });
    const recompute = vi.spyOn(useCoverageStore.getState(), "recomputeCoverage").mockImplementation(() => {
      expect(useAppStore.getState().isTerrainFetching).toBe(false);
    });

    await useAppStore.getState().recommendAndFetchTerrainForCurrentArea(20);

    expect(recompute).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().terrainFetchStatus).toContain("1 unavailable");
  });

  it("cancels the active load and ignores its late result", async () => {
    let resolveLoad!: (value: {
      tiles: SrtmTile[];
      failedTiles: string[];
      fetchedTiles: string[];
      cacheHits: string[];
    }) => void;
    terrainClient.loadCopernicus30TilesByKeys.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const loading = useAppStore.getState().recommendAndFetchTerrainForCurrentArea(20);
    useAppStore.getState().cancelTerrainLoad();
    resolveLoad({
      tiles: [tile("N59E009")],
      failedTiles: [],
      fetchedTiles: ["N59E009"],
      cacheHits: [],
    });
    await loading;

    expect(useAppStore.getState().isTerrainFetching).toBe(false);
    expect(useAppStore.getState().terrainFetchStatus).toBe("Terrain loading stopped.");
    expect(useAppStore.getState().srtmTiles.some((entry) => entry.key === "N59E009")).toBe(false);
  });
});
