import { create } from "zustand";
import { buildCoverageAsync, computeCoverageGridDimensions } from "../lib/coverage";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import {
  deriveDynamicPropagationEnvironment,
} from "../lib/propagationEnvironment";
import {
  normalizeOverlayRadiusOptionForSelectionCount,
  resolveLoadedOverlayRadiusCapKm,
  resolveEffectiveOverlayRadiusKm,
  resolveTargetOverlayRadiusKm,
} from "../lib/simulationOverlayRadius";
import {
  recordSimulationCoveragePerf,
  recordSimulationRunCancelled,
} from "../lib/simulationPerf";
import { sampleSrtmElevation } from "../lib/srtm";
import type { Site, SrtmTile } from "../types/radio";
import type { CoverageSample } from "../types/radio";

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
  recomputeCoverage: () => void;
};

type NetworkLike = {
  id: string;
  frequencyMHz?: number;
  frequencyOverrideMHz?: number;
  memberships?: Array<{ siteId: string; systemId: string }>;
  [key: string]: unknown;
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
  networks: NetworkLike[];
  selectedNetworkId: string;
  sites: Site[];
  systems: unknown[];
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
};

const normalizeCoverageResolution = (raw: unknown): "24" | "42" | "84" | "168" => {
  if (raw === "24" || raw === "42" || raw === "84" || raw === "168") return raw;
  if (raw === "high") return "42";
  return "24";
};

