import { create } from "zustand";
import {
  computeCalibratedOverlayGridDimensions,
  resolveCanonicalOverlayResolutionScale,
  type CalibratedOverlayGridMode,
} from "../lib/coverage";
import { resolveSimulationSitesForSelection, simulationAreaBoundsForSites } from "../lib/simulationArea";
import {
  deriveDynamicPropagationEnvironment,
} from "../lib/propagationEnvironment";
import {
  normalizeOverlayRadiusOptionForSelectionCount,
  resolveMissingOverlayTerrainTileKeys,
  resolveTargetOverlayRadiusKm,
} from "../lib/simulationOverlayRadius";
import {
  recordSimulationRunCancelled,
} from "../lib/simulationPerf";
import { sampleSrtmElevation } from "../lib/srtm";
import type { CoverageSample, Network, RadioSystem, Site, SrtmTile } from "../types/radio";

const COVERAGE_RECOMPUTE_DEBOUNCE_MS = 140;
const COVERAGE_MIN_VISIBLE_MS = 600;
const COVERAGE_LONG_TASK_WARN_MS = 160;

let coverageRecomputeTimer: number | null = null;
let coverageRunInFlight = false;
let coverageRerunQueued = false;
let coverageRunCounter = 0;
let lastAppliedCoverageSignature = "";

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const inDevDiagnostics =
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

const warnLongTask = (phase: string, signature: string, durationMs: number): void => {
  if (!inDevDiagnostics) return;
  if (!Number.isFinite(durationMs) || durationMs < COVERAGE_LONG_TASK_WARN_MS) return;
  console.warn("[simulation-long-task]", {
    scope: "coverage",
    phase,
    signature,
    durationMs: Math.round(durationMs * 100) / 100,
  });
};

type AppStoreBridge = {
  getState: () => Record<string, unknown>;
  setState: (patch: Record<string, unknown>) => void;
};

let appStoreBridge: AppStoreBridge | null = null;

export function setAppStoreBridge(bridge: AppStoreBridge): void {
  appStoreBridge = bridge;
}

export function resetCoverageSchedulerForTests(): void {
  if (coverageRecomputeTimer !== null) {
    window.clearTimeout(coverageRecomputeTimer);
    coverageRecomputeTimer = null;
  }
  coverageRunInFlight = false;
  coverageRerunQueued = false;
  coverageRunCounter = 0;
  lastAppliedCoverageSignature = "";
}

export type CoverageState = {
  coverageSamples: CoverageSample[];
  isSimulationRecomputing: boolean;
  simulationProgress: number;
  simulationProgressMode: "determinate" | "indeterminate";
  simulationStepLabel: string;
  simulationSamplesDone: number;
  simulationSamplesTotal: number;
  simulationRunToken: string;
  completedCoverageRunToken: string;
  autoCalculateEnabled: boolean;
  automaticOptOutNoticeShown: boolean;
  calculationCycleSource: "auto" | "manual" | null;
  simulationErrorMessage: string;
  recomputeCoverage: () => void;
  markAutomaticOptOutNoticeShown: () => void;
  setAutoCalculateEnabled: (enabled: boolean) => void;
  startManualCalculation: () => void;
  stopCalculation: () => void;
  finishCalculationCycle: () => void;
};

export const resolveAutomaticCalculationThresholds = (
  resolution: unknown,
  radiusOption: unknown,
): { highResolution: boolean; largeRadius: boolean } => {
  const gridSize = Number(resolution);
  const radiusKm = Number(radiusOption);
  return {
    highResolution: Number.isFinite(gridSize) && gridSize >= 84,
    largeRadius: Number.isFinite(radiusKm) && radiusKm >= 100,
  };
};

type LinkLike = {
  id: string;
  fromSiteId: string;
  toSiteId: string;
  [key: string]: unknown;
};

type CoverageInputs = {
  selectedCoverageResolution: "24" | "42" | "84" | "168";
  effectiveCoverageResolution: "24" | "42" | "84" | "168";
  networks: Network[];
  selectedNetworkId: string;
  sites: Site[];
  systems: RadioSystem[];
  propagationModel: string;
  srtmTiles: SrtmTile[];
  links: LinkLike[];
  selectedLinkId: string;
  autoPropagationEnvironment: boolean;
  propagationEnvironment: Record<string, unknown>;
  propagationEnvironmentReason: string;
  terrainLoadEpoch: number;
  selectedSiteIds: string[];
  isTerrainFetching: boolean;
  selectedOverlayRadiusOptionRaw: unknown;
  mapOverlayMode: string;
};

