import { create } from "zustand";
import { buildCoverage } from "../lib/coverage";
import { fetchElevations } from "../lib/elevationService";
import { findPresetById } from "../lib/frequencyPlans";
import { getUiErrorMessage } from "../lib/uiError";
import {
  defaultPropagationEnvironment,
  deriveDynamicPropagationEnvironment,
  withClimateDefaults,
} from "../lib/propagationEnvironment";
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
  PropagationEnvironment,
  ProfilePoint,
  PropagationModel,
  RadioSystem,
  Site,
  SrtmTile,
} from "../types/radio";

type SiteLibraryEntry = {
  id: string;
  name: string;
  visibility?: "private" | "public" | "shared";
  sharedWith?: Array<{ userId: string; role: "viewer" | "editor" | "admin" }>;
  ownerUserId?: string;
  effectiveRole?: "owner" | "admin" | "editor" | "viewer";
  position: { lat: number; lon: number };
  groundElevationM: number;
  antennaHeightM: number;
  createdAt: string;
  sourceMeta?: {
    provider: string;
    sourceType: string;
    nodeId?: string;
    shortName?: string;
    longName?: string;
    hwModel?: string;
    lastSeenUnix?: number;
    raw?: Record<string, unknown>;
  };
};

type SimulationPreset = {
  id: string;
  name: string;
  visibility?: "private" | "public" | "shared";
  sharedWith?: Array<{ userId: string; role: "viewer" | "editor" | "admin" }>;
  ownerUserId?: string;
  effectiveRole?: "owner" | "admin" | "editor" | "viewer";
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
    propagationEnvironment: PropagationEnvironment;
    autoPropagationEnvironment: boolean;
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
  propagationEnvironment: PropagationEnvironment;
  autoPropagationEnvironment: boolean;
  propagationEnvironmentReason: string;
  terrainDataset: TerrainDataset;
  terrainFetchStatus: string;
  terrainRecommendation: string;
  hasOnlineElevationSync: boolean;
  siteLibrary: SiteLibraryEntry[];
  simulationPresets: SimulationPreset[];
  endpointPickTarget: "from" | "to" | null;
  pendingSiteLibraryDraft: { lat: number; lon: number; token: string } | null;
  scenarioOptions: { id: string; name: string }[];
  setLocale: (locale: LocaleCode) => void;
  selectScenario: (id: string) => void;
  setSelectedLinkId: (id: string) => void;
  setProfileCursorIndex: (index: number) => void;
  setSelectedSiteId: (id: string) => void;
  setSelectedNetworkId: (id: string) => void;
  setSelectedCoverageMode: (mode: CoverageMode) => void;
  runHighQualitySimulation: () => void;
  setSelectedFrequencyPresetId: (id: string) => void;
  setRxSensitivityTargetDbm: (value: number) => void;
  setEnvironmentLossDb: (value: number) => void;
  setAutoPropagationEnvironment: (value: boolean) => void;
  setPropagationEnvironment: (patch: Partial<PropagationEnvironment>) => void;
  applyClimateDefaults: (climate: PropagationEnvironment["radioClimate"]) => void;
  setTerrainDataset: (dataset: TerrainDataset) => void;
  addSiteByCoordinates: (name: string, lat: number, lon: number) => void;
  deleteSite: (siteId: string) => void;
  createLink: (fromSiteId: string, toSiteId: string, name?: string) => void;
  deleteLink: (linkId: string) => void;
  addSiteLibraryEntry: (
    name: string,
    lat: number,
    lon: number,
    groundElevationM?: number,
    antennaHeightM?: number,
    sourceMeta?: SiteLibraryEntry["sourceMeta"],
  ) => void;
  insertSiteFromLibrary: (entryId: string) => void;
  insertSitesFromLibrary: (entryIds: string[]) => void;
  updateSiteLibraryEntry: (
    entryId: string,
    patch: Partial<
      Pick<
        SiteLibraryEntry,
        "name" | "position" | "groundElevationM" | "antennaHeightM" | "visibility" | "sharedWith"
      >
    >,
  ) => void;
  deleteSiteLibraryEntry: (entryId: string) => void;
  deleteSiteLibraryEntries: (entryIds: string[]) => void;
  saveCurrentSimulationPreset: (name: string) => string | null;
  overwriteSimulationPreset: (presetId: string) => void;
  loadSimulationPreset: (presetId: string) => void;
  renameSimulationPreset: (presetId: string, name: string) => void;
  updateSimulationPresetEntry: (
    presetId: string,
    patch: Partial<Pick<SimulationPreset, "name" | "visibility" | "sharedWith">>,
  ) => void;
  deleteSimulationPreset: (presetId: string) => void;
  importLibraryData: (
    bundle: { siteLibrary?: SiteLibraryEntry[]; simulationPresets?: SimulationPreset[] },
    mode: "merge" | "replace",
  ) => { siteCount: number; simulationCount: number };
  restoreLibrariesFromSnapshots: () => {
    restored: boolean;
    siteCount: number;
    simulationCount: number;
  };
  setEndpointPickTarget: (target: "from" | "to" | null) => void;
  requestSiteLibraryDraftAt: (lat: number, lon: number) => void;
  clearPendingSiteLibraryDraft: () => void;
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
  recomputeCoverage: (qualityOverride?: "auto" | "high") => void;
  getSelectedLink: () => Link;
  getSelectedSite: () => Site;
  getSelectedNetwork: () => Network;
  getSelectedSites: () => { fromSite: Site; toSite: Site };
  getSelectedAnalysis: () => LinkAnalysis;
  getSelectedProfile: () => ProfilePoint[];
};

