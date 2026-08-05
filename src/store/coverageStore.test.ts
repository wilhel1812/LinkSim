import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveAutomaticCalculationThresholds,
  resetCoverageSchedulerForTests,
  setAppStoreBridge,
  useCoverageStore,
} from "./coverageStore";
import * as coverageLib from "../lib/coverage";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { tilesForBounds } from "../lib/terrainTiles";
import type { CoverageSample, Site, SrtmTile } from "../types/radio";

const site: Site = {
  id: "site-1",
  name: "Alpha",
  position: { lat: 59.91, lon: 10.75 },
  groundElevationM: 100,
  antennaHeightM: 10,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const completeTerrainTiles = (radiusKm = 50): SrtmTile[] => {
  const bounds = simulationAreaBoundsForSites([site], { overlayRadiusKm: radiusKm });
  if (!bounds) return [];
  return tilesForBounds(bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon).map((key) => {
    const match = /^([NS])(\d{2})([EW])(\d{3})$/.exec(key);
    if (!match) throw new Error(`Unexpected tile key: ${key}`);
    const latStart = Number(match[2]) * (match[1] === "S" ? -1 : 1);
    const lonStart = Number(match[4]) * (match[3] === "W" ? -1 : 1);
    return {
      key,
      latStart,
      lonStart,
      size: 2,
      width: 2,
      height: 2,
      arcSecondSpacing: 1 as const,
      elevations: new Int16Array([100, 100, 100, 100]),
      sourceId: "copernicus30",
    };
  });
};

const makeBridgeState = () => ({
  selectedCoverageResolution: "24",
  networks: [{ id: "net-1", memberships: [], frequencyMHz: 869.5 }],
  selectedNetworkId: "net-1",
  sites: [site],
  systems: [],
  propagationModel: "ITM",
  srtmTiles: completeTerrainTiles(),
  links: [],
  selectedLinkId: "",
  autoPropagationEnvironment: false,
  propagationEnvironment: {
    radioClimate: "Continental Temperate",
    polarization: "Vertical",
    clutterHeightM: 10,
    groundDielectric: 15,
    groundConductivity: 0.005,
    atmosphericBendingNUnits: 301,
  },
  propagationEnvironmentReason: "",
  terrainLoadEpoch: 0,
  selectedSiteIds: ["site-1"],
  isTerrainFetching: false,
  selectedOverlayRadiusOption: "50",
  mapOverlayMode: "heatmap",
});

let bridgeState = makeBridgeState();

const flushAsyncTicks = async (count = 8): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
};

