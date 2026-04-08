import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAppStoreBridge, useCoverageStore } from "./coverageStore";
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

const bridgeState = {
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
};

describe("coverageStore simulation progress phases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      },
    });
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
    await Promise.resolve();

    expect(useCoverageStore.getState().simulationProgressMode).toBe("determinate");
    expect(useCoverageStore.getState().simulationProgress).toBe(50);
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Sampling simulation grid (7/14)");

    resolveBuild([{ lat: site.position.lat, lon: site.position.lon, valueDbm: -90 }]);
    await Promise.resolve();
    expect(useCoverageStore.getState().simulationProgressMode).toBe("indeterminate");
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Finalizing simulation overlay...");

    vi.advanceTimersByTime(700);
    await Promise.resolve();

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
    await Promise.resolve();
    vi.advanceTimersByTime(700);
    await Promise.resolve();

    expect(capturedGridSize).toBe(24);
  });
});