const SITE_LIBRARY_KEY = "rmw-site-library-v1";
const SIM_PRESETS_KEY = "rmw-sim-presets-v1";
const STORAGE_SNAPSHOT_LIMIT = 24;

type StoredSnapshot<T> = {
  savedAtIso: string;
  value: T;
};

const snapshotKeyFor = (key: string): string => `${key}-snapshots-v1`;
const isSnapshotTrackedKey = (key: string): boolean => key === SITE_LIBRARY_KEY || key === SIM_PRESETS_KEY;

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readStorageRawState = <T,>(key: string): { status: "ok" | "missing" | "invalid"; value: T | null } => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { status: "missing", value: null };
    return { status: "ok", value: JSON.parse(raw) as T };
  } catch {
    return { status: "invalid", value: null };
  }
};

const readSnapshotHistory = <T,>(key: string): StoredSnapshot<T>[] => {
  const parsed = readStorage<StoredSnapshot<T>[]>(snapshotKeyFor(key), []);
  return Array.isArray(parsed) ? parsed : [];
};

const getLatestSnapshotValue = <T,>(key: string): T | null => {
  const history = readSnapshotHistory<T>(key);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item && typeof item === "object" && "value" in item) {
      return item.value;
    }
  }
  return null;
};

const appendSnapshot = (key: string, value: unknown) => {
  if (!isSnapshotTrackedKey(key)) return;
  const history = readSnapshotHistory<unknown>(key);
  const next: StoredSnapshot<unknown>[] = [
    ...history,
    {
      savedAtIso: new Date().toISOString(),
      value,
    },
  ].slice(-STORAGE_SNAPSHOT_LIMIT);
  localStorage.setItem(snapshotKeyFor(key), JSON.stringify(next));
};