const normalizeCoverageResolution = (raw: unknown): "24" | "42" | "84" | "168" => {
  if (raw === "24" || raw === "42" || raw === "84" || raw === "168") return raw;
  if (raw === "high") return "42";
  return "24";
};

const normalizeCalibratedOverlayGridMode = (raw: string): CalibratedOverlayGridMode =>
  raw === "heatmap" ||
  raw === "weakest" ||
  raw === "contours" ||
  raw === "passfail" ||
  raw === "relay" ||
  raw === "mesh-extension"
    ? raw
    : "passfail";

const readCoverageInputs = (appState: Record<string, unknown>): CoverageInputs => {
  const selectedCoverageResolution = normalizeCoverageResolution(appState.selectedCoverageResolution);
  const isTerrainFetching = Boolean(appState.isTerrainFetching);
  const effectiveCoverageResolution = isTerrainFetching ? "24" : selectedCoverageResolution;
  return {
    selectedCoverageResolution,
    effectiveCoverageResolution,
    networks: (appState.networks as Network[]) ?? [],
    selectedNetworkId: (appState.selectedNetworkId as string) ?? "",
    sites: (appState.sites as Site[]) ?? [],
    systems: (appState.systems as RadioSystem[]) ?? [],
    propagationModel: (appState.propagationModel as string) ?? "",
    srtmTiles: (appState.srtmTiles as SrtmTile[]) ?? [],
    links: (appState.links as LinkLike[]) ?? [],
    selectedLinkId: (appState.selectedLinkId as string) ?? "",
    autoPropagationEnvironment: Boolean(appState.autoPropagationEnvironment),
    propagationEnvironment: (appState.propagationEnvironment as Record<string, unknown>) ?? {},
    propagationEnvironmentReason: (appState.propagationEnvironmentReason as string) ?? "",
    terrainLoadEpoch: Number(appState.terrainLoadEpoch ?? 0),
    selectedSiteIds: ((appState.selectedSiteIds as string[]) ?? []).filter((id) => typeof id === "string"),
    isTerrainFetching,
    selectedOverlayRadiusOptionRaw: appState.selectedOverlayRadiusOption,
    mapOverlayMode: String(appState.mapOverlayMode ?? "heatmap"),
  };
};

const siteSignature = (site: Site): string =>
  [
    site.id,
    site.position.lat.toFixed(6),
    site.position.lon.toFixed(6),
    site.groundElevationM,
    site.antennaHeightM,
    site.txPowerDbm,
    site.txGainDbi,
    site.rxGainDbi,
    site.cableLossDb,
  ].join(":");

const linkSignature = (link: LinkLike): string => [link.id, link.fromSiteId, link.toSiteId].join(":");

const networkSignature = (network: Network): string => {
  const memberships = (network.memberships ?? [])
    .map((member) => `${member.siteId}>${member.systemId}`)
    .sort()
    .join(",");
  return [
    network.id,
    Number(network.frequencyMHz ?? 0).toFixed(3),
    Number(network.frequencyOverrideMHz ?? 0).toFixed(3),
    memberships,
  ].join(":");
};

const environmentSignature = (environment: Record<string, unknown>): string =>
  [
    environment.clutterHeightM,
    environment.polarization,
    environment.groundDielectric,
    environment.groundConductivity,
    environment.radioClimate,
    environment.atmosphericBendingNUnits,
  ]
    .map((value) => (value ?? ""))
    .join(":");