const readCoverageInputs = (appState: Record<string, unknown>): CoverageInputs => {
  const selectedCoverageResolution = normalizeCoverageResolution(appState.selectedCoverageResolution);
  const isTerrainFetching = Boolean(appState.isTerrainFetching);
  const effectiveCoverageResolution = isTerrainFetching ? "24" : selectedCoverageResolution;
  return {
    selectedCoverageResolution,
    effectiveCoverageResolution,
    networks: (appState.networks as NetworkLike[]) ?? [],
    selectedNetworkId: (appState.selectedNetworkId as string) ?? "",
    sites: (appState.sites as Site[]) ?? [],
    systems: (appState.systems as unknown[]) ?? [],
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

const networkSignature = (network: NetworkLike): string => {
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

const shouldSkipStaleCommit = (runSignature: string): boolean => {
  if (!coverageRerunQueued || !appStoreBridge) return false;
  const latestState = appStoreBridge.getState();
  const latestInputs = readCoverageInputs(latestState);
  const latestSignature = coverageInputSignature(latestInputs);
  if (latestSignature === runSignature) {
    coverageRerunQueued = false;
    return false;
  }
  return true;
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
  let coverageSamples: CoverageSample[] = [];
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

    const effectiveEnvironment = autoDerived?.environment ?? inputs.propagationEnvironment;
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
    const selectedSingleSite =
      selectionCount === 1
        ? inputs.sites.find((site) => site.id === inputs.selectedSiteIds[0]) ?? null
        : null;
    const selectedOverlayRadiusOption = normalizeOverlayRadiusOptionForSelectionCount(
      selectionCount,
      inputs.selectedOverlayRadiusOptionRaw,
    );
    const overlayRadiusKm = resolveEffectiveOverlayRadiusKm({
      selectionCount,
      option: selectedOverlayRadiusOption,
      selectedSingleSite,
      srtmTiles: inputs.srtmTiles,
      isTerrainFetching: inputs.isTerrainFetching,
    });
    const targetRadiusKm = resolveTargetOverlayRadiusKm(selectionCount, selectedOverlayRadiusOption);
    const loadedRadiusCapKm = resolveLoadedOverlayRadiusCapKm(
      selectionCount === 1 && selectedSingleSite ? [selectedSingleSite] : inputs.sites,
      targetRadiusKm,
      inputs.srtmTiles,
      20,
    );
    const effectiveOverlayRadiusKm = Math.min(targetRadiusKm, overlayRadiusKm, loadedRadiusCapKm);

    const boundsForCount = simulationAreaBoundsForSites(inputs.sites, { overlayRadiusKm: effectiveOverlayRadiusKm });
    const sampleCount = boundsForCount
      ? computeCoverageGridDimensions(gridSize, boundsForCount, 1).totalSamples
      : 0;
    set({
      simulationProgress: 0,
      simulationProgressMode: "determinate",
      simulationStepLabel: "Sampling simulation grid...",
      simulationSamplesDone: 0,
      simulationSamplesTotal: sampleCount,
    });

    let lastProgress = 0;
    const buildCoverageStartedAt = nowMs();
    coverageSamples = await buildCoverageAsync(
      gridSize,
      network as Parameters<typeof buildCoverageAsync>[1],
      inputs.sites as Parameters<typeof buildCoverageAsync>[2],
      inputs.systems as Parameters<typeof buildCoverageAsync>[3],
      effectiveEnvironment as Parameters<typeof buildCoverageAsync>[4],
      ({ lat, lon }: { lat: number; lon: number }) => sampleSrtmElevation(inputs.srtmTiles, lat, lon),
      {
        sampleMultiplier: 1,
        terrainSamples: 20,
        overlayRadiusKm: effectiveOverlayRadiusKm,
        onProgress: (progress: number) => {
          if (get().simulationRunToken !== runId) return;
          const next = Math.round(progress * 100);
          if (next - lastProgress >= 2 || next >= 99) {
            lastProgress = next;
            set({ simulationProgress: next });
          }
        },
        terrainCacheKey: `${inputs.effectiveCoverageResolution}|${inputs.selectedNetworkId}|${inputs.propagationModel}|${inputs.terrainLoadEpoch}`,
      },
    );
    const coverageComputeMs = nowMs() - buildCoverageStartedAt;
    warnLongTask("coverage-build", runSignature, coverageComputeMs);

    if (get().simulationRunToken !== runId) {
      markCancelled("token-mismatch-after-coverage-build");
      return;
    }

    if (shouldSkipStaleCommit(runSignature)) {
      set({
        simulationProgress: 0,
        simulationProgressMode: "indeterminate",
        simulationStepLabel: "Preparing simulation bounds...",
        simulationSamplesDone: 0,
        simulationSamplesTotal: 0,
      });
      markCancelled("stale-signature-superseded");
      return;
    }

    recordSimulationCoveragePerf({
      runId,
      signature: runSignature,
      durationMs: coverageComputeMs,
      sampleCount,
      gridSize,
      effectiveRadiusKm: effectiveOverlayRadiusKm,
    });

    set({
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "Finalizing simulation overlay...",
    });

    const waitMs = Math.max(0, COVERAGE_MIN_VISIBLE_MS - (nowMs() - startedAt));
    if (waitMs > 0) await delayMs(waitMs);
    if (get().simulationRunToken !== runId) {
      markCancelled("token-mismatch-before-finalize");
      return;
    }

    finalizeRunComplete(set, get, runId, coverageSamples);
    lastAppliedCoverageSignature = runSignature;
    warnLongTask("coverage-total-run", runSignature, nowMs() - startedAt);
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
  const runSignature = coverageInputSignature(inputs);

  if (runSignature === lastAppliedCoverageSignature) {
    coverageRerunQueued = false;
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
  recomputeCoverage: () => {
    if (!appStoreBridge) return;
    coverageRerunQueued = true;
    queueCoverageRunFlush(COVERAGE_RECOMPUTE_DEBOUNCE_MS);
    if (coverageRunInFlight) return;
    if (get().isSimulationRecomputing) return;
    set({
      isSimulationRecomputing: true,
      simulationProgress: 0,
      simulationProgressMode: "indeterminate",
      simulationStepLabel: "Preparing simulation bounds...",
      simulationSamplesDone: 0,
      simulationSamplesTotal: 0,
    });
  },
}));
