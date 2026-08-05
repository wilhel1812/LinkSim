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
import type { Site, SrtmTile } from "../types/radio";

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

  it("hands every area overlay to the canonical raster pipeline", async () => {
    const buildSpy = vi.spyOn(coverageLib, "buildCoverageAsync").mockResolvedValue([]);

    useCoverageStore.getState().recomputeCoverage();
    expect(useCoverageStore.getState().simulationProgressMode).toBe("indeterminate");
    expect(useCoverageStore.getState().simulationStepLabel).toBe("Preparing simulation bounds...");

    vi.advanceTimersByTime(180);
    await flushAsyncTicks();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
    expect(useCoverageStore.getState().completedCoverageRunToken).not.toBe("");
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

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().autoCalculateEnabled).toBe(false);
    expect(useCoverageStore.getState().calculationCycleSource).toBe("manual");
  });

  it("clears legacy coverage samples when handing off to the canonical raster", async () => {
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
    expect(useCoverageStore.getState().coverageSamples).toEqual([]);
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

    expect(buildSpy).not.toHaveBeenCalled();
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

  it("stops a queued canonical-overlay run", async () => {
    useCoverageStore.getState().recomputeCoverage();
    useCoverageStore.getState().stopCalculation();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
    expect(useCoverageStore.getState().simulationRunToken).toBe("");
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

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().completedCoverageRunToken).not.toBe("");
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

    expect(buildSpy).not.toHaveBeenCalled();
    expect(useCoverageStore.getState().completedCoverageRunToken).not.toBe("");
  });

  it("coalesces rapid triggers into one canonical-overlay handoff", async () => {
    useCoverageStore.getState().recomputeCoverage();
    useCoverageStore.getState().recomputeCoverage();
    useCoverageStore.getState().recomputeCoverage();
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();

    expect(useCoverageStore.getState().completedCoverageRunToken).not.toBe("");
    expect(useCoverageStore.getState().isSimulationRecomputing).toBe(false);
  });

  it("skips recompute when effective simulation inputs are unchanged", async () => {
    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    const completedToken = useCoverageStore.getState().completedCoverageRunToken;

    useCoverageStore.getState().recomputeCoverage();
    vi.advanceTimersByTime(220);
    await flushAsyncTicks();
    expect(useCoverageStore.getState().completedCoverageRunToken).toBe(completedToken);
  });
});