describe("coverageStore simulation progress phases", () => {
  beforeEach(() => {
    bridgeState = makeBridgeState();
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useCoverageStore.setState({
      coverageSamples: [],
      isSimulationRecomputing: false,
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
      simulationRunToken: "",
      completedCoverageRunToken: "",
      autoCalculateEnabled: true,
      calculationCycleSource: null,
      simulationErrorMessage: "",
    });
    resetCoverageSchedulerForTests();
    setAppStoreBridge({
      getState: () => bridgeState as unknown as Record<string, unknown>,
      setState: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses indeterminate prep/finalizing phases and determinate sampling percent", async () => {
    let resolveBuild!: (value: CoverageSample[]) => void;
    vi.spyOn(coverageLib, "buildCoverageAsync").mockImplementation((...args) => {
      const options = args[6];
      options?.onProgress?.(0.5);
      return new Promise<CoverageSample[]>((resolve) => {
        resolveBuild = resolve;
      });
    });

    useCoverageStore.getState().recomputeCoverage();
    expect(useCoverageStore.getState().simulationProgressMode).toBe("indeterminate");
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Preparing simulation bounds...");

    vi.advanceTimersByTime(180);
    await flushAsyncTicks();

    expect(useCoverageStore.getState().simulationProgressMode).toBe("determinate");
    expect(useCoverageStore.getState().simulationProgress).toBe(50);
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Sampling simulation grid...");

    resolveBuild([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -90 }]);
    await flushAsyncTicks();
    expect(useCoverageStore.getState().simulationProgressMode).toBe("indeterminate");
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Finalizing simulation overlay...");

    vi.advanceTimersByTime(700);
    await flushAsyncTicks();

    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
    expect(useCoverageStore.getState().coverageSamples).toHaveLength(1);
  });

  it("suppresses automatic recomputes while Auto calculate is off", () => {
    useCoverageStore.getState().setAutoCalculateEnabled(false);
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);

    expect(useCoverageStore.getState().autoCalculateEnabled).toBe(false);
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
  });

  it("runs once manually without enabling Auto calculate", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);
    useCoverageStore.getState().setAutoCalculateEnabled(false);
    useCoverageStore.getState().startManualCalculation();

    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    vi.advanceTimersByTime(700);
    await flushAsyncTicks();

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(useCoverageStore.getState().autoCalculateEnabled).toBe(false);
    expect(useCoverageStore.getState().calculationCycleSource).toBe("manual");
    expect(buildSpy.mock.calls[0]?.[6]).toEqual(expect.objectContaining({ overlayRadiusKm: 50 }));
  });

  it("skips the generic coverage grid for direct-analysis overlay modes", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);
    bridgeState.mapOverlayMode = "passfail";
    useCoverageStore.setState({
      coverageSamples: [{ lat: site.position.lat, lon: site.position.lon, valueDbm: -88 }],
    });

    useCoverageStore.getState().startManualCalculation();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
    expect(useCoverageStore.getState().completedCoverageRunToken).not.toBe("");
    expect(useCoverageStore.getState().coverageSamples[0]?.valueDbm).toBe(-88);
  });

  it("does not calculate or retain results when required terrain tiles remain unavailable", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);
    bridgeState.srtmTiles = completeTerrainTiles().slice(0, 1);
    useCoverageStore.setState({
      coverageSamples: [{ lat: site.position.lat, lon: site.position.lon, valueDbm: -80 }],
    });

    useCoverageStore.getState().startManualCalculation();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().coverageSamples).toEqual([]);
    expect(useCoverageStore.getState().simulationErrorMessage).toContain("50 km");
    expect(useCoverageStore.getState().simulationErrorMessage).toContain("terrain");
  });

  it("accepts zero-elevation Copernicus ocean cells as complete 100 km terrain", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);
    const terrainTiles = completeTerrainTiles(100);
    terrainTiles[0] = {
      ...terrainTiles[0],
      elevations: new Int16Array([0, 0, 0, 0]),
      sourceLabel: "Copernicus GLO-30 sea level",
      sourceDetail: "Catalog-confirmed ocean cell",
    };
    bridgeState.selectedOverlayRadiusOption = "100";
    bridgeState.srtmTiles = terrainTiles;

    useCoverageStore.getState().startManualCalculation();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(useCoverageStore.getState().simulationErrorMessage).toBe("");
  });

  it("identifies the independent 100 km+ and 4x+ automatic opt-out thresholds", () => {
    expect(resolveAutomaticCalculationThresholds("24", "50")).toEqual({
      highResolution: false,
      largeRadius: false,
    });
    expect(resolveAutomaticCalculationThresholds("24", "100")).toEqual({
      highResolution: false,
      largeRadius: true,
    });
    expect(resolveAutomaticCalculationThresholds("84", "20")).toEqual({
      highResolution: true,
      largeRadius: false,
    });
  });

  it("allows the user to enable automatic calculation at an expensive setting", () => {
    bridgeState.selectedCoverageResolution = "84";
    useCoverageStore.getState().setAutoCalculateEnabled(false);
    useCoverageStore.getState().setAutoCalculateEnabled(true);

    expect(useCoverageStore.getState().autoCalculateEnabled).toBe(true);
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(true);
    expect(useCoverageStore.getState().calculationCycleSource).toBe("auto");
  });

  it("stops active coverage work and clears queued reruns", async () => {
    let observedCancellation = false;
    vi.spyOn(coverageLib, "buildCoverageAsync").mockImplementation((...args) => {
      const options = args[6];
      return new Promise<CoverageSample[]>((resolve) => {
        window.setTimeout(() => {
          observedCancellation = options?.shouldCancel?.() ?? false;
          resolve([]);
        }, 20);
      });
    });

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    useCoverageStore.getState().stopCalculation();
    vi.advanceTimersByTime(30);
    await flushAsyncTicks();

    expect(observedCancellation).toBe(true);
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
    expect(useCoverageStore.getState().calculationCycleSource).toBe(null);
  });

  it("defers coverage work until terrain loading has settled", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);
    bridgeState.isTerrainFetching = true;

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);

    bridgeState.isTerrainFetching = false;
    bridgeState.terrainLoadEpoch += 1;
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    vi.advanceTimersByTime(700);
    await flushAsyncTicks();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a manual Start waiting without committing coverage while terrain loads", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);
    bridgeState.isTerrainFetching = true;
    useCoverageStore.setState({ coverageSamples: [] });

    useCoverageStore.getState().startManualCalculation();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().coverageSamples).toEqual([]);
    expect(useCoverageStore.getState().calculationCycleSource).toBe("manual");

    bridgeState.isTerrainFetching = false;
    bridgeState.terrainLoadEpoch += 1;
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    vi.advanceTimersByTime(700);
    await flushAsyncTicks();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("runs as single-flight with one queued rerun under rapid triggers", async () => {
    let resolveFirst!: (value: CoverageSample[]) => void;
    let resolveSecond!: (value: CoverageSample[]) => void;
    const runResolvers: Array<(value: CoverageSample[]) => void> = [];
    vi.spyOn(coverageLib, "buildCoverageAsync").mockImplementation(() => {
      return new Promise<CoverageSample[]>((resolve) => {
        runResolvers.push(resolve);
        if (runResolvers.length === 1) resolveFirst = resolve;
        if (runResolvers.length === 2) resolveSecond = resolve;
      });
    });

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    expect(runResolvers).toHaveLength(1);

    bridgeState.selectedCoverageResolution = "42";
    useCoverageStore.getState().recomputeCoverage();
    useCoverageStore.getState().recomputeCoverage();
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(runResolvers).toHaveLength(1);

    resolveFirst([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -95 }]);
    await flushAsyncTicks();
    vi.advanceTimersByTime(40);
    await flushAsyncTicks();
    expect(runResolvers).toHaveLength(2);

    resolveSecond([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -82 }]);
    await flushAsyncTicks();
    vi.advanceTimersByTime(760);
    await flushAsyncTicks();
    expect(useCoverageStore.getState().coverageSamples[0]?.valueDbm).toBe(-82);
  });

  it("skips recompute when effective simulation inputs are unchanged", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    vi.advanceTimersByTime(760);
    await flushAsyncTicks();
    expect(buildSpy).toHaveBeenCalledTimes(1);

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    vi.advanceTimersByTime(760);
    await flushAsyncTicks();
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("does not commit stale run results when a rerun is queued", async () => {
    const runResolvers: Array<(value: CoverageSample[]) => void> = [];
    vi.spyOn(coverageLib, "buildCoverageAsync").mockImplementation(() => {
      return new Promise<CoverageSample[]>((resolve) => {
        runResolvers.push(resolve);
      });
    });

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    expect(runResolvers).toHaveLength(1);

    bridgeState.selectedCoverageResolution = "42";
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    runResolvers[0]([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -110 }]);
    await flushAsyncTicks();
    vi.advanceTimersByTime(60);
    await flushAsyncTicks();
    expect(useCoverageStore.getState().coverageSamples).toEqual([]);

    vi.advanceTimersByTime(80);
    await flushAsyncTicks();
    expect(runResolvers).toHaveLength(2);

    runResolvers[1]([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -70 }]);
    await flushAsyncTicks();
    vi.advanceTimersByTime(760);
    await flushAsyncTicks();
    expect(useCoverageStore.getState().coverageSamples[0]?.valueDbm).toBe(-70);
  });

  it("discards a stale result without scheduling a rerun while automatic calculation is off", async () => {
    let resolveBuild!: (value: CoverageSample[]) => void;
    vi.spyOn(coverageLib, "buildCoverageAsync").mockImplementation(
      () => new Promise<CoverageSample[]>((resolve) => { resolveBuild = resolve; }),
    );

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    useCoverageStore.getState().setAutoCalculateEnabled(false);
    bridgeState.selectedCoverageResolution = "42";
    useCoverageStore.getState().recomputeCoverage();
    resolveBuild([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -60 }]);
    await flushAsyncTicks();

    expect(useCoverageStore.getState().coverageSamples).toEqual([]);
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
  });
});
