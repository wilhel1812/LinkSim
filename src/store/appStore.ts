import { create } from "zustand";
import { buildCoverage } from "../lib/coverage";
import { fetchElevations } from "../lib/elevationService";
import { findPresetById } from "../lib/frequencyPlans";
import { analyzeLink, buildProfile } from "../lib/propagation";
import { DEMO_SCENARIOS, defaultScenario, getScenarioById } from "../lib/scenarios";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { parseSrtmTile, sampleSrtmElevation } from "../lib/srtm";
import {
  clearVe2dbeCache,
  loadVe2dbeTilesForArea,
  recommendVe2dbeDatasetForArea,
  type TerrainDataset,
} from "../lib/ve2dbeTerrainClient";
import type { LocaleCode } from "../i18n/locales";
import type {
  CoverageMode,
  CoverageSample,
  Link,
  LinkAnalysis,
  MapViewport,
  Network,
  ProfilePoint,
  PropagationModel,
  RadioSystem,
  Site,
  SrtmTile,
} from "../types/radio";

type SiteLibraryEntry = {
  id: string;
  name: string;
  position: { lat: number; lon: number };
  groundElevationM: number;
  antennaHeightM: number;
  createdAt: string;
};

type SimulationPreset = {
  id: string;
  name: string;
  updatedAt: string;
  snapshot: {
    sites: Site[];
    links: Link[];
    systems: RadioSystem[];
    networks: Network[];
    selectedSiteId: string;
    selectedLinkId: string;
    selectedNetworkId: string;
    selectedCoverageMode: CoverageMode;
    propagationModel: PropagationModel;
    selectedFrequencyPresetId: string;
    rxSensitivityTargetDbm: number;
    environmentLossDb: number;
    terrainDataset: TerrainDataset;
    mapViewport: MapViewport;
  };
};

type AppState = {
  sites: Site[];
  links: Link[];
  systems: RadioSystem[];
  networks: Network[];
  srtmTiles: SrtmTile[];
  coverageSamples: CoverageSample[];
  isSimulationRecomputing: boolean;
  simulationProgress: number;
  simulationRunToken: string;
  coverageResolutionMode: "auto" | "high";
  isTerrainFetching: boolean;
  isTerrainRecommending: boolean;
  isElevationSyncing: boolean;
  selectedLinkId: string;
  profileCursorIndex: number;
  selectedSiteId: string;
  selectedNetworkId: string;
  selectedCoverageMode: CoverageMode;
  propagationModel: PropagationModel;
  mapViewport: MapViewport;
  locale: LocaleCode;
  selectedScenarioId: string;
  selectedFrequencyPresetId: string;
  rxSensitivityTargetDbm: number;
  environmentLossDb: number;
  terrainDataset: TerrainDataset;
  terrainFetchStatus: string;
  terrainRecommendation: string;
  hasOnlineElevationSync: boolean;
  siteLibrary: SiteLibraryEntry[];
  simulationPresets: SimulationPreset[];
  endpointPickTarget: "from" | "to" | null;
  scenarioOptions: { id: string; name: string }[];
  setLocale: (locale: LocaleCode) => void;
  selectScenario: (id: string) => void;
  setSelectedLinkId: (id: string) => void;
  setProfileCursorIndex: (index: number) => void;
  setSelectedSiteId: (id: string) => void;
  setSelectedNetworkId: (id: string) => void;
  setSelectedCoverageMode: (mode: CoverageMode) => void;
  setCoverageResolutionMode: (mode: "auto" | "high") => void;
  setSelectedFrequencyPresetId: (id: string) => void;
  setRxSensitivityTargetDbm: (value: number) => void;
  setEnvironmentLossDb: (value: number) => void;
  setTerrainDataset: (dataset: TerrainDataset) => void;
  addSiteByCoordinates: (name: string, lat: number, lon: number) => void;
  deleteSite: (siteId: string) => void;
  createLink: (fromSiteId: string, toSiteId: string, name?: string) => void;
  deleteLink: (linkId: string) => void;
  insertSiteFromLibrary: (entryId: string) => void;
  insertSitesFromLibrary: (entryIds: string[]) => void;
  updateSiteLibraryEntry: (
    entryId: string,
    patch: Partial<Pick<SiteLibraryEntry, "name" | "position" | "groundElevationM" | "antennaHeightM">>,
  ) => void;
  deleteSiteLibraryEntry: (entryId: string) => void;
  deleteSiteLibraryEntries: (entryIds: string[]) => void;
  saveCurrentSimulationPreset: (name: string) => void;
  loadSimulationPreset: (presetId: string) => void;
  deleteSimulationPreset: (presetId: string) => void;
  setEndpointPickTarget: (target: "from" | "to" | null) => void;
  applyFrequencyPresetToSelectedNetwork: () => void;
  setPropagationModel: (model: PropagationModel) => void;
  updateSite: (id: string, patch: Partial<Site>) => void;
  updateLink: (id: string, patch: Partial<Link>) => void;
  updateMapViewport: (patch: Partial<MapViewport>) => void;
  ingestSrtmFiles: (files: FileList | File[]) => Promise<void>;
  recommendTerrainDatasetForCurrentArea: () => Promise<void>;
  fetchTerrainForCurrentArea: () => Promise<void>;
  recommendAndFetchTerrainForCurrentArea: () => Promise<void>;
  clearTerrainCache: () => Promise<void>;
  syncSiteElevationsOnline: () => Promise<void>;
  syncSiteElevationOnline: (siteId: string) => Promise<void>;
  recomputeCoverage: () => void;
  getSelectedLink: () => Link;
  getSelectedSite: () => Site;
  getSelectedNetwork: () => Network;
  getSelectedSites: () => { fromSite: Site; toSite: Site };
  getSelectedAnalysis: () => LinkAnalysis;
  getSelectedProfile: () => ProfilePoint[];
};

