import { create } from "zustand";
import { buildCoverageAsync } from "../lib/coverage";
import {
  deriveDynamicPropagationEnvironment,
} from "../lib/propagationEnvironment";
import {
  normalizeOverlayRadiusOptionForSelectionCount,
  resolveLoadedOverlayRadiusCapKm,
  resolveEffectiveOverlayRadiusKm,
  resolveTargetOverlayRadiusKm,
} from "../lib/simulationOverlayRadius";
import { sampleSrtmElevation } from "../lib/srtm";
import type { Site, SrtmTile } from "../types/radio";
import type { CoverageSample } from "../types/radio";

const COVERAGE_RECOMPUTE_DEBOUNCE_MS = 140;

let coverageRecomputeTimer: number | null = null;

type AppStoreBridge = {
  getState: () => Record<string, unknown>;
  setState: (patch: Record<string, unknown>) => void;
};

let appStoreBridge: AppStoreBridge | null = null;

export function setAppStoreBridge(bridge: AppStoreBridge): void {
  appStoreBridge = bridge;
}

export type CoverageState = {
  coverageSamples: CoverageSample[];
  isSimulationRecomputing: boolean;
  simulationProgress: number;
  simulationRunToken: string;
  recomputeCoverage: () => void;
};

export const useCoverageStore = create<CoverageState>((set, get) => ({
  coverageSamples: [],
  isSimulationRecomputing: false,
  simulationProgress: 0,
  simulationRunToken: "",
  recomputeCoverage: () => {
    if (!appStoreBridge) return;

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set({
      simulationRunToken: runId,
      isSimulationRecomputing: true,
      simulationProgress: 3,
    });

    if (coverageRecomputeTimer !== null) {
      window.clearTimeout(coverageRecomputeTimer);
      coverageRecomputeTimer = null;
    }

    coverageRecomputeTimer = window.setTimeout(() => {
      coverageRecomputeTimer = null;
      const startedAt = Date.now();
      if (get().simulationRunToken !== runId) return;

      const runComputation = async () => {
        if (get().simulationRunToken !== runId) return;

        const appState = appStoreBridge!.getState();
        const selectedCoverageResolution = (appState.selectedCoverageResolution as string) === "high" ? "high" : "normal";
        const gridSize = selectedCoverageResolution === "high" ? 42 : 24;
        const networks = appState.networks as Array<{ id: string; [key: string]: unknown }>;
        const selectedNetworkId = appState.selectedNetworkId as string;
        const sites = appState.sites as Site[];
        const systems = appState.systems as unknown[];
        const propagationModel = appState.propagationModel as string;
        const srtmTiles = appState.srtmTiles as SrtmTile[];
        const links = appState.links as Array<{ id: string; fromSiteId: string; toSiteId: string; [key: string]: unknown }>;
        const selectedLinkId = appState.selectedLinkId as string;
        const autoPropagationEnvironment = appState.autoPropagationEnvironment as boolean;
        const propagationEnvironment = appState.propagationEnvironment as Record<string, unknown>;
        const propagationEnvironmentReason = appState.propagationEnvironmentReason as string;
        const terrainLoadEpoch = appState.terrainLoadEpoch as number;
        const selectedSiteIds = (appState.selectedSiteIds as string[]) ?? [];
        const isTerrainFetching = Boolean(appState.isTerrainFetching);
        const selectedOverlayRadiusOptionRaw = appState.selectedOverlayRadiusOption;

        const network = networks.find((n) => n.id === selectedNetworkId);
        if (!network) {
          const finalize = () => {
            if (get().simulationRunToken !== runId) return;
            set({
              coverageSamples: [],
              isSimulationRecomputing: false,
              simulationProgress: 100,
            });
            window.setTimeout(() => {
              if (get().simulationRunToken === runId) {
                set({ simulationProgress: 0, simulationRunToken: "" });
              }
            }, 260);
          };
          const waitMs = Math.max(0, 600 - (Date.now() - startedAt));
          window.setTimeout(finalize, waitMs);
          return;
        }

        const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0] ?? null;
        const fromSite = selectedLink ? sites.find((site) => site.id === selectedLink.fromSiteId) ?? null : null;
        const toSite = selectedLink ? sites.find((site) => site.id === selectedLink.toSiteId) ?? null : null;
        const autoDerived =
          autoPropagationEnvironment && fromSite && toSite
            ? deriveDynamicPropagationEnvironment({
                from: fromSite.position as { lat: number; lon: number },
                to: toSite.position as { lat: number; lon: number },
                fromGroundM: fromSite.groundElevationM as number,
                toGroundM: toSite.groundElevationM as number,
                terrainSampler: ({ lat, lon }: { lat: number; lon: number }) =>
                  sampleSrtmElevation(srtmTiles, lat, lon),
              })
            : null;
        const effectiveEnvironment = autoDerived?.environment ?? propagationEnvironment;
        if (autoDerived) {
          if (
            propagationEnvironmentReason !== autoDerived.reason ||
            propagationEnvironment.clutterHeightM !== autoDerived.environment.clutterHeightM ||
            propagationEnvironment.polarization !== autoDerived.environment.polarization ||
            propagationEnvironment.groundDielectric !== autoDerived.environment.groundDielectric ||
            propagationEnvironment.groundConductivity !== autoDerived.environment.groundConductivity ||
            propagationEnvironment.radioClimate !== autoDerived.environment.radioClimate ||
            propagationEnvironment.atmosphericBendingNUnits !== autoDerived.environment.atmosphericBendingNUnits
          ) {
            appStoreBridge!.setState({
              propagationEnvironment: autoDerived.environment,
              propagationEnvironmentReason: autoDerived.reason,
            });
          }
        }

        const selectionCount = selectedSiteIds.length;
        const selectedSingleSite = selectionCount === 1
          ? sites.find((site) => site.id === selectedSiteIds[0]) ?? null
          : null;
        const selectedOverlayRadiusOption = normalizeOverlayRadiusOptionForSelectionCount(
          selectionCount,
          selectedOverlayRadiusOptionRaw,
        );
        const overlayRadiusKm = resolveEffectiveOverlayRadiusKm({
          selectionCount,
          option: selectedOverlayRadiusOption,
          selectedSingleSite,
          srtmTiles,
          isTerrainFetching,
        });
        const targetRadiusKm = resolveTargetOverlayRadiusKm(selectionCount, selectedOverlayRadiusOption);
        const loadedRadiusCapKm = resolveLoadedOverlayRadiusCapKm(
          selectionCount === 1 && selectedSingleSite ? [selectedSingleSite] : sites,
          targetRadiusKm,
          srtmTiles,
          20,
        );
        const effectiveOverlayRadiusKm = Math.min(targetRadiusKm, overlayRadiusKm, loadedRadiusCapKm);

        set({ simulationProgress: 8 });
        let lastProgress = 8;
        const coverageSamples = await buildCoverageAsync(
          gridSize,
          network as Parameters<typeof buildCoverageAsync>[1],
          sites as Parameters<typeof buildCoverageAsync>[2],
          systems as Parameters<typeof buildCoverageAsync>[3],
          effectiveEnvironment as Parameters<typeof buildCoverageAsync>[4],
          ({ lat, lon }: { lat: number; lon: number }) =>
            sampleSrtmElevation(srtmTiles, lat, lon),
          {
            sampleMultiplier: 1,
            terrainSamples: 20,
            overlayRadiusKm: effectiveOverlayRadiusKm,
            onProgress: (progress: number) => {
              if (get().simulationRunToken !== runId) return;
              const next = Math.round(8 + progress * 84);
              if (next - lastProgress >= 2 || next >= 99) {
                lastProgress = next;
                set({ simulationProgress: next });
              }
            },
            terrainCacheKey: `${selectedCoverageResolution}|${selectedNetworkId}|${propagationModel}|${terrainLoadEpoch}`,
          },
        );
        if (get().simulationRunToken !== runId) return;
        const finalize = () => {
          if (get().simulationRunToken === runId) {
            set({
              coverageSamples,
              isSimulationRecomputing: false,
              simulationProgress: 100,
            });
            window.setTimeout(() => {
              if (get().simulationRunToken === runId) {
                set({ simulationProgress: 0, simulationRunToken: "" });
              }
            }, 320);
          }
        };
        const waitMs = Math.max(0, 600 - (Date.now() - startedAt));
        window.setTimeout(finalize, waitMs);
      };

      // Let the browser paint the progress bar before starting heavy recomputation work.
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(runComputation);
        });
      } else {
        window.setTimeout(runComputation, 0);
      }
    }, COVERAGE_RECOMPUTE_DEBOUNCE_MS);
  },
}));