const writeStorage = (key: string, value: unknown, options?: { snapshot?: boolean }) => {
  localStorage.setItem(key, JSON.stringify(value));
  if (options?.snapshot !== false) appendSnapshot(key, value);
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

const normalizeSimulationPresets = (presets: SimulationPreset[]): SimulationPreset[] =>
  presets.filter(
    (preset) =>
      Boolean(
        preset &&
          typeof preset.id === "string" &&
          preset.id &&
          typeof preset.name === "string" &&
          preset.name &&
          preset.snapshot,
      ),
  );

const ensureMinimumTopology = (
  inputSites: Site[],
  inputLinks: Link[],
  inputSystems: RadioSystem[],
  inputNetworks: Network[],
): {
  sites: Site[];
  links: Link[];
  systems: RadioSystem[];
  networks: Network[];
} => {
  const sites = inputSites.length > 0 ? inputSites : defaultScenario.sites;
  const systems = inputSystems.length > 0 ? inputSystems : defaultScenario.systems;
  const siteIds = new Set(sites.map((site) => site.id));
  const systemIds = new Set(systems.map((system) => system.id));

  const validLinks = inputLinks.filter((link) => siteIds.has(link.fromSiteId) && siteIds.has(link.toSiteId));
  const links =
    validLinks.length > 0
      ? validLinks
      : sites.length >= 2
        ? [
            {
              id: "link-1",
              fromSiteId: sites[0].id,
              toSiteId: sites[1].id,
              frequencyMHz: 869.618,
              txPowerDbm: 22,
              txGainDbi: 2,
              rxGainDbi: 2,
              cableLossDb: 1,
              name: `${sites[0].name} -> ${sites[1].name}`,
            },
          ]
        : defaultScenario.links;

  const validNetworks = inputNetworks
    .map((network) => ({
      ...network,
      memberships: network.memberships.filter(
        (member) => siteIds.has(member.siteId) && systemIds.has(member.systemId),
      ),
    }))
    .filter((network) => network.memberships.length > 0);

  const networks =
    validNetworks.length > 0
      ? validNetworks
      : [
          {
            id: "network-1",
            name: "Recovered Network",
            frequencyMHz: 869.618,
            bandwidthKhz: 62,
            spreadFactor: 8,
            codingRate: 5,
            frequencyOverrideMHz: 869.618,
            memberships: sites.map((site) => ({
              siteId: site.id,
              systemId: systems[0].id,
            })),
          },
        ];

  return { sites, links, systems, networks };
};

const siteLibraryRawState = readStorageRawState<SiteLibraryEntry[]>(SITE_LIBRARY_KEY);
const recoveredSiteLibraryRaw =
  siteLibraryRawState.status === "ok"
    ? siteLibraryRawState.value ?? []
    : ((getLatestSnapshotValue<SiteLibraryEntry[]>(SITE_LIBRARY_KEY) ?? []) as SiteLibraryEntry[]);
const initialSiteLibrary = normalizeSiteLibrary(Array.isArray(recoveredSiteLibraryRaw) ? recoveredSiteLibraryRaw : []);
if (
  siteLibraryRawState.status !== "ok" ||
  JSON.stringify(initialSiteLibrary) !== JSON.stringify(recoveredSiteLibraryRaw)
) {
  writeStorage(SITE_LIBRARY_KEY, initialSiteLibrary);
}

const simulationPresetsRawState = readStorageRawState<SimulationPreset[]>(SIM_PRESETS_KEY);
const recoveredSimulationPresetsRaw =
  simulationPresetsRawState.status === "ok"
    ? simulationPresetsRawState.value ?? []
    : ((getLatestSnapshotValue<SimulationPreset[]>(SIM_PRESETS_KEY) ?? []) as SimulationPreset[]);
const initialSimulationPresets = normalizeSimulationPresets(
  Array.isArray(recoveredSimulationPresetsRaw) ? recoveredSimulationPresetsRaw : [],
);
if (
  simulationPresetsRawState.status !== "ok" ||
  JSON.stringify(initialSimulationPresets) !== JSON.stringify(recoveredSimulationPresetsRaw)
) {
  writeStorage(SIM_PRESETS_KEY, initialSimulationPresets);
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
  propagationEnvironment: defaultPropagationEnvironment(),
  autoPropagationEnvironment: true,
  propagationEnvironmentReason: "Auto defaults active.",
  terrainDataset: "srtm1",
  terrainFetchStatus: "",
  terrainRecommendation: "",
  hasOnlineElevationSync: false,
  siteLibrary: initialSiteLibrary,
  simulationPresets: initialSimulationPresets,
  endpointPickTarget: null,
  pendingSiteLibraryDraft: null,
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
      propagationEnvironment: defaultPropagationEnvironment(),
      autoPropagationEnvironment: true,
      propagationEnvironmentReason: "Auto defaults active.",
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
  runHighQualitySimulation: () => {
    get().recomputeCoverage("high");
  },
  setSelectedFrequencyPresetId: (id) => set({ selectedFrequencyPresetId: id }),
  setRxSensitivityTargetDbm: (value) => set({ rxSensitivityTargetDbm: value }),
  setEnvironmentLossDb: (value) => set({ environmentLossDb: Math.max(0, value) }),
  setAutoPropagationEnvironment: (value) => {
    set({ autoPropagationEnvironment: value });
    get().recomputeCoverage();
  },
  setPropagationEnvironment: (patch) => {
    set((state) => ({
      propagationEnvironment: {
        ...state.propagationEnvironment,
        ...patch,
      },
      autoPropagationEnvironment: false,
      propagationEnvironmentReason: "Manual override active.",
    }));
    get().recomputeCoverage();
  },
  applyClimateDefaults: (climate) => {
    set((state) => ({
      propagationEnvironment: withClimateDefaults(state.propagationEnvironment, climate),
      autoPropagationEnvironment: false,
      propagationEnvironmentReason: "Manual climate defaults applied.",
    }));
    get().recomputeCoverage();
  },
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
    const fromSite = state.sites.find((site) => site.id === fromSiteId);
    const toSite = state.sites.find((site) => site.id === toSiteId);
    if (!fromSite || !toSite) return;
    const base = state.links[0];
    const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
    const inheritedFrequencyMHz = selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 869.618;
    const autoName = `${fromSite.name} -> ${toSite.name}`;
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
  addSiteLibraryEntry: (name, lat, lon, groundElevationM = 0, antennaHeightM = 2, sourceMeta) => {
    const label = name.trim() || `Library Site ${get().siteLibrary.length + 1}`;
    const entry: SiteLibraryEntry = {
      id: makeId("libsite"),
      name: label,
      visibility: "shared",
      sharedWith: [],
      position: { lat, lon },
      groundElevationM,
      antennaHeightM,
      createdAt: new Date().toISOString(),
      sourceMeta,
    };
    set((state) => {
      const next = normalizeSiteLibrary([entry, ...state.siteLibrary]);
      writeStorage(SITE_LIBRARY_KEY, next);
      return { siteLibrary: next };
    });
  },
  deleteLink: (linkId) => {
    set((state) => {
      const remaining = state.links.filter((link) => link.id !== linkId);
      if (!remaining.length) {
        if (state.sites.length < 2) return state;
        const base = state.links[0];
        const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
        const inheritedFrequencyMHz =
          selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? base?.frequencyMHz ?? 869.618;
        const fallbackLink: Link = {
          id: makeId("lnk"),
          name: "Auto Link",
          fromSiteId: state.sites[0].id,
          toSiteId: state.sites[1].id,
          frequencyMHz: inheritedFrequencyMHz,
          txPowerDbm: base?.txPowerDbm ?? 22,
          txGainDbi: base?.txGainDbi ?? 2,
          rxGainDbi: base?.rxGainDbi ?? 2,
          cableLossDb: base?.cableLossDb ?? 1,
        };
        return {
          links: [fallbackLink],
          selectedLinkId: fallbackLink.id,
        };
      }
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
    if (!presetName) return null;
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
      propagationEnvironment: state.propagationEnvironment,
      autoPropagationEnvironment: state.autoPropagationEnvironment,
      terrainDataset: state.terrainDataset,
      mapViewport: state.mapViewport,
    };

    set((current) => {
      const existing = current.simulationPresets.find((preset) => preset.name === presetName);
      const nextPreset: SimulationPreset = {
        id: existing?.id ?? makeId("sim"),
        name: presetName,
        visibility: existing?.visibility ?? "shared",
        sharedWith: existing?.sharedWith ?? [],
        updatedAt: new Date().toISOString(),
        snapshot,
      };
      const next = [nextPreset, ...current.simulationPresets.filter((preset) => preset.id !== nextPreset.id)];
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
    return get().simulationPresets[0]?.id ?? null;
  },
  overwriteSimulationPreset: (presetId) => {
    const state = get();
    const existing = state.simulationPresets.find((preset) => preset.id === presetId);
    if (!existing) return;
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
      propagationEnvironment: state.propagationEnvironment,
      autoPropagationEnvironment: state.autoPropagationEnvironment,
      terrainDataset: state.terrainDataset,
      mapViewport: state.mapViewport,
    };
    set((current) => {
      const nextPreset: SimulationPreset = {
        id: existing.id,
        name: existing.name,
        visibility: existing.visibility ?? "shared",
        sharedWith: existing.sharedWith ?? [],
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
    const recovered = ensureMinimumTopology(
      Array.isArray(snap.sites) ? snap.sites : [],
      Array.isArray(snap.links) ? snap.links : [],
      Array.isArray(snap.systems) ? snap.systems : [],
      Array.isArray(snap.networks) ? snap.networks : [],
    );
    const selectedSiteId = recovered.sites.some((site) => site.id === snap.selectedSiteId)
      ? snap.selectedSiteId
      : recovered.sites[0].id;
    const selectedLinkId = recovered.links.some((link) => link.id === snap.selectedLinkId)
      ? snap.selectedLinkId
      : recovered.links[0].id;
    const selectedNetworkId = recovered.networks.some((network) => network.id === snap.selectedNetworkId)
      ? snap.selectedNetworkId
      : recovered.networks[0].id;
    set({
      sites: recovered.sites,
      links: recovered.links,
      systems: recovered.systems,
      networks: recovered.networks,
      selectedSiteId,
      selectedLinkId,
      selectedNetworkId,
      selectedCoverageMode:
        snap.selectedCoverageMode === "BestSite" ||
        snap.selectedCoverageMode === "Polar" ||
        snap.selectedCoverageMode === "Cartesian" ||
        snap.selectedCoverageMode === "Route"
          ? snap.selectedCoverageMode
          : "BestSite",
      propagationModel:
        snap.propagationModel === "FSPL" || snap.propagationModel === "TwoRay" || snap.propagationModel === "ITM"
          ? snap.propagationModel
          : "ITM",
      selectedFrequencyPresetId: typeof snap.selectedFrequencyPresetId === "string" ? snap.selectedFrequencyPresetId : "custom",
      rxSensitivityTargetDbm:
        typeof snap.rxSensitivityTargetDbm === "number" ? snap.rxSensitivityTargetDbm : -120,
      environmentLossDb: typeof snap.environmentLossDb === "number" ? snap.environmentLossDb : 0,
      propagationEnvironment: snap.propagationEnvironment ?? defaultPropagationEnvironment(),
      autoPropagationEnvironment: snap.autoPropagationEnvironment ?? true,
      propagationEnvironmentReason: (snap.autoPropagationEnvironment ?? true)
        ? "Auto defaults active."
        : "Manual override active.",
      terrainDataset: snap.terrainDataset === "srtm3" || snap.terrainDataset === "srtm1" ? snap.terrainDataset : "srtm1",
      mapViewport:
        snap.mapViewport &&
        typeof snap.mapViewport.zoom === "number" &&
        snap.mapViewport.center &&
        typeof snap.mapViewport.center.lat === "number" &&
        typeof snap.mapViewport.center.lon === "number"
          ? snap.mapViewport
          : defaultScenario.viewport,
      terrainFetchStatus: `Loaded simulation preset: ${preset.name}`,
    });
    get().recomputeCoverage();
  },
  renameSimulationPreset: (presetId, name) => {
    const nextName = name.trim();
    if (!nextName) return;
    set((state) => {
      const next = state.simulationPresets.map((preset) =>
        preset.id === presetId
          ? {
              ...preset,
              name: nextName,
              updatedAt: new Date().toISOString(),
            }
          : preset,
      );
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
  },
  updateSimulationPresetEntry: (presetId, patch) => {
    set((state) => {
      const next = state.simulationPresets.map((preset) => {
        if (preset.id !== presetId) return preset;
        return {
          ...preset,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
      });
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
  },
  deleteSimulationPreset: (presetId) => {
    set((state) => {
      const next = state.simulationPresets.filter((preset) => preset.id !== presetId);
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
  },
  importLibraryData: (bundle, mode) => {
    const incomingSites = normalizeSiteLibrary(Array.isArray(bundle.siteLibrary) ? bundle.siteLibrary : []);
    const incomingPresets = normalizeSimulationPresets(
      Array.isArray(bundle.simulationPresets) ? bundle.simulationPresets : [],
    );
    const current = get();
    const siteCountBefore = current.siteLibrary.length;
    const simCountBefore = current.simulationPresets.length;

    const nextSiteLibrary =
      mode === "replace"
        ? incomingSites
        : normalizeSiteLibrary([...current.siteLibrary, ...incomingSites]);

    const nextSimulationPresets =
      mode === "replace"
        ? incomingPresets
        : (() => {
            const byId = new Map<string, SimulationPreset>();
            for (const preset of current.simulationPresets) byId.set(preset.id, preset);
            for (const preset of incomingPresets) byId.set(preset.id, preset);
            return normalizeSimulationPresets(Array.from(byId.values())).sort((a, b) =>
              a.updatedAt < b.updatedAt ? 1 : -1,
            );
          })();

    writeStorage(SITE_LIBRARY_KEY, nextSiteLibrary);
    writeStorage(SIM_PRESETS_KEY, nextSimulationPresets);
    set({
      siteLibrary: nextSiteLibrary,
      simulationPresets: nextSimulationPresets,
    });
    return {
      siteCount: nextSiteLibrary.length - siteCountBefore,
      simulationCount: nextSimulationPresets.length - simCountBefore,
    };
  },
  restoreLibrariesFromSnapshots: () => {
    const siteSnapshot = getLatestSnapshotValue<SiteLibraryEntry[]>(SITE_LIBRARY_KEY);
    const simulationSnapshot = getLatestSnapshotValue<SimulationPreset[]>(SIM_PRESETS_KEY);
    const nextSiteLibrary = normalizeSiteLibrary(Array.isArray(siteSnapshot) ? siteSnapshot : []);
    const nextSimulationPresets = normalizeSimulationPresets(
      Array.isArray(simulationSnapshot) ? simulationSnapshot : [],
    );
    const restored = nextSiteLibrary.length > 0 || nextSimulationPresets.length > 0;
    if (!restored) {
      return {
        restored: false,
        siteCount: 0,
        simulationCount: 0,
      };
    }
    writeStorage(SITE_LIBRARY_KEY, nextSiteLibrary);
    writeStorage(SIM_PRESETS_KEY, nextSimulationPresets);
    set({
      siteLibrary: nextSiteLibrary,
      simulationPresets: nextSimulationPresets,
    });
    return {
      restored: true,
      siteCount: nextSiteLibrary.length,
      simulationCount: nextSimulationPresets.length,
    };
  },
  setEndpointPickTarget: (target) => set({ endpointPickTarget: target }),
  requestSiteLibraryDraftAt: (lat, lon) =>
    set({
      pendingSiteLibraryDraft: {
        lat,
        lon,
        token: makeId("draft"),
      },
    }),
  clearPendingSiteLibraryDraft: () => set({ pendingSiteLibraryDraft: null }),
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
      const message = getUiErrorMessage(error);
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
      const message = getUiErrorMessage(error);
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
  recomputeCoverage: (qualityOverride = "auto") => {
    const runQuality = qualityOverride;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    set({
      simulationRunToken: runId,
      isSimulationRecomputing: true,
      simulationProgress: 3,
      coverageResolutionMode: runQuality,
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
        links,
        selectedLinkId,
        autoPropagationEnvironment,
        propagationEnvironment,
      } = state;
      const network = networks.find((n) => n.id === selectedNetworkId);
      if (!network) {
        const finalize = () => {
          if (get().simulationRunToken !== runId) return;
          set({
            coverageSamples: [],
            isSimulationRecomputing: false,
            simulationProgress: 100,
            coverageResolutionMode: "auto",
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
              from: fromSite.position,
              to: toSite.position,
              fromGroundM: fromSite.groundElevationM,
              toGroundM: toSite.groundElevationM,
              terrainSampler: ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
            })
          : null;
      const effectiveEnvironment = autoDerived?.environment ?? propagationEnvironment;
      if (autoDerived) {
        set({
          propagationEnvironment: autoDerived.environment,
          propagationEnvironmentReason: autoDerived.reason,
        });
      }

      set({ simulationProgress: 8 });
      const coverageSamples = buildCoverage(
        selectedCoverageMode,
        network,
        sites,
        systems,
        propagationModel,
        effectiveEnvironment,
        ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
        {
          sampleMultiplier: runQuality === "high" ? 4 : 1,
          terrainSamples: runQuality === "high" ? 72 : 20,
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
          coverageResolutionMode: "auto",
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
    return link ?? links[0] ?? defaultScenario.links[0];
  },
  getSelectedSite: () => {
    const { sites, selectedSiteId } = get();
    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    return site ?? sites[0] ?? defaultScenario.sites[0];
  },
  getSelectedNetwork: () => {
    const { networks, selectedNetworkId } = get();
    const network = networks.find((candidate) => candidate.id === selectedNetworkId);
    return network ?? networks[0] ?? defaultScenario.networks[0];
  },
  getSelectedSites: () => {
    const { sites, getSelectedLink } = get();
    const link = getSelectedLink();
    const fromSite = sites.find((s) => s.id === link.fromSiteId);
    const toSite = sites.find((s) => s.id === link.toSiteId);
    return {
      fromSite: fromSite ?? sites[0] ?? defaultScenario.sites[0],
      toSite: toSite ?? sites[Math.min(1, Math.max(0, sites.length - 1))] ?? defaultScenario.sites[1],
    };
  },
  getSelectedAnalysis: () => {
    const {
      getSelectedLink,
      getSelectedNetwork,
      getSelectedSites,
      propagationModel,
      srtmTiles,
      coverageResolutionMode,
      autoPropagationEnvironment,
      propagationEnvironment,
    } = get();
    const link = getSelectedLink();
    const selectedNetwork = getSelectedNetwork();
    const effectiveLink = {
      ...link,
      frequencyMHz: selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz,
    };
    const { fromSite, toSite } = getSelectedSites();
    const autoDerived = autoPropagationEnvironment
      ? deriveDynamicPropagationEnvironment({
          from: fromSite.position,
          to: toSite.position,
          fromGroundM: fromSite.groundElevationM,
          toGroundM: toSite.groundElevationM,
          terrainSampler: ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
        })
      : null;
    return analyzeLink(
      effectiveLink,
      fromSite,
      toSite,
      propagationModel,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      {
        terrainSamples: coverageResolutionMode === "high" ? 80 : 32,
        environment: autoDerived?.environment ?? propagationEnvironment,
      },
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