const SITE_LIBRARY_KEY = "rmw-site-library-v1";
const SIM_PRESETS_KEY = "rmw-sim-presets-v1";

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const makeId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const builtinSiteFingerprint = new Set(
  DEMO_SCENARIOS.flatMap((scenario) =>
    scenario.sites.map(
      (site) =>
        `${site.name.toLowerCase()}|${site.position.lat.toFixed(6)}|${site.position.lon.toFixed(6)}`,
    ),
  ),
);

const isBuiltinSiteLibraryEntry = (entry: SiteLibraryEntry): boolean =>
  builtinSiteFingerprint.has(
    `${entry.name.toLowerCase()}|${entry.position.lat.toFixed(6)}|${entry.position.lon.toFixed(6)}`,
  );

const dedupeLibraryEntries = (entries: SiteLibraryEntry[]): SiteLibraryEntry[] => {
  const seen = new Set<string>();
  const out: SiteLibraryEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.name.toLowerCase()}|${entry.position.lat.toFixed(6)}|${entry.position.lon.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
};

const normalizeSiteLibrary = (entries: SiteLibraryEntry[]): SiteLibraryEntry[] =>
  dedupeLibraryEntries(entries.filter((entry) => !isBuiltinSiteLibraryEntry(entry)));

const persistedSiteLibrary = readStorage<SiteLibraryEntry[]>(SITE_LIBRARY_KEY, []);
const initialSiteLibrary = normalizeSiteLibrary(persistedSiteLibrary);
if (JSON.stringify(initialSiteLibrary) !== JSON.stringify(persistedSiteLibrary)) {
  writeStorage(SITE_LIBRARY_KEY, initialSiteLibrary);
}