const coverageInputSignature = (inputs: CoverageInputs): string => {
  const selectedNetwork = inputs.networks.find((network) => network.id === inputs.selectedNetworkId);
  const selectedLink = inputs.links.find((link) => link.id === inputs.selectedLinkId) ?? inputs.links[0] ?? null;
  return [
    `res=${inputs.effectiveCoverageResolution}`,
    `resRaw=${inputs.selectedCoverageResolution}`,
    `network=${selectedNetwork ? networkSignature(selectedNetwork) : "none"}`,
    `systems=${inputs.systems.length}`,
    `sites=${inputs.sites.map(siteSignature).sort().join(";")}`,
    `links=${inputs.links.map(linkSignature).sort().join(";")}`,
    `selectedLink=${selectedLink ? linkSignature(selectedLink) : "none"}`,
    `propModel=${inputs.propagationModel}`,
    `autoEnv=${inputs.autoPropagationEnvironment ? 1 : 0}`,
    `env=${environmentSignature(inputs.propagationEnvironment)}`,
    `envReason=${inputs.propagationEnvironmentReason}`,
    `terrainEpoch=${inputs.terrainLoadEpoch}`,
    `terrainTiles=${inputs.srtmTiles.length}`,
    `selectedSites=${inputs.selectedSiteIds.join(",")}`,
    `terrainFetching=${inputs.isTerrainFetching ? 1 : 0}`,
    `overlayRadius=${String(inputs.selectedOverlayRadiusOptionRaw ?? "")}`,
    `overlayMode=${inputs.mapOverlayMode}`,
  ].join("|");
};

const delayMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });

const waitForNextPaint = async (): Promise<void> => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return;
  }
  await delayMs(0);
};

const initializeRunState = (set: (patch: Partial<CoverageState>) => void, runId: string): void => {
  set({
    simulationRunToken: runId,
    isSimulationRecomputing: true,
    simulationProgress: 0,
    simulationProgressMode: "indeterminate",
    simulationStepLabel: "Preparing simulation bounds...",
    simulationSamplesDone: 0,
    simulationSamplesTotal: 0,
  });
};

const queueCoverageRunFlush = (delay = COVERAGE_RECOMPUTE_DEBOUNCE_MS): void => {
  if (coverageRecomputeTimer !== null) {
    window.clearTimeout(coverageRecomputeTimer);
    coverageRecomputeTimer = null;
  }
  coverageRecomputeTimer = window.setTimeout(() => {
    coverageRecomputeTimer = null;
    void flushCoverageRunQueue();
  }, Math.max(0, delay));
};

const finalizeRunComplete = (
  set: (patch: Partial<CoverageState>) => void,
  get: () => CoverageState,
  runId: string,
  coverageSamples: CoverageSample[],
): void => {
  if (get().simulationRunToken !== runId) return;
  set({
    coverageSamples,
    isSimulationRecomputing: false,
    simulationProgress: 100,
    simulationProgressMode: "determinate",
    simulationStepLabel: "",
    simulationSamplesDone: 0,
    simulationSamplesTotal: 0,
    completedCoverageRunToken: runId,
  });
  window.setTimeout(() => {
    if (get().simulationRunToken === runId) {
      set({ simulationProgress: 0, simulationRunToken: "" });
    }
  }, 320);
};

