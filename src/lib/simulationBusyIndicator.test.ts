import { describe, expect, it } from "vitest";
import { resolveSimulationBusyIndicatorState } from "./simulationBusyIndicator";

describe("resolveSimulationBusyIndicatorState", () => {
  it("prioritizes active simulation recompute over overlay/background work", () => {
    const state = resolveSimulationBusyIndicatorState({
      isSimulationRecomputing: true,
      simulationProgressMode: "determinate",
      simulationStepLabel: "Sampling simulation grid (120/240)",
      simulationProgress: 50,
      overlayJobsInFlight: 2,
      overlayProgressMode: "indeterminate",
      overlayProgressPercent: null,
      isBackgroundBusy: true,
      backgroundBusyLabel: "Loading terrain 60%",
      isTerrainFetching: true,
      hasTerrainDownloadProgress: true,
      terrainProgressPercent: 60,
      terrainProgressTilesTotal: 100,
    });

    expect(state).toEqual({
      label: "Sampling simulation grid (120/240) 50%",
      progressMode: "determinate",
      progressPercent: 50,
    });
  });

  it("shows overlay-only in-flight work using the existing indeterminate simulation style", () => {
    const state = resolveSimulationBusyIndicatorState({
      isSimulationRecomputing: false,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationProgress: 0,
      overlayJobsInFlight: 1,
      overlayProgressMode: "indeterminate",
      overlayProgressPercent: null,
      isBackgroundBusy: false,
      backgroundBusyLabel: "",
      isTerrainFetching: false,
      hasTerrainDownloadProgress: false,
      terrainProgressPercent: 0,
      terrainProgressTilesTotal: 0,
    });

    expect(state).toEqual({
      label: "Finalizing simulation overlay...",
      progressMode: "indeterminate",
      progressPercent: null,
    });
  });

  it("shows determinate overlay progress when provided", () => {
    const state = resolveSimulationBusyIndicatorState({
      isSimulationRecomputing: false,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationProgress: 0,
      overlayJobsInFlight: 1,
      overlayProgressMode: "determinate",
      overlayProgressPercent: 64,
      isBackgroundBusy: false,
      backgroundBusyLabel: "",
      isTerrainFetching: false,
      hasTerrainDownloadProgress: false,
      terrainProgressPercent: 0,
      terrainProgressTilesTotal: 0,
    });

    expect(state).toEqual({
      label: "Finalizing simulation overlay... 64%",
      progressMode: "determinate",
      progressPercent: 64,
    });
  });

  it("retains terrain determinate progress behavior when background fetch is active", () => {
    const state = resolveSimulationBusyIndicatorState({
      isSimulationRecomputing: false,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationProgress: 0,
      overlayJobsInFlight: 0,
      overlayProgressMode: "indeterminate",
      overlayProgressPercent: null,
      isBackgroundBusy: true,
      backgroundBusyLabel: "Loading terrain 40%",
      isTerrainFetching: true,
      hasTerrainDownloadProgress: true,
      terrainProgressPercent: 40,
      terrainProgressTilesTotal: 200,
    });

    expect(state).toEqual({
      label: "Loading terrain 40%",
      progressMode: "determinate",
      progressPercent: 40,
    });
  });

  it("returns null when there is no active simulation/overlay/background work", () => {
    const state = resolveSimulationBusyIndicatorState({
      isSimulationRecomputing: false,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationProgress: 0,
      overlayJobsInFlight: 0,
      overlayProgressMode: "indeterminate",
      overlayProgressPercent: null,
      isBackgroundBusy: false,
      backgroundBusyLabel: "",
      isTerrainFetching: false,
      hasTerrainDownloadProgress: false,
      terrainProgressPercent: 0,
      terrainProgressTilesTotal: 0,
    });

    expect(state).toBeNull();
  });
});