export const useAppStore = create<AppState>((set, get) => ({
  sites: defaultScenario.sites,
  links: defaultScenario.links,
  systems: defaultScenario.systems,
  networks: defaultScenario.networks,
  srtmTiles: [],
  coverageSamples: [],
  isSimulationRecomputing: false,
  simulationProgress: 0,
  simulationRunToken: "",
  coverageResolutionMode: "auto",
  isTerrainFetching: false,
  isTerrainRecommending: false,
  isElevationSyncing: false,
  selectedLinkId: defaultScenario.defaultLinkId,
  profileCursorIndex: 0,
  selectedSiteId: defaultScenario.defaultSiteId,
  selectedNetworkId: defaultScenario.defaultNetworkId,
  selectedCoverageMode: "BestSite",
  propagationModel: "ITM",
  mapViewport: defaultScenario.viewport,
  locale: "eng",
  selectedScenarioId: defaultScenario.id,
  selectedFrequencyPresetId: defaultScenario.defaultFrequencyPresetId,
  rxSensitivityTargetDbm: -120,
  environmentLossDb: 0,
  terrainDataset: "srtm1",
  terrainFetchStatus: "",
  terrainRecommendation: "",
  hasOnlineElevationSync: false,
  siteLibrary: initialSiteLibrary,
  simulationPresets: readStorage<SimulationPreset[]>(SIM_PRESETS_KEY, []),
  endpointPickTarget: null,
  scenarioOptions: DEMO_SCENARIOS.map((scenario) => ({ id: scenario.id, name: scenario.name })),
  setLocale: (locale) => set({ locale }),
  selectScenario: (id) => {
    const scenario = getScenarioById(id);
    if (!scenario) return;
    set({
      selectedScenarioId: scenario.id,
      sites: scenario.sites,
      links: scenario.links,
      systems: scenario.systems,
      networks: scenario.networks,
      selectedSiteId: scenario.defaultSiteId,
      selectedLinkId: scenario.defaultLinkId,
      profileCursorIndex: 0,
      selectedNetworkId: scenario.defaultNetworkId,
      selectedFrequencyPresetId: scenario.defaultFrequencyPresetId,
      propagationModel: "ITM",
      rxSensitivityTargetDbm: -120,
      environmentLossDb: 0,
      terrainFetchStatus: "",
      terrainRecommendation: "",
      hasOnlineElevationSync: false,
      endpointPickTarget: null,
      mapViewport: scenario.viewport,
    });
    get().recomputeCoverage();
  },
  setSelectedLinkId: (id) => set({ selectedLinkId: id, profileCursorIndex: 0 }),
  setProfileCursorIndex: (index) => set({ profileCursorIndex: Math.max(0, Math.floor(index)) }),
  setSelectedSiteId: (id) => {
    set({ selectedSiteId: id });
    void get().syncSiteElevationOnline(id);
  },
  setSelectedNetworkId: (id) => {
    set({ selectedNetworkId: id });
    get().recomputeCoverage();
  },
  setSelectedCoverageMode: (mode) => {
    set({ selectedCoverageMode: mode });
    get().recomputeCoverage();
  },
  setCoverageResolutionMode: (mode) => {
    set({ coverageResolutionMode: mode });
    get().recomputeCoverage();
  },
  setSelectedFrequencyPresetId: (id) => set({ selectedFrequencyPresetId: id }),
  setRxSensitivityTargetDbm: (value) => set({ rxSensitivityTargetDbm: value }),
  setEnvironmentLossDb: (value) => set({ environmentLossDb: Math.max(0, value) }),
  setTerrainDataset: (dataset) => set({ terrainDataset: dataset }),
  addSiteByCoordinates: (name, lat, lon) => {
    const label = name.trim() || `Site ${get().sites.length + 1}`;
    const id = makeId("site");
    const newSite: Site = {
      id,
      name: label,
      position: { lat, lon },
      groundElevationM: 0,
      antennaHeightM: 2,
    };
    set((state) => {
      const entry: SiteLibraryEntry = {
        id: makeId("libsite"),
        name: label,
        position: { lat, lon },
        groundElevationM: 0,
        antennaHeightM: 2,
        createdAt: new Date().toISOString(),
      };
      const nextLibrary = normalizeSiteLibrary([entry, ...state.siteLibrary]);
      writeStorage(SITE_LIBRARY_KEY, nextLibrary);
      return {
        sites: [...state.sites, newSite],
        selectedSiteId: id,
        siteLibrary: nextLibrary,
      };
    });
    get().recomputeCoverage();
    void get().syncSiteElevationOnline(id);
  },
  deleteSite: (siteId) => {
    set((state) => {
      const remainingSites = state.sites.filter((site) => site.id !== siteId);
      if (!remainingSites.length) return state;

      let remainingLinks = state.links.filter(
        (link) => link.fromSiteId !== siteId && link.toSiteId !== siteId,
      );
      if (!remainingLinks.length && remainingSites.length >= 2) {
        const base = state.links[0];
        const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
        const inheritedFrequencyMHz =
          selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? base?.frequencyMHz ?? 869.618;
        remainingLinks = [
          {
            id: makeId("lnk"),
            name: "Auto Link",
            fromSiteId: remainingSites[0].id,
            toSiteId: remainingSites[1].id,
            frequencyMHz: inheritedFrequencyMHz,
            txPowerDbm: base?.txPowerDbm ?? 22,
            txGainDbi: base?.txGainDbi ?? 2,
            rxGainDbi: base?.rxGainDbi ?? 2,
            cableLossDb: base?.cableLossDb ?? 1,
          },
        ];
      }
      const safeLinkId = remainingLinks[0]?.id ?? "";
      const safeSiteId =
        state.selectedSiteId === siteId ? remainingSites[0].id : state.selectedSiteId;

      return {
        sites: remainingSites,
        links: remainingLinks,
        selectedSiteId: safeSiteId,
        selectedLinkId: safeLinkId,
        networks: state.networks.map((network) => ({
          ...network,
          memberships: network.memberships.filter((member) => member.siteId !== siteId),
        })),
      };
    });
    get().recomputeCoverage();
  },
  createLink: (fromSiteId, toSiteId, name) => {
    if (fromSiteId === toSiteId) return;
    const state = get();
    const base = state.links[0];
    const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
    const inheritedFrequencyMHz = selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 869.618;
    const fromSite = state.sites.find((site) => site.id === fromSiteId);
    const toSite = state.sites.find((site) => site.id === toSiteId);
    const autoName = fromSite && toSite ? `${fromSite.name} -> ${toSite.name}` : `Link ${state.links.length + 1}`;
    const id = makeId("lnk");
    const link: Link = {
      id,
      name: name?.trim() || autoName,
      fromSiteId,
      toSiteId,
      frequencyMHz: inheritedFrequencyMHz,
      txPowerDbm: base?.txPowerDbm ?? 22,
      txGainDbi: base?.txGainDbi ?? 2,
      rxGainDbi: base?.rxGainDbi ?? 2,
      cableLossDb: base?.cableLossDb ?? 1,
    };
    set((state) => ({
      links: [...state.links, link],
      selectedLinkId: id,
    }));
    get().recomputeCoverage();
  },
  deleteLink: (linkId) => {
    set((state) => {
      const remaining = state.links.filter((link) => link.id !== linkId);
      if (!remaining.length) return state;
      return {
        links: remaining,
        selectedLinkId:
          state.selectedLinkId === linkId ? remaining[0].id : state.selectedLinkId,
      };
    });
    get().recomputeCoverage();
  },
  insertSiteFromLibrary: (entryId) => {
    get().insertSitesFromLibrary([entryId]);
  },
  insertSitesFromLibrary: (entryIds) => {
    const requested = new Set(entryIds);
    if (!requested.size) return;
    const entries = get().siteLibrary.filter((candidate) => requested.has(candidate.id));
    if (!entries.length) return;
    const createdSiteIds: string[] = [];
    const addedSites: Site[] = entries.map((entry) => {
      const siteId = makeId("site");
      createdSiteIds.push(siteId);
      return {
        id: siteId,
        name: entry.name,
        position: entry.position,
        groundElevationM: entry.groundElevationM,
        antennaHeightM: entry.antennaHeightM,
      };
    });

    set((state) => ({
      sites: [...state.sites, ...addedSites],
      selectedSiteId: createdSiteIds[createdSiteIds.length - 1] ?? state.selectedSiteId,
    }));
    get().recomputeCoverage();
    for (const siteId of createdSiteIds) {
      void get().syncSiteElevationOnline(siteId);
    }
  },
  updateSiteLibraryEntry: (entryId, patch) => {
    set((state) => {
      const next = dedupeLibraryEntries(
        state.siteLibrary.map((entry) => {
          if (entry.id !== entryId) return entry;
          return {
            ...entry,
            ...patch,
            position: {
              ...entry.position,
              ...(patch.position ?? {}),
            },
          };
        }),
      );
      writeStorage(SITE_LIBRARY_KEY, next);
      return { siteLibrary: next };
    });
  },
  deleteSiteLibraryEntry: (entryId) => {
    get().deleteSiteLibraryEntries([entryId]);
  },
  deleteSiteLibraryEntries: (entryIds) => {
    const requested = new Set(entryIds);
    if (!requested.size) return;
    set((state) => {
      const next = state.siteLibrary.filter((entry) => !requested.has(entry.id));
      writeStorage(SITE_LIBRARY_KEY, next);
      return { siteLibrary: next };
    });
  },
  saveCurrentSimulationPreset: (name) => {
    const presetName = name.trim();
    if (!presetName) return;
    const state = get();
    const snapshot: SimulationPreset["snapshot"] = {
      sites: state.sites,
      links: state.links,
      systems: state.systems,
      networks: state.networks,
      selectedSiteId: state.selectedSiteId,
      selectedLinkId: state.selectedLinkId,
      selectedNetworkId: state.selectedNetworkId,
      selectedCoverageMode: state.selectedCoverageMode,
      propagationModel: state.propagationModel,
      selectedFrequencyPresetId: state.selectedFrequencyPresetId,
      rxSensitivityTargetDbm: state.rxSensitivityTargetDbm,
      environmentLossDb: state.environmentLossDb,
      terrainDataset: state.terrainDataset,
      mapViewport: state.mapViewport,
    };

    set((current) => {
      const existing = current.simulationPresets.find((preset) => preset.name === presetName);
      const nextPreset: SimulationPreset = {
        id: existing?.id ?? makeId("sim"),
        name: presetName,
        updatedAt: new Date().toISOString(),
        snapshot,
      };
      const next = [nextPreset, ...current.simulationPresets.filter((preset) => preset.id !== nextPreset.id)];
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
  },
  loadSimulationPreset: (presetId) => {
    const preset = get().simulationPresets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    const snap = preset.snapshot;
    set({
      sites: snap.sites,
      links: snap.links,
      systems: snap.systems,
      networks: snap.networks,
      selectedSiteId: snap.selectedSiteId,
      selectedLinkId: snap.selectedLinkId,
      selectedNetworkId: snap.selectedNetworkId,
      selectedCoverageMode: snap.selectedCoverageMode,
      propagationModel: snap.propagationModel,
      selectedFrequencyPresetId: snap.selectedFrequencyPresetId,
      rxSensitivityTargetDbm: snap.rxSensitivityTargetDbm,
      environmentLossDb: snap.environmentLossDb,
      terrainDataset: snap.terrainDataset,
      mapViewport: snap.mapViewport,
      terrainFetchStatus: `Loaded simulation preset: ${preset.name}`,
    });
    get().recomputeCoverage();
  },
  deleteSimulationPreset: (presetId) => {
    set((state) => {
      const next = state.simulationPresets.filter((preset) => preset.id !== presetId);
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
  },
  setEndpointPickTarget: (target) => set({ endpointPickTarget: target }),
  applyFrequencyPresetToSelectedNetwork: () => {
    const { selectedFrequencyPresetId, selectedNetworkId } = get();
    const preset = findPresetById(selectedFrequencyPresetId);
    if (!preset) return;

    set((state) => ({
      networks: state.networks.map((network) =>
        network.id === selectedNetworkId
          ? {
              ...network,
              frequencyMHz: preset.frequencyMHz,
              bandwidthKhz: preset.bandwidthKhz,
              spreadFactor: preset.spreadFactor,
              codingRate: preset.codingRate,
              frequencyOverrideMHz: preset.frequencyMHz,
              regionCode: preset.regionCode,
            }
          : network,
      ),
      links: state.links.map((link) => ({ ...link, frequencyMHz: preset.frequencyMHz })),
    }));
    get().recomputeCoverage();
  },
  setPropagationModel: (model) => {
    set({ propagationModel: model });
    get().recomputeCoverage();
  },
  updateSite: (id, patch) => {
    set((state) => ({
      sites: state.sites.map((site) => (site.id === id ? { ...site, ...patch } : site)),
    }));
    get().recomputeCoverage();
  },
  updateLink: (id, patch) => {
    set((state) => ({
      links: state.links.map((link) => {
        if (link.id !== id) return link;
        const next = { ...link, ...patch };

        if (next.fromSiteId === next.toSiteId) {
          const alternative = state.sites.find((site) => site.id !== next.fromSiteId);
          if (alternative) {
            if ("fromSiteId" in patch && !("toSiteId" in patch)) {
              next.toSiteId = alternative.id;
            } else {
              next.fromSiteId = alternative.id;
            }
          }
        }

        return next;
      }),
    }));
    get().recomputeCoverage();
  },
  updateMapViewport: (patch) =>
    set((state) => ({
      mapViewport: {
        ...state.mapViewport,
        ...patch,
        center: {
          ...state.mapViewport.center,
          ...(patch.center ?? {}),
        },
      },
    })),
  ingestSrtmFiles: async (files) => {
    set({ isTerrainFetching: true });
    try {
      const list = Array.from(files);
      const parsed = await Promise.all(
        list.map(async (file) => {
          const tile = await parseSrtmTile(file);
          return {
            ...tile,
            sourceKind: "manual-upload" as const,
            sourceId: "manual-upload",
            sourceLabel: "Manual upload",
            sourceDetail: file.name,
          };
        }),
      );

      set((state) => {
        const dedup = new Map<string, SrtmTile>();
        for (const tile of state.srtmTiles) dedup.set(tile.key, tile);
        for (const tile of parsed) dedup.set(tile.key, tile);
        return { srtmTiles: Array.from(dedup.values()), isTerrainFetching: false };
      });
      get().recomputeCoverage();
    } finally {
      set({ isTerrainFetching: false });
    }
  },
  recommendTerrainDatasetForCurrentArea: async () => {
    const { sites } = get();
    if (!sites.length) return;

    const bounds = simulationAreaBoundsForSites(sites);
    if (!bounds) return;

    set({ terrainRecommendation: "Evaluating ve2dbe coverage...", isTerrainRecommending: true });
    try {
      const recommendation = await recommendVe2dbeDatasetForArea(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
      );
      const perDataset = [
        `SRTM Third: ${Math.round(recommendation.byDataset.srtmthird.completeness * 100)}% (${recommendation.byDataset.srtmthird.availableTiles}/${recommendation.expectedTiles})`,
        `SRTM1: ${Math.round(recommendation.byDataset.srtm1.completeness * 100)}% (${recommendation.byDataset.srtm1.availableTiles}/${recommendation.expectedTiles})`,
        `SRTM3: ${Math.round(recommendation.byDataset.srtm3.completeness * 100)}% (${recommendation.byDataset.srtm3.availableTiles}/${recommendation.expectedTiles})`,
      ].join(" | ");
      set({
        terrainDataset: recommendation.dataset,
        terrainRecommendation: `Recommended: ${recommendation.dataset.toUpperCase()} (${Math.round(recommendation.completeness * 100)}%, ${recommendation.availableTiles}/${recommendation.expectedTiles}). ${perDataset}`,
        isTerrainRecommending: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ terrainRecommendation: `Recommendation failed: ${message}`, isTerrainRecommending: false });
    }
  },
  fetchTerrainForCurrentArea: async () => {
    const { sites, terrainDataset } = get();
    if (!sites.length) return;

    const bounds = simulationAreaBoundsForSites(sites);
    if (!bounds) return;

    set({
      terrainFetchStatus: `Fetching ${terrainDataset.toUpperCase()} tiles from ve2dbe...`,
      isTerrainFetching: true,
    });

    try {
      const result = await loadVe2dbeTilesForArea(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        terrainDataset,
      );
      set((state) => {
        const dedup = new Map<string, SrtmTile>();
        for (const tile of state.srtmTiles) dedup.set(tile.key, tile);
        for (const tile of result.tiles) dedup.set(tile.key, tile);
        const statusParts = [
          `Loaded ${result.tiles.length} tile(s)`,
          result.fetchedArchives.length ? `${result.fetchedArchives.length} fetched` : "",
          result.cacheHits.length ? `${result.cacheHits.length} from cache` : "",
          result.failedArchives.length ? `${result.failedArchives.length} failed` : "",
        ].filter(Boolean);
        return {
          srtmTiles: Array.from(dedup.values()),
          isTerrainFetching: false,
          terrainFetchStatus: `${statusParts.join(", ")} from ve2dbe ${terrainDataset}.${result.failedArchives.length ? ` Missing: ${result.failedArchives.slice(0, 4).join(", ")}${result.failedArchives.length > 4 ? "..." : ""}` : ""}`,
        };
      });
      get().recomputeCoverage();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ terrainFetchStatus: `Terrain fetch failed: ${message}`, isTerrainFetching: false });
    }
  },
  recommendAndFetchTerrainForCurrentArea: async () => {
    await get().recommendTerrainDatasetForCurrentArea();
    await get().fetchTerrainForCurrentArea();
  },
  clearTerrainCache: async () => {
    set({ isTerrainFetching: true });
    await clearVe2dbeCache();
    set((state) => ({
      srtmTiles: state.srtmTiles.filter((tile) => tile.sourceKind === "manual-upload"),
      isTerrainFetching: false,
      terrainFetchStatus: "ve2dbe cache cleared.",
    }));
    get().recomputeCoverage();
  },
  syncSiteElevationOnline: async (siteId) => {
    const site = get().sites.find((candidate) => candidate.id === siteId);
    if (!site) return;
    if (!Number.isFinite(site.position.lat) || !Number.isFinite(site.position.lon)) return;
    if (site.groundElevationM > 0) return;

    set({ isElevationSyncing: true });
    try {
      const [elevation] = await fetchElevations([site.position]);
      if (!Number.isFinite(elevation)) return;
      set((state) => ({
        sites: state.sites.map((candidate) =>
          candidate.id === siteId ? { ...candidate, groundElevationM: Math.round(elevation) } : candidate,
        ),
        hasOnlineElevationSync: true,
      }));
      get().recomputeCoverage();
    } catch {
      // Keep manual/default elevation when online sync fails.
    } finally {
      set({ isElevationSyncing: false });
    }
  },
  syncSiteElevationsOnline: async () => {
    const sites = get().sites;
    set({ isElevationSyncing: true });
    try {
      const elevations = await fetchElevations(sites.map((site) => site.position));

      set((state) => ({
        sites: state.sites.map((site, index) => ({
          ...site,
          groundElevationM: Number.isFinite(elevations[index])
            ? Math.round(elevations[index])
            : site.groundElevationM,
        })),
        hasOnlineElevationSync: true,
      }));
    } finally {
      set({ isElevationSyncing: false });
    }
  },
  recomputeCoverage: () => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    set({
      simulationRunToken: runId,
      isSimulationRecomputing: true,
      simulationProgress: 3,
    });

    const runComputation = () => {
      const state = get();
      if (state.simulationRunToken !== runId) return;

      const {
        selectedCoverageMode,
        networks,
        selectedNetworkId,
        sites,
        systems,
        propagationModel,
        srtmTiles,
        coverageResolutionMode,
      } = state;
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

      set({ simulationProgress: 8 });
      const coverageSamples = buildCoverage(
        selectedCoverageMode,
        network,
        sites,
        systems,
        propagationModel,
        ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
        {
          sampleMultiplier: coverageResolutionMode === "high" ? 4 : 1,
          terrainSamples: coverageResolutionMode === "high" ? 72 : 20,
          onProgress: (progress) => {
            if (get().simulationRunToken !== runId) return;
            set({ simulationProgress: Math.round(8 + progress * 84) });
          },
        },
      );
      if (get().simulationRunToken !== runId) return;
      const finalize = () => {
        if (get().simulationRunToken !== runId) return;
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
  },
  getSelectedLink: () => {
    const { links, selectedLinkId } = get();
    const link = links.find((candidate) => candidate.id === selectedLinkId);
    if (!link) throw new Error(`Selected link ${selectedLinkId} not found`);
    return link;
  },
  getSelectedSite: () => {
    const { sites, selectedSiteId } = get();
    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    if (!site) throw new Error(`Selected site ${selectedSiteId} not found`);
    return site;
  },
  getSelectedNetwork: () => {
    const { networks, selectedNetworkId } = get();
    const network = networks.find((candidate) => candidate.id === selectedNetworkId);
    if (!network) throw new Error(`Selected network ${selectedNetworkId} not found`);
    return network;
  },
  getSelectedSites: () => {
    const { sites, getSelectedLink } = get();
    const link = getSelectedLink();
    const fromSite = sites.find((s) => s.id === link.fromSiteId);
    const toSite = sites.find((s) => s.id === link.toSiteId);
    if (!fromSite || !toSite) throw new Error(`Sites for link ${link.id} not found`);
    return { fromSite, toSite };
  },
  getSelectedAnalysis: () => {
    const { getSelectedLink, getSelectedNetwork, getSelectedSites, propagationModel, srtmTiles, coverageResolutionMode } =
      get();
    const link = getSelectedLink();
    const selectedNetwork = getSelectedNetwork();
    const effectiveLink = {
      ...link,
      frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz,
    };
    const { fromSite, toSite } = getSelectedSites();
    return analyzeLink(
      effectiveLink,
      fromSite,
      toSite,
      propagationModel,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      { terrainSamples: coverageResolutionMode === "high" ? 80 : 32 },
    );
  },
  getSelectedProfile: () => {
    const { getSelectedLink, getSelectedNetwork, getSelectedSites, srtmTiles, coverageResolutionMode } = get();
    const link = getSelectedLink();
    const selectedNetwork = getSelectedNetwork();
    const effectiveLink = {
      ...link,
      frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz,
    };
    const { fromSite, toSite } = getSelectedSites();

    return buildProfile(
      effectiveLink,
      fromSite,
      toSite,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      coverageResolutionMode === "high" ? 320 : 120,
    );
  },
}));

useAppStore.getState().recomputeCoverage();
