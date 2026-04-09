export type SimulationBusyIndicatorInput = {
  isSimulationRecomputing: boolean;
  simulationProgressMode: "determinate" | "indeterminate";
  simulationStepLabel: string;
  simulationProgress: number;
  overlayJobsInFlight: number;
  overlayProgressMode: "determinate" | "indeterminate";
  overlayProgressPercent: number | null;
  isBackgroundBusy: boolean;
  backgroundBusyLabel: string;
  isTerrainFetching: boolean;
  hasTerrainDownloadProgress: boolean;
  terrainProgressPercent: number;
  terrainProgressTilesTotal: number;
};

export type SimulationBusyIndicatorState = {
  label: string;
  progressMode: "determinate" | "indeterminate";
  progressPercent: number | null;
};

export const resolveSimulationBusyIndicatorState = (
  input: SimulationBusyIndicatorInput,
): SimulationBusyIndicatorState | null => {
  if (input.isSimulationRecomputing) {
    if (input.simulationProgressMode === "determinate") {
      return {
        label: `${input.simulationStepLabel || "Sampling simulation grid..."} ${input.simulationProgress}%`,
        progressMode: "determinate",
        progressPercent: input.simulationProgress,
      };
    }
    return {
      label: input.simulationStepLabel || "Recalculating simulation...",
      progressMode: "indeterminate",
      progressPercent: null,
    };
  }

  if (input.overlayJobsInFlight > 0) {
    if (input.overlayProgressMode === "determinate" && typeof input.overlayProgressPercent === "number") {
      return {
        label: `Finalizing simulation overlay... ${input.overlayProgressPercent}%`,
        progressMode: "determinate",
        progressPercent: input.overlayProgressPercent,
      };
    }
    return {
      label: "Finalizing simulation overlay...",
      progressMode: "indeterminate",
      progressPercent: null,
    };
  }

  if (input.isBackgroundBusy && input.backgroundBusyLabel) {
    if (
      input.isTerrainFetching &&
      input.hasTerrainDownloadProgress &&
      input.terrainProgressTilesTotal > 0
    ) {
      return {
        label: input.backgroundBusyLabel,
        progressMode: "determinate",
        progressPercent: input.terrainProgressPercent,
      };
    }
    return {
      label: input.backgroundBusyLabel,
      progressMode: "indeterminate",
      progressPercent: null,
    };
  }

  return null;
};