const runCoverageComputation = async (
  set: (patch: Partial<CoverageState>) => void,
  get: () => CoverageState,
  runId: string,
  runSignature: string,
  inputs: CoverageInputs,
): Promise<void> => {
  const startedAt = nowMs();
  let loggedCancellation = false;

  const markCancelled = (reason: string): void => {
    if (loggedCancellation) return;
    loggedCancellation = true;
    recordSimulationRunCancelled({
      runId,
      phase: "coverage",
      reason,
      signature: runSignature,
    });
  };

  try {
    await waitForNextPaint();
    if (get().simulationRunToken !== runId) {
      markCancelled("token-mismatch-before-start");
      return;
    }

    const gridSize = Number(inputs.effectiveCoverageResolution);
    const network = inputs.networks.find((n) => n.id === inputs.selectedNetworkId);
    if (!network) {
      const waitMs = Math.max(0, COVERAGE_MIN_VISIBLE_MS - (nowMs() - startedAt));
      if (waitMs > 0) await delayMs(waitMs);
      if (get().simulationRunToken !== runId) {
        markCancelled("token-mismatch-no-network");
        return;
      }
      finalizeRunComplete(set, get, runId, []);
      lastAppliedCoverageSignature = runSignature;
      return;
    }

    const selectedLink = inputs.links.find((link) => link.id === inputs.selectedLinkId) ?? inputs.links[0] ?? null;
    const fromSite = selectedLink ? inputs.sites.find((site) => site.id === selectedLink.fromSiteId) ?? null : null;
    const toSite = selectedLink ? inputs.sites.find((site) => site.id === selectedLink.toSiteId) ?? null : null;
    const autoEnvironmentStartedAt = nowMs();
    const autoDerived =
      inputs.autoPropagationEnvironment && fromSite && toSite
        ? deriveDynamicPropagationEnvironment({
            from: fromSite.position as { lat: number; lon: number },
            to: toSite.position as { lat: number; lon: number },
            fromGroundM: fromSite.groundElevationM as number,
            toGroundM: toSite.groundElevationM as number,
            terrainSampler: ({ lat, lon }: { lat: number; lon: number }) =>
              sampleSrtmElevation(inputs.srtmTiles, lat, lon),
          })
        : null;
    warnLongTask("auto-propagation-environment", runSignature, nowMs() - autoEnvironmentStartedAt);

    if (autoDerived) {
      if (
        inputs.propagationEnvironmentReason !== autoDerived.reason ||
        inputs.propagationEnvironment.clutterHeightM !== autoDerived.environment.clutterHeightM ||
        inputs.propagationEnvironment.polarization !== autoDerived.environment.polarization ||
        inputs.propagationEnvironment.groundDielectric !== autoDerived.environment.groundDielectric ||
        inputs.propagationEnvironment.groundConductivity !== autoDerived.environment.groundConductivity ||
        inputs.propagationEnvironment.radioClimate !== autoDerived.environment.radioClimate ||
        inputs.propagationEnvironment.atmosphericBendingNUnits !== autoDerived.environment.atmosphericBendingNUnits
      ) {
        appStoreBridge?.setState({
          propagationEnvironment: autoDerived.environment,
          propagationEnvironmentReason: autoDerived.reason,
        });
      }
    }

    const selectionCount = inputs.selectedSiteIds.length;
    const selectedOverlayRadiusOption = normalizeOverlayRadiusOptionForSelectionCount(
      selectionCount,
      inputs.selectedOverlayRadiusOptionRaw,
    );
    const targetRadiusKm = resolveTargetOverlayRadiusKm(selectionCount, selectedOverlayRadiusOption);
    const effectiveOverlayRadiusKm = targetRadiusKm;

    const countSites = resolveSimulationSitesForSelection(inputs.sites, inputs.selectedSiteIds);
    const boundsForCount = simulationAreaBoundsForSites(countSites, { overlayRadiusKm: effectiveOverlayRadiusKm });
    const calibratedMode = normalizeCalibratedOverlayGridMode(inputs.mapOverlayMode);
    const sampleCount = boundsForCount
      ? computeCalibratedOverlayGridDimensions(
          gridSize,
          boundsForCount,
          calibratedMode,
          resolveCanonicalOverlayResolutionScale(boundsForCount),
        ).totalSamples
      : 0;
    set({
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "Preparing Simulation overlay...",
      simulationSamplesDone: 0,
      simulationSamplesTotal: sampleCount,
    });
    if (get().simulationRunToken !== runId) {
      markCancelled("token-mismatch-before-mode-finalize");
      return;
    }
    finalizeRunComplete(set, get, runId, []);
    lastAppliedCoverageSignature = runSignature;
  } catch (error) {
    console.error("Coverage recompute failed", error);
    if (get().simulationRunToken === runId) {
      set({
        isSimulationRecomputing: false,
        simulationProgress: 0,
        simulationProgressMode: "indeterminate",
        simulationStepLabel: "",
        simulationSamplesDone: 0,
        simulationSamplesTotal: 0,
      });
    }
  } finally {
    coverageRunInFlight = false;
    if (coverageRerunQueued) {
      queueCoverageRunFlush(0);
    }
  }
};

