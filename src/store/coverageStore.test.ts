import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoverageSchedulerForTests, setAppStoreBridge, useCoverageStore } from "./coverageStore";
import * as coverageLib from "../lib/coverage";
import type { CoverageSample, Site } from "../types/radio";

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

const makeBridgeState = () => ({
  selectedCoverageResolution: "24",
  networks: [{ id: "net-1", memberships: [], frequencyMHz: 869.5 }],
  selectedNetworkId: "net-1",
  sites: [site],
  systems: [],
  propagationModel: "ITM",
  srtmTiles: [],
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
      options?.onSampleProgress?.(7, 14);
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
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Sampling simulation grid (7/14)");

    resolveBuild([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -90 }]);
    await flushAsyncTicks();
    expect(useCoverageStore.getState().simulationProgressMode).toBe("indeterminate");
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Finalizing simulation overlay...");

    vi.advanceTimersByTime(700);
    await flushAsyncTicks();

    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
    expect(useCoverageStore.getState().coverageSamples).toHaveLength(1);
  });

  it("forces 1x simulation resolution while terrain is fetching", async () => {
    let capturedGridSize = 0;
    setAppStoreBridge({
      getState: () =>
        ({
          ...bridgeState,
          selectedCoverageResolution: "168",
          isTerrainFetching: true,
        }) as unknown as Record<string, unknown>,
      setState: vi.fn(),
    });
    vi.spyOn(coverageLib, "buildCoverageAsync").mockImplementation((gridSize) => {
      capturedGridSize = Number(gridSize);
      return Promise.resolve([]);
    });

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    vi.advanceTimersByTime(700);
    await flushAsyncTicks();

    expect(capturedGridSize).toBe(24);
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
});