const flushCoverageRunQueue = async (): Promise<void> => {
  if (!appStoreBridge) return;
  if (coverageRunInFlight) return;
  if (!coverageRerunQueued) return;

  const appState = appStoreBridge.getState();
  const inputs = readCoverageInputs(appState);
  if (inputs.isTerrainFetching) {
    coverageRerunQueued = false;
    useCoverageStore.setState({
      isSimulationRecomputing: false,
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
      simulationRunToken: "",
    });
    return;
  }
  const selectionCount = inputs.selectedSiteIds.length;
  const selectedTerrainSites = resolveSimulationSitesForSelection(inputs.sites, inputs.selectedSiteIds);
  const selectedOverlayRadiusOption = normalizeOverlayRadiusOptionForSelectionCount(
    selectionCount,
    inputs.selectedOverlayRadiusOptionRaw,
  );
  const targetRadiusKm = resolveTargetOverlayRadiusKm(selectionCount, selectedOverlayRadiusOption);
  const missingTerrainTileKeys = resolveMissingOverlayTerrainTileKeys(
    selectedTerrainSites,
    targetRadiusKm,
    inputs.srtmTiles,
  );
  if (missingTerrainTileKeys.length > 0) {
    coverageRerunQueued = false;
    const message = `The ${targetRadiusKm} km Simulation could not be completed because ${missingTerrainTileKeys.length} required GLO-30 terrain tile${missingTerrainTileKeys.length === 1 ? " is" : "s are"} unavailable.`;
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
      calculationCycleSource: null,
      simulationErrorMessage: message,
    });
    appStoreBridge.setState({ terrainFetchStatus: message });
    return;
  }
  const runSignature = coverageInputSignature(inputs);

  if (runSignature === lastAppliedCoverageSignature) {
    coverageRerunQueued = false;
    useCoverageStore.setState({
      isSimulationRecomputing: false,
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
      simulationRunToken: "",
    });
    return;
  }

  coverageRerunQueued = false;
  coverageRunInFlight = true;
  coverageRunCounter += 1;
  const runId = `${Date.now()}-${coverageRunCounter.toString(36)}`;

  initializeRunState(useCoverageStore.setState, runId);
  await runCoverageComputation(useCoverageStore.setState, () => useCoverageStore.getState(), runId, runSignature, inputs);
};

export const useCoverageStore = create<CoverageState>((set, get) => ({
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
  automaticOptOutNoticeShown: false,
  calculationCycleSource: null,
  simulationErrorMessage: "",
  recomputeCoverage: () => {
    if (!appStoreBridge) return;
    const state = get();
    const manualRun = state.calculationCycleSource === "manual";
    if (!manualRun && !state.autoCalculateEnabled) return;
    coverageRerunQueued = true;
    queueCoverageRunFlush(COVERAGE_RECOMPUTE_DEBOUNCE_MS);
    if (coverageRunInFlight) return;
    if (get().isSimulationRecomputing) return;
    set({
      calculationCycleSource: manualRun ? "manual" : "auto",
      simulationErrorMessage: "",
      isSimulationRecomputing: true,
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "Preparing simulation bounds...",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
    });
  },
  markAutomaticOptOutNoticeShown: () => set({ automaticOptOutNoticeShown: true }),
  setAutoCalculateEnabled: (enabled) => {
    if (!enabled) {
      const hadPendingRun = coverageRecomputeTimer !== null;
      if (coverageRecomputeTimer !== null) {
        window.clearTimeout(coverageRecomputeTimer);
        coverageRecomputeTimer = null;
      }
      coverageRerunQueued = false;
      set({
        autoCalculateEnabled: false,
        ...(hadPendingRun && !coverageRunInFlight
          ? {
              calculationCycleSource: null,
              isSimulationRecomputing: false,
              simulationProgress: 0,
              simulationStepLabel: "",
            }
          : {}),
      });
      return;
    }
    if (!appStoreBridge) return;
    set({ autoCalculateEnabled: true, calculationCycleSource: "auto" });
    get().recomputeCoverage();
  },
  startManualCalculation: () => {
    set({ calculationCycleSource: "manual" });
    coverageRerunQueued = true;
    queueCoverageRunFlush(COVERAGE_RECOMPUTE_DEBOUNCE_MS);
    if (coverageRunInFlight || get().isSimulationRecomputing) return;
    set({
      isSimulationRecomputing: true,
      simulationErrorMessage: "",
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "Preparing simulation bounds...",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
    });
  },
  stopCalculation: () => {
    if (coverageRecomputeTimer !== null) {
      window.clearTimeout(coverageRecomputeTimer);
      coverageRecomputeTimer = null;
    }
    coverageRerunQueued = false;
    set({
      calculationCycleSource: null,
      isSimulationRecomputing: false,
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
      simulationRunToken: "",
    });
  },
  finishCalculationCycle: () => set({ calculationCycleSource: null }),
}));
