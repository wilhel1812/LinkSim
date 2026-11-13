import type { SiteLaunch } from "../lib/siteLaunch";
import { create } from "zustand";
import { readLibraryRecoveryStorage, writeLibraryRecoveryStorage } from "../lib/libraryRecoveryStorage";
import { clearTerrainLossCache } from "../lib/coverage";
import { normalizeCoverageResolution } from "../lib/coverageResolution";
import { setAppStoreBridge, useCoverageStore } from "./coverageStore";
import { NARROW_FAST_DEFAULT_PRESET as defaultRadioPreset } from "../lib/frequencyPresets.data";
import { findPresetById } from "../lib/frequencyPlans";
import {
  FALLBACK_SIMULATION_PRESET_ID,
  findCustomRadioPreset,
  normalizeSimulationDefaults,
  resolveUserSimulationDefaults,
  simulationDefaultsFromPreset,
  type SimulationDefaults,
} from "../lib/simulationDefaults";
import { resolveTrackedSiteOrientation, resolveTrackedSiteOrientations } from "../lib/antennaPattern";
import { getUiErrorMessage } from "../lib/uiError";
import { canDeleteLibraryItem } from "../lib/libraryFilters";
import {
  deleteCloudSite,
  deleteCloudSimulation,
  fetchCloudLibrary,
  pushCloudLibrary,
  type LibraryWriteReceipt,
  restoreCloudSimulation,
} from "../lib/cloudLibrary";
import {
  migrateSitesAndLinksToSiteRadioDefaults,
  resolveLinkRadio,
  STANDARD_SITE_RADIO,
  stripRedundantLinkRadioOverrides,
  withSiteRadioDefaults,
} from "../lib/linkRadio";
import {
  deriveDynamicPropagationEnvironment,
  withClimateDefaults,
} from "../lib/propagationEnvironment";
import { analyzeLink, buildProfile } from "../lib/propagation";
import { BUILTIN_SCENARIOS, defaultScenario, DEMO_SCENARIO, getScenarioById } from "../lib/scenarios";
import { boundsToViewport, simulationAreaBoundsForSites } from "../lib/simulationArea";
import { longitudeBoundsForCoordinates, tilesForBounds } from "../lib/terrainTiles";
import { mergeSrtmTiles } from "../lib/terrainMerge";
import { sampleSrtmElevation } from "../lib/srtm";
import { DEFAULT_BASEMAP_STYLE_ID, BASEMAP_STYLE_REGISTRY } from "../lib/basemaps";
import {
  clearCopernicusCache,
  loadCopernicus30TilesByKeys,
  type CopernicusTileProgress,
} from "../lib/copernicusTerrainClient";
import {
  normalizeTerrainDataset,
  type TerrainDataset,
} from "../lib/terrainDataset";
import { atmosphericBendingNUnitsToKFactor } from "../lib/terrainLoss";
import {
  COPERNICUS_30_TILE_DECODED_BYTES,
  estimateTerrainMemoryDiagnostics,
  type TerrainMemoryDiagnostics,
} from "../lib/terrainMemory";
import {
  defaultOptionForSelectionCount,
  isOverlayRadiusOption,
  type SimulationOverlayRadiusOption,
} from "../lib/simulationOverlayRadius";
import type { LocaleCode } from "../i18n/locales";
import type { UiColorTheme } from "../themes/types";
import {
  DEFAULT_LINK_COLOR_MODE,
  normalizeLinkColorMode,
  normalizeSimulationColor,
  normalizeSiteIconColors,
  type LinkColorMode,
} from "../lib/simulationColors";
import { getActiveHolidayTheme } from "../themes/holidayThemes";
import type { CloudUser } from "../lib/cloudUser";
import type { MeshmapNode } from "../lib/meshtasticMqtt";
import type { MapOverlayMode as MapOverlayModeValue } from "../lib/mapOverlayMode";
import { isSiteIconKey, type SiteIconKey } from "../lib/siteIcons";
import { partitionLibraryPayload, type RejectedLibraryRecord } from "../lib/libraryLimits";
import type {
  CoverageResolution,
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

type HolidayThemeWindowState = {
  reverted: string[];
  dismissed: string[];
};

const SYNC_DEBOUNCE_MS = 2500;
const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";
const SYNC_DIGEST_KEY = "linksim-sync-digest-v2";
try { localStorage.removeItem("linksim-sync-signature-v1"); } catch { /* Storage may be unavailable. */ }
const LIBRARY_QUARANTINE_KEY = "linksim-library-quarantine-v1";
const MIGRATION_DEFAULT_PRIVATE_KEY = "linksim-migration-default-private-v2";

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

let syncTimer: number | null = null;
let syncInFlight = false;
let syncAccountGeneration = 0;
let accountLibraryPreparation: Promise<boolean | null> | null = null;
let accountLibraryPreparationPending = false;
let accountLibraryPreparationTarget: string | null = null;
let accountLibraryStorageBlocked = false;
const waitForAccountLibraryPreparation = async (): Promise<boolean> => {
  const generation = syncAccountGeneration;
  const prepared = accountLibraryPreparation ? await accountLibraryPreparation : true;
  return prepared !== false && prepared !== null && generation === syncAccountGeneration && !accountLibraryStorageBlocked;
};
let localMutationRevision = 0;
const LAST_FETCHED_AT_KEY = "linksim-last-fetched-at-v1";
const storeLibraryCheckpoint = (syncCutoff: string | undefined): void => {
  if (!syncCutoff) return;
  try { localStorage.setItem(LAST_FETCHED_AT_KEY, syncCutoff); } catch { /* ignore */ }
};

const PENDING_LIBRARY_KEY = "linksim-library-pending-v1";
type PendingLibrary = { sites: string[]; simulations: string[] };
const readPendingLibrary = (value: Partial<PendingLibrary> | null): PendingLibrary => ({
  sites: Array.isArray(value?.sites) ? value.sites.filter((id) => typeof id === "string") : [],
  simulations: Array.isArray(value?.simulations) ? value.simulations.filter((id) => typeof id === "string") : [],
});
const initialPendingLibrary = readPendingLibrary(readStorage(PENDING_LIBRARY_KEY, null));
let dirtySiteIds = new Set(initialPendingLibrary.sites);
let dirtySimIds = new Set(initialPendingLibrary.simulations);
localMutationRevision = dirtySiteIds.size + dirtySimIds.size;

const pendingLibrary = (): PendingLibrary => ({
  sites: [...dirtySiteIds], simulations: [...dirtySimIds],
});
const persistPendingLibrary = (): void => { writeStorage(PENDING_LIBRARY_KEY, pendingLibrary()); };

const markDirtySite = (id: string): void => {
  dirtySiteIds.add(id);
  localMutationRevision += 1;
  persistPendingLibrary();
};

const markDirtySim = (id: string): void => {
  dirtySimIds.add(id);
  localMutationRevision += 1;
  persistPendingLibrary();
};

const pendingLibraryState = () => {
  const pendingChangesCount = dirtySiteIds.size + dirtySimIds.size;
  return { pendingChangesCount, syncPending: pendingChangesCount > 0 };
};

const pendingSimulationMutation = (
  id: string, siteLibrary?: SiteLibraryEntry[],
) => {
  if (siteLibrary) {
    const existingIds = new Set(useAppStore.getState().siteLibrary.map((site) => site.id));
    for (const site of siteLibrary) {
      if (!existingIds.has(site.id)) markDirtySite(site.id);
    }
  }
  markDirtySim(id);
  return pendingLibraryState();
};

const resolveDescriptionUpdate = (
  currentDescription: string | undefined,
  descriptionPatch: string | undefined,
): string | undefined =>
  typeof descriptionPatch === "string"
    ? descriptionPatch.trim() || undefined
    : currentDescription;

const canEditLibraryItem = (
  item: {
    ownerUserId?: string;
    effectiveRole?: string;
    sharedWith?: Array<{ userId: string; role: string }>;
  },
  currentUser: CloudUser | null,
): boolean => {
  if (!currentUser) return false;
  if (item.effectiveRole === "viewer") return false;
  if (item.ownerUserId === currentUser.id) return true;
  if (currentUser.isAdmin) return true;
  if (!item.ownerUserId) return item.effectiveRole === "owner";
  if (item.effectiveRole !== "admin" && item.effectiveRole !== "editor") return false;
  return Boolean(item.sharedWith?.some((grant) =>
    grant.userId === currentUser.id && (grant.role === "admin" || grant.role === "editor"),
  ));
};

const requireAuth = (currentUser: CloudUser | null, action: string): CloudUser | null => {
  if (!currentUser?.id) {
    console.warn(`[appStore] ${action}: Auth required - user not logged in`);
    return null;
  }
  return currentUser;
};

const resolveDefaultFrequencyPresetIdForNewSimulation = (currentUser: CloudUser | null): string => {
  return resolveUserSimulationDefaults(
    currentUser?.simulationDefaultsPreference,
    currentUser?.defaultFrequencyPresetId,
  ).frequencyPresetId;
};

const resolveEffectiveSimulationDefaultsForSnapshot = (
  snapshot: Partial<SimulationPreset["snapshot"]> | undefined,
  currentUser: CloudUser | null,
): SimulationDefaults => {
  if (snapshot?.simulationDefaultsOverrideEnabled && snapshot.simulationDefaultsOverride) {
    return normalizeSimulationDefaults(snapshot.simulationDefaultsOverride);
  }
  return resolveUserSimulationDefaults(currentUser?.simulationDefaultsPreference, currentUser?.defaultFrequencyPresetId);
};

const isAuthRelatedErrorMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("access denied") ||
    normalized.includes("auth") ||
    normalized.includes("sign in") ||
    normalized.includes("session revoked")
  );
};

const canEditItem = canEditLibraryItem;

const canEditActiveSavedSimulation = (
  currentUser: CloudUser | null,
  selectedScenarioId: string,
  simulationPresets: SimulationPreset[],
): boolean => {
  if (!selectedScenarioId) return true;
  if (BUILTIN_SCENARIOS.some((scenario) => scenario.id === selectedScenarioId)) return true;
  const selectedPreset = simulationPresets.find((preset) => preset.id === selectedScenarioId);
  if (!selectedPreset) return false;
  return canEditItem(selectedPreset, currentUser);
};

export type MapOverlayMode = MapOverlayModeValue;
export type AuthSessionState = "checking" | "signed_in" | "signed_out";
export type LibraryTab = "sites" | "simulations";

type SiteLibraryEntry = {
  id: string;
  cloudRevision?: string | null;
  name: string;
  description?: string;
  visibility?: "private" | "public" | "shared";
  sharedWith?: Array<{ userId: string; role: "viewer" | "editor" | "admin" }>;
  ownerUserId?: string;
  effectiveRole?: "owner" | "admin" | "editor" | "viewer";
  createdByUserId?: string;
  createdByName?: string;
  createdByAvatarUrl?: string;
  lastEditedByUserId?: string;
  lastEditedByName?: string;
  lastEditedByAvatarUrl?: string;
  position: { lat: number; lon: number };
  groundElevationM: number;
  antennaHeightM: number;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
  antennaMode?: Site["antennaMode"];
  antennaAzimuthDeg?: number;
  antennaTiltDeg?: number;
  antennaHorizontalBeamwidthDeg?: number;
  antennaVerticalBeamwidthDeg?: number;
  antennaMaxAttenuationDb?: number;
  iconKey?: SiteIconKey;
  createdAt: string;
  sourceMeta?: {
    sourceType: string;
    sourceUrl?: string;
    sourceLabel?: string;
    nodeId?: string;
    shortName?: string;
    longName?: string;
    hwModel?: string;
    role?: string;
    importedAt?: string;
    syncedAt?: string;
  };
};

type SimulationPreset = {
  id: string;
  cloudRevision?: string | null;
  name: string;
  description?: string;
  slug?: string;
  slugAliases?: string[];
  visibility?: "private" | "public" | "shared";
  sharedWith?: Array<{ userId: string; role: "viewer" | "editor" | "admin" }>;
  ownerUserId?: string;
  effectiveRole?: "owner" | "admin" | "editor" | "viewer";
  status?: "active" | "deleted";
  createdByUserId?: string;
  createdByName?: string;
  createdByAvatarUrl?: string;
  lastEditedByUserId?: string;
  lastEditedByName?: string;
  lastEditedByAvatarUrl?: string;
  updatedAt: string;
  snapshot: {
    sites: Site[];
    links: Link[];
    systems: RadioSystem[];
    networks: Network[];
    selectedSiteId: string;
    selectedLinkId: string;
    selectedNetworkId: string;
    selectedCoverageResolution?: CoverageResolution;
    selectedOverlayRadiusOption?: SimulationOverlayRadiusOption;
    propagationModel: PropagationModel;
    selectedFrequencyPresetId: string;
    rxSensitivityTargetDbm: number;
    environmentLossDb: number;
    propagationEnvironment: PropagationEnvironment;
    autoPropagationEnvironment: boolean;
    terrainDataset: TerrainDataset;
    mapViewport?: MapViewport;
    simulationDefaultsOverrideEnabled?: boolean;
    simulationDefaultsOverride?: SimulationDefaults;
    linkColorMode?: LinkColorMode;
    siteIconColors?: Record<string, string>;
  };
};

type SyncPayload = {
  siteLibrary: SiteLibraryEntry[];
  simulationPresets: SimulationPreset[];
};

const detachDeletedSiteLibraryReferences = <T extends { libraryEntryId?: string }>(
  sites: T[],
  deletedIds: ReadonlySet<string>,
): T[] => sites.map((site) => {
  if (!site.libraryEntryId || !deletedIds.has(site.libraryEntryId)) return site;
  const detached = { ...site };
  delete detached.libraryEntryId;
  return detached;
});

const detachDeletedSiteReferencesFromPresets = (
  presets: SimulationPreset[],
  deletedIds: ReadonlySet<string>,
): SimulationPreset[] => presets.map((preset) => {
  if (!Array.isArray(preset.snapshot?.sites)) return preset;
  return {
    ...preset,
    snapshot: {
      ...preset.snapshot,
      sites: detachDeletedSiteLibraryReferences(preset.snapshot.sites, deletedIds),
    },
  };
});

const removedEditsKey = (userId: string): string => `linksim-library-removed-edits-v1:${userId}`;
const removedEditsMessage = "A Site or Simulation was removed from your cloud Library. Your unsynced edits were kept in this browser’s Library recovery storage.";
const preserveRemovedEdits = async (state: AppState, siteIds: string[], simulationIds: string[]): Promise<void> => {
  if (!state.currentUser) return;
  const siteLibrary = state.siteLibrary.filter(({ id }) => dirtySiteIds.has(id) && siteIds.includes(id));
  const simulationPresets = state.simulationPresets.filter(({ id }) => dirtySimIds.has(id) && simulationIds.includes(id));
  if (!siteLibrary.length && !simulationPresets.length) return;
  const key = removedEditsKey(state.currentUser.id);
  const previous = await readLibraryRecoveryStorage<SyncPayload>(key);
  const saved = await writeLibraryRecoveryStorage(key, {
    siteLibrary: dedupeLibraryEntries([...siteLibrary, ...(previous?.siteLibrary ?? [])]),
    simulationPresets: dedupeLibraryEntries([...simulationPresets, ...(previous?.simulationPresets ?? [])]),
  });
  if (!saved) throw new Error("LinkSim could not preserve unsynced edits to records removed from the cloud. Free up browser storage and try again.");
};

const applyCloudRemovals = async (
  get: () => AppState, isCurrentAccount: () => boolean, siteIds: string[], simulationIds: string[],
): Promise<boolean> => {
  if (!siteIds.length && !simulationIds.length) return isCurrentAccount();
  for (;;) {
    const revision = localMutationRevision;
    await preserveRemovedEdits(get(), siteIds, simulationIds);
    if (!isCurrentAccount()) return false;
    if (revision === localMutationRevision) {
      get().applyDeletedSiteTombstones(siteIds);
      get().applyDeletedSimulationTombstones(simulationIds);
      return true;
    }
  }
};

const recordSimulationConflicts = (error: unknown): void => {
  if (!(error instanceof Error) || !("simulationIds" in error) || !Array.isArray(error.simulationIds)) return;
  const ids = error.simulationIds.filter((id): id is string => typeof id === "string" && dirtySimIds.has(id));
  if (!ids.length) return;
  useAppStore.setState((state) => ({
    simulationConflictIds: [...new Set([...state.simulationConflictIds, ...ids])],
  }));
};

const newPrivateSimulationCopy = (
  user: CloudUser, name: string, snapshot: SimulationPreset["snapshot"], description?: string,
): SimulationPreset => ({
  id: makeId("sim"),
  name,
  description,
  slug: slugifyValue(name),
  slugAliases: [],
  visibility: "private",
  sharedWith: [],
  ownerUserId: user.id,
  effectiveRole: "owner",
  createdByUserId: user.id,
  createdByName: user.username,
  createdByAvatarUrl: user.avatarUrl ?? "",
  lastEditedByUserId: user.id,
  lastEditedByName: user.username,
  lastEditedByAvatarUrl: user.avatarUrl ?? "",
  updatedAt: new Date().toISOString(),
  snapshot,
});

const buildDeltaSyncPayload = (state: AppState): SyncPayload => ({
  siteLibrary: state.siteLibrary.filter((site) => dirtySiteIds.has(site.id) && canEditLibraryItem(site, state.currentUser)),
  simulationPresets: state.simulationPresets.filter((sim) =>
    dirtySimIds.has(sim.id) && sim.status !== "deleted" && canEditLibraryItem(sim, state.currentUser)),
});

const acknowledgeLibraryWrites = (payload: SyncPayload, receipts?: LibraryWriteReceipt[]): void => {
  if (receipts?.length === 0) return;
  const state = useAppStore.getState();
  const siteReceipts = new Map((receipts ?? []).filter(({ kind }) => kind === "site").map(({ id, revision }) => [id, revision]));
  const simReceipts = new Map((receipts ?? []).filter(({ kind }) => kind === "simulation").map(({ id, revision }) => [id, revision]));
  const acknowledge = <T extends { id: string; cloudRevision?: string | null }>(
    entries: T[], sent: T[], revisions: Map<string, string>, dirty: Set<string>,
  ): T[] => entries.map((entry) => {
    const saved = sent.find(({ id }) => id === entry.id);
    const revision = revisions.get(entry.id);
    if (!saved || (receipts && !revision) || entry.cloudRevision !== saved.cloudRevision) return entry;
    if (JSON.stringify(entry) === JSON.stringify(saved)) dirty.delete(entry.id);
    return revision ? { ...entry, cloudRevision: revision } : entry;
  });
  const siteLibrary = acknowledge(state.siteLibrary, payload.siteLibrary, siteReceipts, dirtySiteIds);
  const simulationPresets = acknowledge(state.simulationPresets, payload.simulationPresets, simReceipts, dirtySimIds);
  writeStorage(SITE_LIBRARY_KEY, siteLibrary);
  writeStorage(SIM_PRESETS_KEY, simulationPresets);
  persistPendingLibrary();
  const pendingChangesCount = dirtySiteIds.size + dirtySimIds.size;
  useAppStore.setState({ siteLibrary, simulationPresets, pendingChangesCount, syncPending: pendingChangesCount > 0,
    simulationConflictIds: state.simulationConflictIds.filter((id) => dirtySimIds.has(id)) });
};

type AppState = {
  sites: Site[];
  links: Link[];
  systems: RadioSystem[];
  networks: Network[];
  srtmTiles: SrtmTile[];
  fitSitesEpoch: number;
  isTerrainFetching: boolean;
  isEditorTerrainFetching: boolean;
  isTerrainRecommending: boolean;
  selectedLinkId: string;
  profileCursorIndex: number;
  temporaryDirectionReversed: boolean;
  linkColorMode: LinkColorMode;
  siteIconColors: Record<string, string>;
  selectedSiteId: string;
  selectedSiteIds: string[];
  selectedNetworkId: string;
  selectedCoverageResolution: CoverageResolution;
  selectedOverlayRadiusOption: SimulationOverlayRadiusOption;
  propagationModel: PropagationModel;
  mapViewport?: MapViewport;
  locale: LocaleCode;
  uiThemePreference: "system" | "light" | "dark";
  uiColorTheme: UiColorTheme;
  holidayWindowState: HolidayThemeWindowState;
  basemapStyleId: string;
  selectedScenarioId: string;
  selectedFrequencyPresetId: string;
  rxSensitivityTargetDbm: number;
  environmentLossDb: number;
  propagationEnvironment: PropagationEnvironment;
  autoPropagationEnvironment: boolean;
  propagationEnvironmentReason: string;
  simulationDefaultsOverrideEnabled: boolean;
  simulationDefaultsOverride: SimulationDefaults | null;
  terrainDataset: TerrainDataset;
  terrainFetchStatus: string;
  terrainRecommendation: string;
  isHighResTerrainLoaded: boolean;
  terrainLoadingStartedAtMs: number;
  terrainLoadEpoch: number;
  terrainProgressPercent: number;
  terrainProgressTilesLoaded: number;
  terrainProgressTilesTotal: number;
  terrainProgressBytesLoaded: number;
  terrainProgressBytesEstimated: number;
  terrainProgressTransientDecodeBytesEstimated: number;
  terrainProgressPhaseLabel: string;
  terrainProgressPhaseIndex: number;
  terrainProgressPhaseTotal: number;
  terrainMemoryDiagnostics: TerrainMemoryDiagnostics;
  siteLibrary: SiteLibraryEntry[];
  simulationPresets: SimulationPreset[];
  siteDragPreview: Record<string, { position: { lat: number; lon: number }; groundElevationM: number }>;
  endpointPickTarget: "from" | "to" | null;
  mapEditor: {
    kind: "site" | "link" | "simulation";
    resourceId: string | null;
    isNew: boolean;
    label: string;
    anchorRect: {
      top: number;
      right: number;
      bottom: number;
      left: number;
      width: number;
      height: number;
    };
    siteSeed?: {
      lat?: number;
      lon?: number;
      name?: string;
      sourceMeta?: SiteLibraryEntry["sourceMeta"];
      insertIntoSimulation?: boolean;
      awaitMapClick?: boolean;
    };
    temporarySiteId?: string;
    simulationSeed?: {
      name?: string;
      description?: string;
      frequencyPresetId?: string;
      autoPropagationEnvironment?: boolean;
      copyCurrentSimulation?: boolean;
      simulationDefaultsOverrideEnabled?: boolean;
      simulationDefaultsOverride?: SimulationDefaults | null;
    };
    readOnly?: boolean;
    origin?: { kind: "library"; tab: LibraryTab };
  } | null;
  mapEditorSiteDraft: {
    lat: number;
    lon: number;
    groundElevationM: number | null;
    antennaMode?: Site["antennaMode"];
    antennaAzimuthDeg?: number;
    antennaHorizontalBeamwidthDeg?: number;
  } | null;
  openMapEditor: (payload: NonNullable<AppState["mapEditor"]>) => void;
  closeMapEditor: () => void;
  setMapEditorSiteDraft: (draft: AppState["mapEditorSiteDraft"]) => void;
  libraryRequest: { tab: LibraryTab } | null;
  showNewSimulationRequest: boolean;
  pendingSiteLibraryDraft:
    | { lat: number; lon: number; token: string; suggestedName?: string; sourceMeta?: SiteLibraryEntry["sourceMeta"] }
    | null;
  pendingSiteLibraryOpenEntryId: string | null;
  scenarioOptions: { id: string; name: string }[];
  mapOverlayMode: MapOverlayMode;
  discoveryLibraryVisible: boolean;
  discoveryMqttVisible: boolean;
  mapDiscoveryMqttNodes: MeshmapNode[];
  syncStatus: "syncing" | "synced" | "error";
  syncPending: boolean;
  pendingChangesCount: number;
  isOnline: boolean;
  lastSyncedAt: string | null;
  syncErrorMessage: string | null;
  syncTrigger: number;
  syncBusy: boolean;
  syncStatusMessage: string;
  currentUser: CloudUser | null;
  authState: AuthSessionState;
  libraryHydrated: boolean;
  isInitializing: boolean;
  initializeCloudSync: (options?: { restoreWorkspace?: boolean }) => Promise<void>;
  performCloudSyncPush: () => void;
  saveSimulationToCloud: (id: string) => Promise<void>;
  simulationConflictIds: string[];
  saveConflictCopyAndReload: (id: string) => Promise<string>;
  performManualCloudSync: () => Promise<void>;
  setLocale: (locale: LocaleCode) => void;
  setSyncStatus: (status: "syncing" | "synced" | "error") => void;
  setLastSyncedAt: (iso: string | null) => void;
  setSyncErrorMessage: (message: string | null) => void;
  // true: prepared, false: storage failure, null: superseded account change.
  setCurrentUser: (user: CloudUser | null) => Promise<boolean | null>;
  getDefaultFrequencyPresetIdForNewSimulation: () => string;
  setAuthState: (value: AuthSessionState) => void;
  setIsOnline: (value: boolean) => void;
  triggerSync: () => void;
  setIsInitializing: (value: boolean) => void;
  setUiThemePreference: (value: "system" | "light" | "dark") => void;
  setUiColorTheme: (value: UiColorTheme) => void;
  revertHolidayThemeForWindow: () => void;
  dismissHolidayThemeNotice: () => void;
  setBasemapStyleId: (value: string) => void;
  selectScenario: (id: string) => void;
  loadDemoScenario: () => void;
  requestFitToSites: () => void;
  setSelectedLinkId: (id: string) => void;
  setTemporaryDirectionReversed: (value: boolean) => void;
  toggleTemporaryDirectionReversed: () => void;
  setProfileCursorIndex: (index: number) => void;
  setSelectedSiteId: (id: string) => void;
  selectSiteById: (id: string, additive?: boolean) => void;
  clearActiveSelection: () => void;
  getSelectedSiteIds: () => string[];
  setSelectedNetworkId: (id: string) => void;
  setSelectedCoverageResolution: (resolution: CoverageResolution) => void;
  setSelectedOverlayRadiusOption: (value: SimulationOverlayRadiusOption) => void;
  setSelectedFrequencyPresetId: (id: string) => void;
  setRxSensitivityTargetDbm: (value: number) => void;
  setEnvironmentLossDb: (value: number) => void;
  setAutoPropagationEnvironment: (value: boolean) => void;
  setPropagationEnvironment: (patch: Partial<PropagationEnvironment>) => void;
  applyClimateDefaults: (climate: PropagationEnvironment["radioClimate"]) => void;
  setSimulationDefaultsOverrideEnabled: (value: boolean) => void;
  setSimulationDefaultsOverride: (value: SimulationDefaults) => void;
  getEffectiveSimulationDefaults: () => SimulationDefaults;
  addSiteByCoordinates: (name: string, lat: number, lon: number) => void;
  deleteSite: (siteId: string) => void;
  createLink: (fromSiteId: string, toSiteId: string, name?: string, color?: string | null) => void;
  deleteLink: (linkId: string) => void;
  addSiteLibraryEntry: (
    name: string,
    lat: number,
    lon: number,
    groundElevationM?: number,
    antennaHeightM?: number,
    txPowerDbm?: number,
    txGainDbi?: number,
    rxGainDbi?: number,
    cableLossDb?: number,
    sourceMeta?: SiteLibraryEntry["sourceMeta"],
    visibility?: "private" | "public" | "shared",
    description?: string,
    iconKey?: SiteIconKey,
    createdBy?: {
      userId: string;
      name: string;
      avatarUrl?: string;
    },
  ) => string;
  insertSiteFromLibrary: (entryId: string) => void;
  insertSitesFromLibrary: (entryIds: string[]) => void;
  updateSiteLibraryEntry: (
    entryId: string,
    patch: Partial<
      Pick<
        SiteLibraryEntry,
        | "name"
        | "description"
        | "position"
        | "groundElevationM"
        | "antennaHeightM"
        | "txPowerDbm"
        | "txGainDbi"
        | "rxGainDbi"
        | "cableLossDb"
        | "antennaMode"
        | "antennaAzimuthDeg"
        | "antennaTiltDeg"
        | "antennaHorizontalBeamwidthDeg"
        | "antennaVerticalBeamwidthDeg"
        | "antennaMaxAttenuationDb"
        | "iconKey"
        | "visibility"
        | "sharedWith"
      >
    >,
  ) => void;
  deleteSiteLibraryEntry: (entryId: string) => Promise<void>;
  deleteSiteLibraryEntries: (entryIds: string[]) => Promise<void>;
  saveCurrentSimulationPreset: (name: string) => string | null;
  createSimulationCopyFromCurrent: (
    name: string,
    options?: {
      description?: string;
      frequencyPresetId?: string;
      autoPropagationEnvironment?: boolean;
      simulationDefaultsOverrideEnabled?: boolean;
      simulationDefaultsOverride?: SimulationDefaults | null;
      linkColorMode?: LinkColorMode;
      siteIconColors?: Record<string, string>;
    },
  ) => string | null;
  createBlankSimulationPreset: (
    name: string,
    options?: {
      description?: string;
      frequencyPresetId?: string;
      autoPropagationEnvironment?: boolean;
      visibility?: "private" | "public" | "shared";
      ownerUserId?: string;
      createdByUserId?: string;
      createdByName?: string;
      createdByAvatarUrl?: string;
      lastEditedByUserId?: string;
      lastEditedByName?: string;
      lastEditedByAvatarUrl?: string;
      linkColorMode?: LinkColorMode;
      siteIconColors?: Record<string, string>;
    },
  ) => string | null;
  overwriteSimulationPreset: (presetId: string) => void;
  updateCurrentSimulationSnapshot: () => void;
  loadSimulationPreset: (presetId: string) => void;
  clearSimulationWorkspace: (launch?: SiteLaunch) => void;
  siteLaunch: { siteId: string; source?: SiteLaunch["source"]; needsElevation: boolean } | null;
  workspaceNavigationEpoch: number;
  renameSimulationPreset: (presetId: string, name: string) => void;
  updateSimulationPresetEntry: (
    presetId: string,
    patch: Partial<Pick<SimulationPreset, "name" | "description" | "visibility" | "sharedWith">> & {
      simulationDefaultsOverrideEnabled?: boolean;
      simulationDefaultsOverride?: SimulationDefaults | null;
      linkColorMode?: LinkColorMode;
      siteIconColors?: Record<string, string>;
    },
  ) => void;
  deleteSimulationPreset: (presetId: string) => Promise<void>;
  restoreSimulationPreset: (presetId: string) => Promise<void>;
  applyDeletedSimulationTombstones: (presetIds: string[]) => void;
  applyDeletedSiteTombstones: (siteIds: string[]) => void;
  importLibraryData: (
    bundle: { siteLibrary?: SiteLibraryEntry[]; simulationPresets?: SimulationPreset[] },
    mode: "merge" | "replace",
    source?: "trusted-cloud" | "public-view-only",
  ) => { siteCount: number; simulationCount: number };
  setEndpointPickTarget: (target: "from" | "to" | null) => void;
  requestSiteLibraryDraftAt: (
    lat: number,
    lon: number,
    suggestedName?: string,
    sourceMeta?: SiteLibraryEntry["sourceMeta"],
  ) => void;
  clearPendingSiteLibraryDraft: () => void;
  openLibrary: (tab: LibraryTab) => void;
  closeLibrary: () => void;
  setShowNewSimulationRequest: (show: boolean) => void;
  requestOpenSiteLibraryEntry: (entryId: string) => void;
  clearOpenSiteLibraryEntryRequest: () => void;
  setMapOverlayMode: (mode: MapOverlayMode) => void;
  setDiscoveryVisibility: (payload: { libraryVisible: boolean; mqttVisible: boolean }) => void;
  setMapDiscoveryMqttNodes: (nodes: MeshmapNode[]) => void;
  applyFrequencyPresetToSelectedNetwork: () => void;
  updateSite: (id: string, patch: Partial<Site>) => void;
  setSiteDragPreview: (id: string, preview: { position: { lat: number; lon: number }; groundElevationM: number }) => void;
  clearSiteDragPreview: (id?: string) => void;
  updateLink: (id: string, patch: Partial<Link>) => void;
  updateMapViewport: (patch: Partial<MapViewport>) => void;
  recommendAndFetchTerrainForCurrentArea: (targetRadiusKm?: number) => Promise<void>;
  cancelTerrainLoad: () => void;
  loadTerrainForCoordinate: (lat: number, lon: number) => Promise<void>;
  clearTerrainCache: () => Promise<void>;
  getSelectedLink: () => Link;
  getSelectedSite: () => Site;
  getSelectedNetwork: () => Network;
  getSelectedSites: () => { fromSite: Site; toSite: Site };
  getSelectedAnalysis: () => LinkAnalysis;
  getSelectedProfile: () => ProfilePoint[];
};

const SITE_LIBRARY_KEY = "rmw-site-library-v1";
const SIM_PRESETS_KEY = "rmw-sim-presets-v1";
const ACTIVE_LIBRARY_ACCOUNT_KEY = "linksim-library-active-account-v1";
const LEGACY_LIBRARY_BACKUP_KEY = "linksim-library-legacy-backup-v1";
const ACCOUNT_LIBRARY_TRANSITION_KEY = "linksim-library-account-transition-v1";
const accountLibraryCacheKey = (userId: string): string => `linksim-library-account-v1:${userId}`;
const LAST_SESSION_KEY = "linksim-last-session-v1";
const UI_THEME_PREFERENCE_KEY = "linksim-ui-theme-v1";
const UI_COLOR_THEME_KEY = "linksim-ui-color-theme-v1";
const BASEMAP_STYLE_ID_KEY = "linksim-basemap-style-v2";

const readStorageRawState = <T,>(key: string): { status: "ok" | "missing" | "invalid"; value: T | null; raw?: string } => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { status: "missing", value: null };
    return { status: "ok", value: JSON.parse(raw) as T };
  } catch {
    return { status: "invalid", value: null, raw: localStorage.getItem(key) ?? undefined };
  }
};

const writeStorage = (key: string, value: unknown, encodeJson = true): boolean => {
  try {
    localStorage.setItem(key, encodeJson ? JSON.stringify(value) : String(value));
    return true;
  } catch (error) {
    console.error(`[appStore] Failed to write to localStorage (${key}):`, error);
    return false;
  }
};

const quarantineLibraryRecords = (rejected: RejectedLibraryRecord[], source: string): void => {
  if (!rejected.length) return;
  try {
    const existingRaw = localStorage.getItem(LIBRARY_QUARANTINE_KEY);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    const previous = Array.isArray(existing) ? existing : [];
    const additions = rejected.map((record) => ({
      source,
      quarantinedAt: new Date().toISOString(),
      kind: record.kind,
      id: record.id,
      reason: record.reason,
      value: record.value,
    }));
    const bounded = [...previous, ...additions].slice(-20);
    const encoded = JSON.stringify(bounded);
    localStorage.setItem(LIBRARY_QUARANTINE_KEY, encoded.length <= 64 * 1024
      ? encoded
      : JSON.stringify(bounded.map(({ value: _value, ...metadata }) => metadata)));
  } catch (error) {
    console.error("[appStore] Failed to quarantine malformed Library records:", error);
  }
};

const partitionTrustedCloudLibrary = (bundle: {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
}): SyncPayload => {
  const partitioned = partitionLibraryPayload(bundle);
  quarantineLibraryRecords(partitioned.rejected, "trusted-cloud");
  return {
    siteLibrary: partitioned.siteLibrary as SiteLibraryEntry[],
    simulationPresets: partitioned.simulationPresets as SimulationPreset[],
  };
};



const makeId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const slugifyValue = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const hasDuplicateSimulationName = (
  presets: SimulationPreset[],
  name: string,
  ignorePresetId?: string,
): boolean => {
  const target = name.trim().toLowerCase();
  if (!target) return false;
  return presets.some((preset) => preset.id !== ignorePresetId && preset.name.trim().toLowerCase() === target);
};

const buildSimulationSnapshotFromState = (
  state: Pick<
    AppState,
    | "sites"
    | "links"
    | "systems"
    | "networks"
    | "selectedSiteId"
    | "selectedLinkId"
    | "selectedNetworkId"
    | "selectedCoverageResolution"
    | "selectedOverlayRadiusOption"
    | "propagationModel"
    | "selectedFrequencyPresetId"
    | "rxSensitivityTargetDbm"
    | "environmentLossDb"
    | "propagationEnvironment"
    | "autoPropagationEnvironment"
    | "terrainDataset"
    | "simulationDefaultsOverrideEnabled"
    | "simulationDefaultsOverride"
    | "linkColorMode"
    | "siteIconColors"
  >,
): SimulationPreset["snapshot"] => ({
  sites: state.sites,
  links: state.links,
  systems: state.systems,
  networks: state.networks,
  selectedSiteId: state.selectedSiteId,
  selectedLinkId: state.selectedLinkId,
  selectedNetworkId: state.selectedNetworkId,
  selectedCoverageResolution: state.selectedCoverageResolution,
  selectedOverlayRadiusOption: state.selectedOverlayRadiusOption,
  propagationModel: state.propagationModel,
  selectedFrequencyPresetId: state.selectedFrequencyPresetId,
  rxSensitivityTargetDbm: state.rxSensitivityTargetDbm,
  environmentLossDb: state.environmentLossDb,
  propagationEnvironment: state.propagationEnvironment,
  autoPropagationEnvironment: state.autoPropagationEnvironment,
  terrainDataset: state.terrainDataset,
  simulationDefaultsOverrideEnabled: state.simulationDefaultsOverrideEnabled,
  simulationDefaultsOverride: state.simulationDefaultsOverride ?? undefined,
  linkColorMode: state.linkColorMode,
  siteIconColors: normalizeSiteIconColors(state.siteIconColors, state.sites.map((site) => site.id)),
});

const legacyDemoSiteFingerprint = new Set([
  "bislett|59.925000|10.732000",
  "grefsen|59.956000|10.781000",
  "nordstrand|59.866000|10.790000",
  "sandvika|59.891000|10.524000",
  "lillestrøm|59.956000|11.050000",
  "ski|59.719000|10.835000",
]);

const isLegacyDemoSiteLibraryEntry = (entry: SiteLibraryEntry): boolean =>
  legacyDemoSiteFingerprint.has(
    `${entry.name.toLowerCase()}|${entry.position.lat.toFixed(6)}|${entry.position.lon.toFixed(6)}`,
  );

const dedupeLibraryEntries = <T extends { id: string }>(entries: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
};

const normalizeSiteLibrary = (entries: SiteLibraryEntry[]): SiteLibraryEntry[] =>
  dedupeLibraryEntries(
    entries
      .filter((entry) => !isLegacyDemoSiteLibraryEntry(entry))
      .map((entry) => ({
        ...entry,
        ...withSiteRadioDefaults(entry),
        iconKey: isSiteIconKey(entry.iconKey) ? entry.iconKey : undefined,
      })),
  );

const isLegacyDemoSimulationPreset = (preset: SimulationPreset): boolean => {
  const normalized = preset.name.trim().toLowerCase();
  if (normalized === "oslo local mesh" || normalized === "oslo regional ring") return true;
  const sites = Array.isArray(preset.snapshot?.sites) ? preset.snapshot.sites : [];
  if (!sites.length) return false;
  return sites.every((site) =>
    legacyDemoSiteFingerprint.has(
      `${site.name.toLowerCase()}|${site.position.lat.toFixed(6)}|${site.position.lon.toFixed(6)}`,
    ),
  );
};

const normalizeSimulationPresets = (presets: SimulationPreset[]): SimulationPreset[] =>
  presets
    .filter(
      (preset) =>
        Boolean(
          preset &&
            typeof preset.id === "string" &&
            preset.id &&
            typeof preset.name === "string" &&
            preset.name &&
            preset.snapshot &&
            !isLegacyDemoSimulationPreset(preset),
        ),
    )
    .map((preset) => {
      const migrated = migrateSitesAndLinksToSiteRadioDefaults(
        Array.isArray(preset.snapshot?.sites) ? preset.snapshot.sites : [],
        Array.isArray(preset.snapshot?.links) ? preset.snapshot.links : [],
      );
      const slug = slugifyValue(typeof preset.slug === "string" && preset.slug.trim() ? preset.slug : preset.name);
      const aliasSet = new Set(
        Array.isArray(preset.slugAliases) ? preset.slugAliases.map((entry) => slugifyValue(String(entry))) : [],
      );
      aliasSet.delete(slug);
      return {
        ...preset,
        slug,
        slugAliases: Array.from(aliasSet).filter(Boolean),
        snapshot: {
          ...preset.snapshot,
          sites: migrated.sites,
          links: migrated.links.map((link) => ({
            ...link,
            color: normalizeSimulationColor(link.color) ?? undefined,
          })),
          linkColorMode: normalizeLinkColorMode(preset.snapshot.linkColorMode),
          siteIconColors: normalizeSiteIconColors(
            preset.snapshot.siteIconColors,
            migrated.sites.map((site) => site.id),
          ),
        },
      };
    });

const siteNamePosKey = (
  site: Pick<Site, "name" | "position"> | Pick<SiteLibraryEntry, "name" | "position">,
): string =>
  `${site.name.trim().toLowerCase()}|${site.position.lat.toFixed(6)}|${site.position.lon.toFixed(6)}`;

type SiteLibraryResolver = {
  byId: Map<string, SiteLibraryEntry>;
  byFingerprint: Map<string, SiteLibraryEntry[]>;
};

const buildSiteLibraryResolver = (library: SiteLibraryEntry[]): SiteLibraryResolver => {
  const byId = new Map<string, SiteLibraryEntry>();
  const byFingerprint = new Map<string, SiteLibraryEntry[]>();
  for (const entry of library) {
    byId.set(entry.id, entry);
    const key = siteNamePosKey(entry);
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), entry]);
  }
  return { byId, byFingerprint };
};

const resolveSiteLibraryEntry = (
  site: Pick<Site, "name" | "position" | "libraryEntryId" | "libraryDetached">,
  resolver: SiteLibraryResolver,
): SiteLibraryEntry | undefined => {
  if (site.libraryDetached) return undefined;
  if (site.libraryEntryId) return resolver.byId.get(site.libraryEntryId);
  const exactMatches = resolver.byFingerprint.get(siteNamePosKey(site)) ?? [];
  return exactMatches.length === 1 ? exactMatches[0] : undefined;
};

// A cloud Simulation already has saved Site values in its snapshot. A separate
// pending Library edit must not replace those values when opening the Simulation.
const libraryForSimulationView = (library: SiteLibraryEntry[], presetId: string): SiteLibraryEntry[] =>
  presetId && !dirtySimIds.has(presetId)
    ? library.filter(({ id }) => !dirtySiteIds.has(id))
    : library;

const annotateSitesWithLibraryRefs = (sites: Site[], library: SiteLibraryEntry[]): Site[] => {
  if (!sites.length || !library.length) return sites.map((site) => withSiteRadioDefaults(site));
  const resolver = buildSiteLibraryResolver(library);
  return sites.map((site) => {
    if (site.libraryEntryId) return withSiteRadioDefaults(site);
    const entry = resolveSiteLibraryEntry({ ...site, libraryEntryId: undefined }, resolver);
    if (entry) return withSiteRadioDefaults({ ...site, libraryEntryId: entry.id });
    return withSiteRadioDefaults(site);
  });
};

const syncLibraryLinkedSiteValues = (sites: Site[], library: SiteLibraryEntry[]): Site[] => {
  if (!sites.length || !library.length) return sites.map((site) => withSiteRadioDefaults(site));
  const resolver = buildSiteLibraryResolver(library);
  return sites.map((site) => {
    const entry = resolveSiteLibraryEntry(site, resolver);
    if (!entry) return withSiteRadioDefaults(site);
    return {
      ...withSiteRadioDefaults(site),
      name: entry.name,
      position: entry.position,
      groundElevationM: entry.groundElevationM,
      antennaHeightM: entry.antennaHeightM,
      txPowerDbm: entry.txPowerDbm,
      txGainDbi: entry.txGainDbi,
      rxGainDbi: entry.rxGainDbi,
      cableLossDb: entry.cableLossDb,
      antennaMode: entry.antennaMode,
      antennaAzimuthDeg: site.antennaTargetSiteId || site.antennaTargetDetachedReason ? site.antennaAzimuthDeg : entry.antennaAzimuthDeg,
      antennaTiltDeg: site.antennaTargetSiteId || site.antennaTargetDetachedReason ? site.antennaTiltDeg : entry.antennaTiltDeg,
      antennaHorizontalBeamwidthDeg: entry.antennaHorizontalBeamwidthDeg,
      antennaVerticalBeamwidthDeg: entry.antennaVerticalBeamwidthDeg,
      antennaMaxAttenuationDb: entry.antennaMaxAttenuationDb,
      iconKey: entry.iconKey,
      libraryEntryId: entry.id,
    };
  });
};

const ensureSitesBackedByLibrary = (
  sites: Site[],
  library: SiteLibraryEntry[],
): { sites: Site[]; siteLibrary: SiteLibraryEntry[]; addedCount: number } => {
  if (!sites.length) return { sites, siteLibrary: library, addedCount: 0 };
  const nextLibrary = [...library];
  const resolver = buildSiteLibraryResolver(nextLibrary);
  let addedCount = 0;
  const normalizedSites = sites.map((site) => {
    const normalizedSite = withSiteRadioDefaults(site);
    if (normalizedSite.libraryDetached) return normalizedSite;
    let entry = resolveSiteLibraryEntry(normalizedSite, resolver);
    if (!entry) {
      entry = {
        id: makeId("libsite"),
        name: normalizedSite.name,
        visibility: "private",
        sharedWith: [],
        position: normalizedSite.position,
        groundElevationM: normalizedSite.groundElevationM,
        antennaHeightM: normalizedSite.antennaHeightM,
        txPowerDbm: normalizedSite.txPowerDbm,
        txGainDbi: normalizedSite.txGainDbi,
        rxGainDbi: normalizedSite.rxGainDbi,
        cableLossDb: normalizedSite.cableLossDb,
        antennaMode: normalizedSite.antennaMode,
        antennaAzimuthDeg: normalizedSite.antennaAzimuthDeg,
        antennaTiltDeg: normalizedSite.antennaTiltDeg,
        antennaHorizontalBeamwidthDeg: normalizedSite.antennaHorizontalBeamwidthDeg,
        antennaVerticalBeamwidthDeg: normalizedSite.antennaVerticalBeamwidthDeg,
        antennaMaxAttenuationDb: normalizedSite.antennaMaxAttenuationDb,
        iconKey: normalizedSite.iconKey,
        createdAt: new Date().toISOString(),
      };
      nextLibrary.unshift(entry);
      resolver.byId.set(entry.id, entry);
      const posKey = siteNamePosKey(entry);
      resolver.byFingerprint.set(posKey, [...(resolver.byFingerprint.get(posKey) ?? []), entry]);
      addedCount += 1;
    }
    return {
      ...normalizedSite,
      name: entry.name,
      position: entry.position,
      groundElevationM: entry.groundElevationM,
      antennaHeightM: entry.antennaHeightM,
      txPowerDbm: entry.txPowerDbm,
      txGainDbi: entry.txGainDbi,
      rxGainDbi: entry.rxGainDbi,
      cableLossDb: entry.cableLossDb,
      antennaMode: entry.antennaMode,
      antennaAzimuthDeg: normalizedSite.antennaTargetSiteId || normalizedSite.antennaTargetDetachedReason ? normalizedSite.antennaAzimuthDeg : entry.antennaAzimuthDeg,
      antennaTiltDeg: normalizedSite.antennaTargetSiteId || normalizedSite.antennaTargetDetachedReason ? normalizedSite.antennaTiltDeg : entry.antennaTiltDeg,
      antennaHorizontalBeamwidthDeg: entry.antennaHorizontalBeamwidthDeg,
      antennaVerticalBeamwidthDeg: entry.antennaVerticalBeamwidthDeg,
      antennaMaxAttenuationDb: entry.antennaMaxAttenuationDb,
      iconKey: entry.iconKey,
      libraryEntryId: entry.id,
    };
  });
  return {
    sites: resolveTrackedSiteOrientations(normalizedSites),
    siteLibrary: dedupeLibraryEntries(nextLibrary),
    addedCount,
  };
};

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
  const sites =
    inputSites.length > 0
      ? inputSites.map((site) => withSiteRadioDefaults(site))
      : defaultScenario.sites.map((site) => withSiteRadioDefaults(site));
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
              frequencyMHz: defaultRadioPreset.frequencyMHz,
              name: `${sites[0].name} -> ${sites[1].name}`,
            },
          ]
        : [];

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
            frequencyMHz: defaultRadioPreset.frequencyMHz,
            bandwidthKhz: defaultRadioPreset.bandwidthKhz,
            spreadFactor: defaultRadioPreset.spreadFactor,
            codingRate: defaultRadioPreset.codingRate,
            frequencyOverrideMHz: defaultRadioPreset.frequencyMHz,
            regionCode: defaultRadioPreset.regionCode,
            memberships: sites.map((site) => ({
              siteId: site.id,
              systemId: systems[0].id,
            })),
          },
        ];

  return { sites, links, systems, networks };
};

const siteLibraryRawState = readStorageRawState<SiteLibraryEntry[]>(SITE_LIBRARY_KEY);
if (siteLibraryRawState.status === "invalid") {
  quarantineLibraryRecords([{
    kind: "site", id: null, reason: "Invalid JSON", value: siteLibraryRawState.raw,
  }], "localStorage");
}
const recoveredSiteLibraryRaw = siteLibraryRawState.status === "ok" ? siteLibraryRawState.value ?? [] : [];
const partitionedLocalSites = partitionLibraryPayload({
  siteLibrary: recoveredSiteLibraryRaw,
  simulationPresets: [],
});
quarantineLibraryRecords(partitionedLocalSites.rejected, "localStorage");
let initialSiteLibrary = normalizeSiteLibrary(partitionedLocalSites.siteLibrary as SiteLibraryEntry[]);
if (
  siteLibraryRawState.status !== "ok" ||
  JSON.stringify(initialSiteLibrary) !== JSON.stringify(recoveredSiteLibraryRaw)
) {
  writeStorage(SITE_LIBRARY_KEY, initialSiteLibrary);
}

const simulationPresetsRawState = readStorageRawState<SimulationPreset[]>(SIM_PRESETS_KEY);
if (simulationPresetsRawState.status === "invalid") {
  quarantineLibraryRecords([{
    kind: "simulation", id: null, reason: "Invalid JSON", value: simulationPresetsRawState.raw,
  }], "localStorage");
}
const recoveredSimulationPresetsRaw = simulationPresetsRawState.status === "ok" ? simulationPresetsRawState.value ?? [] : [];
const partitionedLocalSimulations = partitionLibraryPayload({
  siteLibrary: [],
  simulationPresets: recoveredSimulationPresetsRaw,
});
quarantineLibraryRecords(partitionedLocalSimulations.rejected, "localStorage");
let initialSimulationPresets = normalizeSimulationPresets(partitionedLocalSimulations.simulationPresets as SimulationPreset[]);
if (
  simulationPresetsRawState.status !== "ok" ||
  JSON.stringify(initialSimulationPresets) !== JSON.stringify(recoveredSimulationPresetsRaw)
) {
  writeStorage(SIM_PRESETS_KEY, initialSimulationPresets);
}

// One-time migration: default all existing resources to private (issue #96).
if (!localStorage.getItem(MIGRATION_DEFAULT_PRIVATE_KEY)) {
  const nowIso = new Date().toISOString();
  let changed = false;
  initialSiteLibrary = initialSiteLibrary.map((entry) => {
    if (entry.visibility && entry.visibility !== "private") {
      changed = true;
      return { ...entry, visibility: "private" as const, updatedAt: nowIso };
    }
    return entry;
  });
  initialSimulationPresets = initialSimulationPresets.map((preset) => {
    if (preset.visibility && preset.visibility !== "private") {
      changed = true;
      return { ...preset, visibility: "private" as const, updatedAt: nowIso };
    }
    return preset;
  });
  if (changed) {
    writeStorage(SITE_LIBRARY_KEY, initialSiteLibrary);
    writeStorage(SIM_PRESETS_KEY, initialSimulationPresets);
    localStorage.removeItem(SYNC_DIGEST_KEY);
  }
  localStorage.setItem(MIGRATION_DEFAULT_PRIVATE_KEY, "1");
}

type LastSession = {
  selectedScenarioId: string;
  savedAtIso: string;
};

const readLastSession = (): LastSession | null => {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.selectedScenarioId !== "string") return null;
    return parsed as LastSession;
  } catch {
    return null;
  }
};

const getInitialScenarioId = (): string => {
  const lastSession = readLastSession();
  if (lastSession && initialSimulationPresets.some((p) => p.id === lastSession.selectedScenarioId)) {
    return lastSession.selectedScenarioId;
  }
  return "";
};

const normalizeUiThemePreference = (value: unknown): "system" | "light" | "dark" =>
  value === "light" || value === "dark" || value === "system" ? value : "system";
const initialUiThemePreference = normalizeUiThemePreference(
  readStorage<string>(UI_THEME_PREFERENCE_KEY, "system"),
);
const normalizeUiColorTheme = (value: unknown): UiColorTheme =>
  value === "pink" || value === "blue" || value === "red" || value === "green" || value === "yellow" || value === "neutral"
    ? value
    : "blue";
const initialUiColorTheme = normalizeUiColorTheme(readStorage<string>(UI_COLOR_THEME_KEY, "blue"));
const HOLIDAY_THEME_REVERT_KEY = "linksim-holiday-theme-revert-v1";
const HOLIDAY_THEME_NOTICE_DISMISS_KEY = "linksim-holiday-theme-notice-dismiss-v1";

const readHolidayWindowState = (): HolidayThemeWindowState => {
  const fallback: HolidayThemeWindowState = { reverted: [], dismissed: [] };
  if (typeof window === "undefined") return fallback;
  try {
    const reverted = JSON.parse(window.localStorage.getItem(HOLIDAY_THEME_REVERT_KEY) ?? "[]");
    const dismissed = JSON.parse(window.localStorage.getItem(HOLIDAY_THEME_NOTICE_DISMISS_KEY) ?? "[]");
    return {
      reverted: Array.isArray(reverted) ? reverted.filter((v): v is string => typeof v === "string") : [],
      dismissed: Array.isArray(dismissed) ? dismissed.filter((v): v is string => typeof v === "string") : [],
    };
  } catch {
    return fallback;
  }
};

const writeHolidayWindowState = (state: HolidayThemeWindowState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HOLIDAY_THEME_REVERT_KEY, JSON.stringify(state.reverted));
  window.localStorage.setItem(HOLIDAY_THEME_NOTICE_DISMISS_KEY, JSON.stringify(state.dismissed));
};

const appendUniqueWindowId = (ids: string[], nextId: string): string[] =>
  ids.includes(nextId) ? ids : [...ids, nextId];

const initialHolidayWindowState = readHolidayWindowState();
const normalizeBasemapStyleId = (value: unknown): string =>
  typeof value === "string" && (BASEMAP_STYLE_REGISTRY.some((e) => e.id === value.trim()) || value.trim().startsWith("custom:"))
    ? value.trim()
    : DEFAULT_BASEMAP_STYLE_ID;

const normalizeSelectedSiteIds = (ids: string[], sites: Site[]): string[] => {
  if (!ids.length) return [];
  const valid = new Set(sites.map((site) => site.id));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
};

const sameSiteSelection = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const defaultOverlayModeForSelectionCount = (selectionCount: number): MapOverlayMode => {
  if (selectionCount <= 0) return "heatmap";
  if (selectionCount === 1) return "passfail";
  if (selectionCount === 2) return "relay";
  return "heatmap";
};

const applyDefaultsToScenarioNetworks = (networks: Network[], defaults: SimulationDefaults): Network[] =>
  networks.map((network, index) =>
    index === 0
      ? {
          ...network,
          frequencyMHz: defaults.frequencyMHz,
          frequencyOverrideMHz: defaults.frequencyMHz,
          bandwidthKhz: defaults.bandwidthKhz,
          spreadFactor: defaults.spreadFactor,
          codingRate: defaults.codingRate,
          regionCode: defaults.regionCode,
        }
      : network,
  );

const applyDefaultsToScenarioLinks = (links: Link[], defaults: SimulationDefaults): Link[] =>
  links.map((link) => ({ ...link, frequencyMHz: defaults.frequencyMHz }));

type TerrainFetchBounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };

let terrainLoadAbortController: AbortController | null = null;

const bufferedBoundsForSites = (sites: Site[], radiusKm: number): TerrainFetchBounds | null => {
  if (!sites.length) return null;
  const minLat = Math.min(...sites.map((site) => site.position.lat));
  const maxLat = Math.max(...sites.map((site) => site.position.lat));
  const longitudes = sites.map((site) => site.position.lon);
  const centerLat = (minLat + maxLat) / 2;
  const latDelta = Math.max(0.01, radiusKm / 111.32);
  const lonDelta = Math.max(0.01, radiusKm / (111.32 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180))));
  const longitudeBounds = longitudeBoundsForCoordinates(longitudes, lonDelta);
  return {
    minLat: minLat - latDelta,
    maxLat: maxLat + latDelta,
    minLon: longitudeBounds.minLon,
    maxLon: longitudeBounds.maxLon,
  };
};

const initialBasemapStyleId = normalizeBasemapStyleId(
  readStorage<string>(BASEMAP_STYLE_ID_KEY, DEFAULT_BASEMAP_STYLE_ID),
);

const initialScenarioDefaults = simulationDefaultsFromPreset(defaultScenario.defaultFrequencyPresetId);

type AccountLibraryCache = {
  siteLibrary: SiteLibraryEntry[];
  simulationPresets: SimulationPreset[];
  workspace?: {
    snapshot: SimulationPreset["snapshot"];
    selectedScenarioId: string;
    selectedSiteIds: string[];
    mapViewport?: MapViewport;
  };
  lastSessionRaw?: string | null;
  lastSimulationRef?: string | null;
  syncDigest: string | null;
  lastFetchedAt: string | null;
  syncPending: boolean;
  pendingChangesCount: number;
  pendingLibrary?: PendingLibrary;
};

const captureAccountLibraryCache = (state: AppState): AccountLibraryCache => ({
  siteLibrary: state.siteLibrary,
  simulationPresets: state.simulationPresets,
  workspace: state.siteLaunch && !state.selectedScenarioId ? undefined : {
    snapshot: buildSimulationSnapshotFromState(state),
    selectedScenarioId: state.selectedScenarioId,
    selectedSiteIds: state.selectedSiteIds,
    mapViewport: state.mapViewport,
  },
  lastSessionRaw: localStorage.getItem(LAST_SESSION_KEY),
  lastSimulationRef: localStorage.getItem(LAST_SIMULATION_REF_KEY),
  syncDigest: localStorage.getItem(SYNC_DIGEST_KEY),
  lastFetchedAt: localStorage.getItem(LAST_FETCHED_AT_KEY),
  syncPending: state.syncPending,
  pendingChangesCount: state.pendingChangesCount,
  pendingLibrary: pendingLibrary(),
});

const readAccountLibraryCache = async (userId: string): Promise<AccountLibraryCache | null> => {
  const stored = await readLibraryRecoveryStorage<AccountLibraryCache>(accountLibraryCacheKey(userId));
  if (!stored || !Array.isArray(stored.siteLibrary) || !Array.isArray(stored.simulationPresets)) return null;
  const partitioned = partitionLibraryPayload(stored);
  quarantineLibraryRecords(partitioned.rejected, "account-cache");
  return {
    siteLibrary: normalizeSiteLibrary(partitioned.siteLibrary as SiteLibraryEntry[]),
    simulationPresets: normalizeSimulationPresets(partitioned.simulationPresets as SimulationPreset[]),
    workspace: stored.workspace?.snapshot && Array.isArray(stored.workspace.snapshot.sites)
      ? stored.workspace
      : undefined,
    lastSessionRaw: typeof stored.lastSessionRaw === "string" ? stored.lastSessionRaw : null,
    lastSimulationRef: typeof stored.lastSimulationRef === "string" ? stored.lastSimulationRef : null,
    syncDigest: typeof stored.syncDigest === "string" ? stored.syncDigest : null,
    lastFetchedAt: typeof stored.lastFetchedAt === "string" ? stored.lastFetchedAt : null,
    pendingLibrary: readPendingLibrary(stored.pendingLibrary ?? null),
    syncPending: stored.syncPending === true,
    pendingChangesCount: Number.isFinite(stored.pendingChangesCount) ? Math.max(0, stored.pendingChangesCount) : 0,
  };
};

const restoreAccountLibraryCache = (cache: AccountLibraryCache): boolean => {
  if (!writeStorage(SITE_LIBRARY_KEY, cache.siteLibrary)) return false;
  if (!writeStorage(SIM_PRESETS_KEY, cache.simulationPresets)) return false;
  if (!writeStorage(PENDING_LIBRARY_KEY, readPendingLibrary(cache.pendingLibrary ?? null))) return false;
  try {
    if (cache.syncDigest) localStorage.setItem(SYNC_DIGEST_KEY, cache.syncDigest);
    else localStorage.removeItem(SYNC_DIGEST_KEY);
    if (cache.lastFetchedAt) localStorage.setItem(LAST_FETCHED_AT_KEY, cache.lastFetchedAt);
    else localStorage.removeItem(LAST_FETCHED_AT_KEY);
    if (cache.lastSessionRaw) localStorage.setItem(LAST_SESSION_KEY, cache.lastSessionRaw);
    else localStorage.removeItem(LAST_SESSION_KEY);
    if (cache.lastSimulationRef) localStorage.setItem(LAST_SIMULATION_REF_KEY, cache.lastSimulationRef);
    else localStorage.removeItem(LAST_SIMULATION_REF_KEY);
    return true;
  } catch (error) {
    console.error("[appStore] Failed to restore account Library sync state:", error);
    return false;
  }
};

export const useAppStore = create<AppState>((set, get) => ({
  sites: [],
  links: [],
  systems: [],
  networks: [],
  srtmTiles: [],
  fitSitesEpoch: 0,
  isTerrainFetching: false,
  isEditorTerrainFetching: false,
  isTerrainRecommending: false,
  selectedLinkId: "",
  profileCursorIndex: 0,
  temporaryDirectionReversed: false,
  linkColorMode: DEFAULT_LINK_COLOR_MODE,
  siteIconColors: {},
  selectedSiteId: "",
  selectedSiteIds: [],
  selectedNetworkId: "",
  selectedCoverageResolution: "24",
  selectedOverlayRadiusOption: "20",
  propagationModel: "ITM",
  mapViewport: undefined,
  locale: "eng",
  uiThemePreference: initialUiThemePreference,
  uiColorTheme: initialUiColorTheme,
  holidayWindowState: initialHolidayWindowState,
  basemapStyleId: initialBasemapStyleId,
  selectedScenarioId: getInitialScenarioId(),
  selectedFrequencyPresetId: defaultScenario.defaultFrequencyPresetId,
  rxSensitivityTargetDbm: initialScenarioDefaults.rxSensitivityTargetDbm,
  environmentLossDb: initialScenarioDefaults.environmentLossDb,
  propagationEnvironment: initialScenarioDefaults.propagationEnvironment,
  autoPropagationEnvironment: initialScenarioDefaults.autoPropagationEnvironment,
  propagationEnvironmentReason: initialScenarioDefaults.autoPropagationEnvironment ? "Auto defaults active." : "Manual override active.",
  simulationDefaultsOverrideEnabled: false,
  simulationDefaultsOverride: null,
  terrainDataset: "copernicus30",
  terrainFetchStatus: "",
  terrainRecommendation: "",
  isHighResTerrainLoaded: false,
  terrainLoadingStartedAtMs: 0,
  terrainLoadEpoch: 0,
  terrainProgressPercent: 0,
  terrainProgressTilesLoaded: 0,
  terrainProgressTilesTotal: 0,
  terrainProgressBytesLoaded: 0,
  terrainProgressBytesEstimated: 0,
  terrainProgressTransientDecodeBytesEstimated: 0,
  terrainProgressPhaseLabel: "",
  terrainProgressPhaseIndex: 0,
  terrainProgressPhaseTotal: 0,
  terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics([]),
  siteLibrary: initialSiteLibrary,
  simulationPresets: initialSimulationPresets,
  siteDragPreview: {},
  endpointPickTarget: null,
  mapEditor: null,
  mapEditorSiteDraft: null,
  pendingSiteLibraryDraft: null,
  libraryRequest: null,
  showNewSimulationRequest: false,
  pendingSiteLibraryOpenEntryId: null,
  scenarioOptions: BUILTIN_SCENARIOS.map((scenario) => ({ id: scenario.id, name: scenario.name })),
  mapOverlayMode: "heatmap",
  discoveryLibraryVisible: false,
  discoveryMqttVisible: false,
  mapDiscoveryMqttNodes: [],
  simulationConflictIds: [],
  syncStatus: "synced",
  syncPending: localMutationRevision > 0,
  pendingChangesCount: localMutationRevision,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,
  syncErrorMessage: null,
  syncTrigger: 0,
  syncBusy: false,
  syncStatusMessage: "",
  currentUser: null,
  authState: "checking",
  siteLaunch: null,
  workspaceNavigationEpoch: 0,
  libraryHydrated: false,
  isInitializing: false,
  setLocale: (locale) => set({ locale }),
  setSyncStatus: (status: "syncing" | "synced" | "error") => set({ syncStatus: status }),
  setLastSyncedAt: (iso: string | null) => set({ lastSyncedAt: iso }),
  setSyncErrorMessage: (message: string | null) => set({ syncErrorMessage: message }),
  setCurrentUser: (user) => {
    const previousTarget = accountLibraryPreparationPending
      ? accountLibraryPreparationTarget : get().currentUser?.id ?? null;
    if (previousTarget !== (user?.id ?? null)) {
      syncAccountGeneration += 1;
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      syncTimer = null;
      syncInFlight = false;
      set({ libraryHydrated: false, syncBusy: false, isInitializing: false, simulationConflictIds: [] });
    }
    accountLibraryPreparationTarget = user?.id ?? null;
    if (!user) {
      set({ currentUser: null, authState: "signed_out" });
      return Promise.resolve(true);
    }
    const generation = syncAccountGeneration;
    const isCurrent = () => generation === syncAccountGeneration && accountLibraryPreparationTarget === user.id;
    const previousPreparation = accountLibraryPreparation;
    const wasBlocked = accountLibraryStorageBlocked;
    accountLibraryStorageBlocked = false;
    accountLibraryPreparationPending = true;
    const applyAccountCache = (incoming: AccountLibraryCache) => {
      get().cancelTerrainLoad();
      const pending = readPendingLibrary(incoming.pendingLibrary ?? null);
      dirtySiteIds = new Set(pending.sites);
      dirtySimIds = new Set(pending.simulations);
      localMutationRevision = dirtySiteIds.size + dirtySimIds.size;
      const workspace = incoming.workspace;
      const snapshot = workspace?.snapshot;
      const preserveLaunch = Boolean(get().siteLaunch && !get().selectedScenarioId);
      set({
        siteLibrary: incoming.siteLibrary,
        simulationPresets: incoming.simulationPresets,
        ...(!preserveLaunch ? {
          sites: snapshot?.sites ?? [],
          links: snapshot?.links ?? [],
          systems: snapshot?.systems ?? defaultScenario.systems,
          networks: snapshot?.networks ?? [],
          selectedScenarioId: workspace?.selectedScenarioId ?? "",
          selectedSiteId: snapshot?.selectedSiteId ?? "",
          selectedSiteIds: workspace?.selectedSiteIds ?? [],
          selectedLinkId: snapshot?.selectedLinkId ?? "",
          selectedNetworkId: snapshot?.selectedNetworkId ?? "",
          selectedCoverageResolution: snapshot?.selectedCoverageResolution ?? "24",
          selectedOverlayRadiusOption: snapshot?.selectedOverlayRadiusOption ?? defaultOptionForSelectionCount(0),
          propagationModel: snapshot?.propagationModel ?? "ITM",
          selectedFrequencyPresetId: snapshot?.selectedFrequencyPresetId ?? defaultScenario.defaultFrequencyPresetId,
          rxSensitivityTargetDbm: snapshot?.rxSensitivityTargetDbm ?? initialScenarioDefaults.rxSensitivityTargetDbm,
          environmentLossDb: snapshot?.environmentLossDb ?? initialScenarioDefaults.environmentLossDb,
          propagationEnvironment: snapshot?.propagationEnvironment ?? initialScenarioDefaults.propagationEnvironment,
          autoPropagationEnvironment: snapshot?.autoPropagationEnvironment ?? initialScenarioDefaults.autoPropagationEnvironment,
          terrainDataset: snapshot?.terrainDataset ?? "copernicus30",
          simulationDefaultsOverrideEnabled: snapshot?.simulationDefaultsOverrideEnabled ?? false,
          simulationDefaultsOverride: snapshot?.simulationDefaultsOverride ?? null,
          linkColorMode: snapshot?.linkColorMode ?? DEFAULT_LINK_COLOR_MODE,
          siteIconColors: snapshot?.siteIconColors ?? {},
          mapViewport: workspace?.mapViewport,
        } : {}),
        syncPending: incoming.syncPending,
        pendingChangesCount: incoming.pendingChangesCount,
        syncStatus: incoming.syncPending ? "error" : "synced",
        syncErrorMessage: null,
        syncStatusMessage: incoming.syncPending ? "Changes saved locally; sync will resume after sign-in." : "",
      });
    };
    const preparation = (async () => {
      // Serialize account changes so a late backup cannot overwrite a newer one.
      await previousPreparation;
      if (!isCurrent()) return null;
      const interruptedAccount = localStorage.getItem(ACCOUNT_LIBRARY_TRANSITION_KEY);
      if (interruptedAccount) {
        const recovery = await readAccountLibraryCache(interruptedAccount);
        if (!isCurrent()) return null;
        if (!recovery || !restoreAccountLibraryCache(recovery) ||
            !writeStorage(ACTIVE_LIBRARY_ACCOUNT_KEY, interruptedAccount, false)) throw new Error("library-storage");
        localStorage.removeItem(ACCOUNT_LIBRARY_TRANSITION_KEY);
        applyAccountCache(recovery);
      }
      const activeAccountId = localStorage.getItem(ACTIVE_LIBRARY_ACCOUNT_KEY);
      if (!activeAccountId) {
        const existingBackup = await readLibraryRecoveryStorage<AccountLibraryCache>(LEGACY_LIBRARY_BACKUP_KEY);
        if (!isCurrent()) return null;
        if (existingBackup && (!Array.isArray(existingBackup.siteLibrary) || !Array.isArray(existingBackup.simulationPresets))) throw new Error("library-storage");
        if (!existingBackup && !await writeLibraryRecoveryStorage(LEGACY_LIBRARY_BACKUP_KEY, captureAccountLibraryCache(get()))) {
          throw new Error("library-storage");
        }
        if (!isCurrent()) return null;
        if (!writeStorage(ACTIVE_LIBRARY_ACCOUNT_KEY, user.id, false)) throw new Error("library-storage");
      } else if (activeAccountId !== user.id) {
        const incoming = await readAccountLibraryCache(user.id) ?? {
          siteLibrary: [], simulationPresets: [], syncDigest: null, lastFetchedAt: null,
          syncPending: false, pendingChangesCount: 0,
        };
        if (!isCurrent()) return null;
        const outgoing = captureAccountLibraryCache(get());
        const outgoingSnapshot = JSON.stringify(outgoing);
        if (!await writeLibraryRecoveryStorage(accountLibraryCacheKey(activeAccountId), outgoing)) throw new Error("library-storage");
        if (!isCurrent()) return null;
        // An edit made while the recovery copy was being written must not be
        // discarded by restoring another account. Leave the live Library intact.
        if (JSON.stringify(captureAccountLibraryCache(get())) !== outgoingSnapshot) throw new Error("library-storage");
        // Preserve a durable rollback pointer before the multi-key restore. It is
        // recovered before sync on the next sign-in if any write is interrupted.
        if (!writeStorage(ACCOUNT_LIBRARY_TRANSITION_KEY, activeAccountId, false)) throw new Error("library-storage");
        if (!restoreAccountLibraryCache(incoming) || !writeStorage(ACTIVE_LIBRARY_ACCOUNT_KEY, user.id, false)) {
          if (restoreAccountLibraryCache(outgoing) && writeStorage(ACTIVE_LIBRARY_ACCOUNT_KEY, activeAccountId, false)) {
            localStorage.removeItem(ACCOUNT_LIBRARY_TRANSITION_KEY);
          }
          throw new Error("library-storage");
        }
        localStorage.removeItem(ACCOUNT_LIBRARY_TRANSITION_KEY);
        applyAccountCache(incoming);
      }
      if (!isCurrent()) return null;
      const clearStorageError = wasBlocked || accountLibraryStorageBlocked;
      accountLibraryStorageBlocked = false;
      set({ currentUser: user, authState: "signed_in",
        ...(clearStorageError ? { syncErrorMessage: null, syncStatusMessage: "Library storage ready; sync can resume." } : {}) });
      return true;
    })().catch(() => {
      if (!isCurrent()) return null;
      accountLibraryStorageBlocked = true;
      const message = "Could not prepare Library storage for sign-in. Existing local data has been preserved. Export your local Library and free browser storage, then sign in again.";
      set({ currentUser: null, authState: "signed_out", syncStatus: "error", syncBusy: false,
        libraryHydrated: false, isInitializing: false, syncErrorMessage: message, syncStatusMessage: message });
      return false;
    }).finally(() => {
      if (accountLibraryPreparation === preparation) accountLibraryPreparationPending = false;
    });
    accountLibraryPreparation = preparation;
    return preparation;
  },
  getDefaultFrequencyPresetIdForNewSimulation: () => {
    const state = get();
    return resolveDefaultFrequencyPresetIdForNewSimulation(state.currentUser);
  },
  getEffectiveSimulationDefaults: () => {
    const state = get();
    if (state.simulationDefaultsOverrideEnabled && state.simulationDefaultsOverride) {
      return normalizeSimulationDefaults(state.simulationDefaultsOverride);
    }
    return resolveUserSimulationDefaults(state.currentUser?.simulationDefaultsPreference, state.currentUser?.defaultFrequencyPresetId);
  },
  setAuthState: (value) => set({ authState: value }),
  setIsOnline: (value) => set({ isOnline: value }),
  triggerSync: () => set((state) => ({ syncTrigger: state.syncTrigger + 1 })),
  setIsInitializing: (value: boolean) => set({ isInitializing: value }),
  initializeCloudSync: async ({ restoreWorkspace = true } = {}) => {
    if (!await waitForAccountLibraryPreparation()) return;
    const generation = syncAccountGeneration;
    const userId = get().currentUser?.id;
    const isCurrentAccount = () => generation === syncAccountGeneration && get().currentUser?.id === userId;
    const applyStartupSelection = restoreWorkspace && !get().libraryHydrated;
    set({ syncBusy: true, syncStatus: "syncing", syncStatusMessage: "Syncing...", isInitializing: true });
    try {
      const state = get();
      const needsRevision = [...state.siteLibrary, ...state.simulationPresets].some(
        (record) => record.cloudRevision === undefined && canEditLibraryItem(record, state.currentUser),
      );
      const since = needsRevision ? null : localStorage.getItem(LAST_FETCHED_AT_KEY);
      if (needsRevision && userId) {
        const key = `linksim-library-before-revisions-v1:${userId}`;
        if (!localStorage.getItem(key) && !await writeLibraryRecoveryStorage(key, captureAccountLibraryCache(state))) {
          throw new Error("LinkSim could not back up the local Library before refreshing. Free up browser storage and try again.");
        }
        if (!isCurrentAccount()) return;
      }
      const cloud = await fetchCloudLibrary(since ? { since } : undefined);
      if (!isCurrentAccount()) return;
      const trusted = partitionTrustedCloudLibrary(cloud);
      const deletedSites = [...cloud.deletedSiteIds, ...cloud.removedSiteIds];
      const deletedSimulations = [...cloud.deletedSimulationIds, ...cloud.removedSimulationIds];
      if (!await applyCloudRemovals(get, isCurrentAccount, deletedSites, deletedSimulations) || !isCurrentAccount()) return;
      get().importLibraryData({
        siteLibrary: trusted.siteLibrary,
        simulationPresets: detachDeletedSiteReferencesFromPresets(trusted.simulationPresets, new Set(deletedSites)),
      }, "merge");
      storeLibraryCheckpoint(cloud.syncCutoff);
      if (applyStartupSelection && !cloud.isDelta) {
        const lastRef = localStorage.getItem(LAST_SIMULATION_REF_KEY)?.trim() ?? "";
        if (lastRef.startsWith("saved:")) get().loadSimulationPreset(lastRef.slice("saved:".length));
        else if (lastRef.startsWith("builtin:")) get().selectScenario(lastRef.slice("builtin:".length));
      }
      const pendingChangesCount = dirtySiteIds.size + dirtySimIds.size;
      const recovered = userId && localStorage.getItem(removedEditsKey(userId));
      set({ libraryHydrated: true, isInitializing: false, syncBusy: false, syncStatus: recovered ? "error" : "synced",
        syncPending: pendingChangesCount > 0, pendingChangesCount, syncErrorMessage: recovered ? removedEditsMessage : null,
        syncStatusMessage: pendingChangesCount ? "Local changes pending" : recovered ? removedEditsMessage : "Up to date" });
      get().performCloudSyncPush();
    } catch (error) {
      if (!isCurrentAccount()) return;
      const message = getUiErrorMessage(error);
      if (isAuthRelatedErrorMessage(message)) set({ currentUser: null, authState: "signed_out" });
      set({ syncStatus: "error", syncErrorMessage: message, syncBusy: false,
        syncStatusMessage: `Sync failed: ${message}`, isInitializing: false });
    }
  },
  performCloudSyncPush: () => {
    if (accountLibraryPreparationPending || accountLibraryStorageBlocked) {
      void waitForAccountLibraryPreparation().then((ready) => { if (ready) get().performCloudSyncPush(); });
      return;
    }
    if (!get().libraryHydrated || get().isInitializing || (!dirtySiteIds.size && !dirtySimIds.size)) return;
    const generation = syncAccountGeneration;
    const userId = get().currentUser?.id;
    const isCurrentAccount = () => generation === syncAccountGeneration && get().currentUser?.id === userId;
    const pendingChangesCount = dirtySiteIds.size + dirtySimIds.size;
    if (get().authState === "signed_out" || !userId || !get().isOnline) {
      set({ syncPending: true, syncStatus: "error", pendingChangesCount,
        syncErrorMessage: get().isOnline ? "Not signed in." : null,
        syncStatusMessage: get().isOnline
          ? "Sign in to sync your local changes."
          : "Offline. Changes are saved locally and will sync when reconnected." });
      return;
    }
    set({ syncPending: true, pendingChangesCount });
    if (syncInFlight) return;
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(async () => {
      syncTimer = null;
      if (!isCurrentAccount() || syncInFlight || get().isInitializing || !get().isOnline) return;
      const payload = buildDeltaSyncPayload(get());
      if (!payload.siteLibrary.length && !payload.simulationPresets.length) return;
      const revisionAtStart = localMutationRevision;
      syncInFlight = true;
      set({ syncBusy: true, syncStatus: "syncing", syncStatusMessage: "Saving changes..." });
      let completed = false;
      try {
        let receivedReceipts = false;
        await pushCloudLibrary(payload, (receipts) => {
          receivedReceipts = true;
          if (isCurrentAccount()) acknowledgeLibraryWrites(payload, receipts);
        });
        if (!isCurrentAccount()) return;
        if (!receivedReceipts) acknowledgeLibraryWrites(payload);
        const remaining = dirtySiteIds.size + dirtySimIds.size;
        completed = true;
        set({ syncPending: remaining > 0, pendingChangesCount: remaining, syncStatus: "synced",
          lastSyncedAt: new Date().toISOString(), syncErrorMessage: null, syncStatusMessage: "Changes saved" });
      } catch (error) {
        if (!isCurrentAccount()) return;
        recordSimulationConflicts(error);
        const message = getUiErrorMessage(error);
        if (isAuthRelatedErrorMessage(message)) set({ currentUser: null, authState: "signed_out" });
        set({ syncPending: true, syncStatus: "error", syncErrorMessage: message, syncStatusMessage: `Save failed: ${message}` });
      } finally {
        if (isCurrentAccount()) {
          syncInFlight = false;
          set({ syncBusy: false });
          if (completed && localMutationRevision > revisionAtStart) get().performCloudSyncPush();
        }
      }
    }, SYNC_DEBOUNCE_MS);
  },
  saveSimulationToCloud: async (id) => {
    if (!await waitForAccountLibraryPreparation()) throw new Error("Library storage is unavailable. Try again.");
    if (syncInFlight || get().isInitializing) throw new Error("Sync is in progress. Try sharing again when it finishes.");
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = null;
    const state = get();
    const simulation = state.simulationPresets.find((entry) => entry.id === id);
    if (!simulation) throw new Error("Simulation missing after local update.");
    const generation = syncAccountGeneration;
    const payload = { siteLibrary: [], simulationPresets: [simulation] };
    syncInFlight = true;
    let completed = false;
    try {
      let receivedReceipts = false;
      await pushCloudLibrary(payload, (receipts) => {
        receivedReceipts = true;
        if (generation === syncAccountGeneration) acknowledgeLibraryWrites(payload, receipts);
      });
      if (generation !== syncAccountGeneration) throw new Error("The signed-in account changed. Try sharing again.");
      if (!receivedReceipts) acknowledgeLibraryWrites(payload);
      completed = true;
    } catch (error) {
      if (generation === syncAccountGeneration) recordSimulationConflicts(error);
      throw error;
    } finally {
      if (generation === syncAccountGeneration) {
        syncInFlight = false;
        if (completed) get().performCloudSyncPush();
      }
    }
  },
  saveConflictCopyAndReload: async (id) => {
    if (!await waitForAccountLibraryPreparation()) throw new Error("Library storage is unavailable. Try again.");
    const state = get();
    const user = requireAuth(state.currentUser, "saveConflictCopyAndReload");
    const local = state.simulationPresets.find((preset) => preset.id === id);
    if (!user || !local || !dirtySimIds.has(id) || !state.simulationConflictIds.includes(id)) {
      throw new Error("This Simulation no longer has a pending conflict.");
    }
    if (syncInFlight || state.isInitializing || !state.isOnline) {
      throw new Error("Wait for sync to finish and check your connection, then try again.");
    }
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = null;
    const generation = syncAccountGeneration;
    const isCurrentAccount = () => generation === syncAccountGeneration && get().currentUser?.id === user.id;
    syncInFlight = true;
    set({ syncBusy: true });
    let resolved = false;
    try {
      const cloud = partitionTrustedCloudLibrary(await fetchCloudLibrary());
      if (!isCurrentAccount()) throw new Error("The signed-in account changed. Try again in the original account.");
      const remote = cloud.simulationPresets.find((preset) => preset.id === id && preset.status !== "deleted");
      if (!remote) throw new Error("The cloud Simulation is unavailable. Your local edit is still pending.");
      const latest = get();
      const current = latest.simulationPresets.find((preset) => preset.id === id);
      if (JSON.stringify(current) !== JSON.stringify(local)) {
        throw new Error("The local Simulation changed while loading. Try again to save the latest edit.");
      }

      const stem = local.name.slice(0, 140).trim();
      let name = `${stem} (local copy)`;
      for (let index = 2; hasDuplicateSimulationName([...latest.simulationPresets, ...cloud.simulationPresets], name); index++) {
        name = `${stem} (local copy ${index})`;
      }
      const copy = newPrivateSimulationCopy(user, name, {
        ...local.snapshot,
        sites: syncLibraryLinkedSiteValues(local.snapshot.sites, latest.siteLibrary).map((site) => ({
          ...site, libraryEntryId: undefined, libraryDetached: true,
        })),
      }, local.description);
      const [restored] = normalizeSimulationPresets([{ ...remote, snapshot: { ...remote.snapshot,
        sites: syncLibraryLinkedSiteValues(remote.snapshot.sites, cloud.siteLibrary),
      } }]);
      if (!restored) throw new Error("The cloud Simulation could not be loaded. Your local edit is still pending.");

      // Queue the copy before replacing the original in the single Library write.
      // Keep the original queued on disk until the replacement has been saved.
      const pending = pendingLibrary();
      if (!writeStorage(PENDING_LIBRARY_KEY, { ...pending, simulations: [...pending.simulations, copy.id] })) {
        throw new Error("LinkSim could not queue the local copy. Free up browser storage and try again.");
      }
      const simulationPresets = [copy, ...latest.simulationPresets.map((preset) => preset.id === id ? restored : preset)];
      if (!writeStorage(SIM_PRESETS_KEY, simulationPresets)) {
        writeStorage(PENDING_LIBRARY_KEY, pending);
        throw new Error("LinkSim could not save the local copy. Free up browser storage and try again.");
      }
      dirtySimIds.delete(id);
      markDirtySim(copy.id);
      const simulationConflictIds = latest.simulationConflictIds.filter((conflictId) => conflictId !== id);
      set({ simulationPresets, simulationConflictIds, ...pendingLibraryState(),
        ...(simulationConflictIds.length === 0 ? {
          syncStatus: "synced" as const, syncErrorMessage: null, syncStatusMessage: "Local copy saved. Cloud version reloaded.",
        } : {}),
      });
      get().importLibraryData({ siteLibrary: cloud.siteLibrary }, "merge");
      if (latest.selectedScenarioId === id) get().loadSimulationPreset(id);
      resolved = true;
      return name;
    } finally {
      if (isCurrentAccount()) {
        syncInFlight = false;
        set({ syncBusy: false });
        if (resolved) get().performCloudSyncPush();
      }
    }
  },
  performManualCloudSync: async () => {
    if (!await waitForAccountLibraryPreparation()) return;
    console.log("[appStore] performManualCloudSync START");
    if (!get().libraryHydrated) {
      set({
        syncStatus: "error",
        syncErrorMessage: null,
        syncStatusMessage: "Sync not ready yet. Please wait for initialization.",
      });
      return;
    }
    if (!get().isOnline) {
      set({
        syncPending: true,
        syncStatus: "error",
        syncErrorMessage: null,
        syncStatusMessage: "Offline. Changes are saved locally and will sync when reconnected.",
      });
      return;
    }
    if (get().authState === "signed_out" || !get().currentUser?.id) {
      set({
        syncPending: true,
        syncStatus: "error",
        syncErrorMessage: "Not signed in.",
        syncStatusMessage: "Not signed in; cloud sync unavailable. Sign in and open Sync Status to recover pending changes.",
      });
      return;
    }
    if (syncInFlight) {
      set({
        syncStatus: "syncing",
        syncStatusMessage: "Sync already in progress.",
      });
      return;
    }
    syncInFlight = true;
    const generationAtStart = syncAccountGeneration;
    const userIdAtStart = get().currentUser?.id;
    const isCurrentAccount = () =>
      syncAccountGeneration === generationAtStart && get().currentUser?.id === userIdAtStart;
    let completed = false;
    set({ syncBusy: true, syncStatus: "syncing", syncStatusMessage: "Syncing..." });
    try {
      const remote = await fetchCloudLibrary();
      if (!isCurrentAccount()) return;
      const deletedSites = [...remote.deletedSiteIds, ...remote.removedSiteIds];
      const deletedSimulations = [...remote.deletedSimulationIds, ...remote.removedSimulationIds];
      if (!await applyCloudRemovals(get, isCurrentAccount, deletedSites, deletedSimulations) || !isCurrentAccount()) return;
      const trusted = partitionTrustedCloudLibrary(remote);
      // Manual Sync can still recover missing records. The server's revision check
      // protects any record created or changed after this read.
      const remoteSites = new Set(trusted.siteLibrary.map(({ id }) => id));
      const remoteSims = new Set(trusted.simulationPresets.map(({ id }) => id));
      const state = get();
      const payload: SyncPayload = {
        siteLibrary: state.siteLibrary.filter((site) => canEditLibraryItem(site, state.currentUser) &&
          (dirtySiteIds.has(site.id) || !remoteSites.has(site.id))),
        simulationPresets: state.simulationPresets.filter((sim) => sim.status !== "deleted" &&
          canEditLibraryItem(sim, state.currentUser) && (dirtySimIds.has(sim.id) || !remoteSims.has(sim.id))),
      };
      if (payload.siteLibrary.length || payload.simulationPresets.length) {
        let receivedReceipts = false;
        await pushCloudLibrary(payload, (receipts) => {
          receivedReceipts = true;
          if (isCurrentAccount()) acknowledgeLibraryWrites(payload, receipts);
        });
        if (!isCurrentAccount()) return;
        if (!receivedReceipts) acknowledgeLibraryWrites(payload);
      }
      const cloud = payload.siteLibrary.length || payload.simulationPresets.length ? await fetchCloudLibrary() : remote;
      if (!isCurrentAccount()) return;
      const latest = cloud === remote ? trusted : partitionTrustedCloudLibrary(cloud);
      const removedSites = [...cloud.deletedSiteIds, ...cloud.removedSiteIds];
      const removedSimulations = [...cloud.deletedSimulationIds, ...cloud.removedSimulationIds];
      if (!await applyCloudRemovals(get, isCurrentAccount, removedSites, removedSimulations) || !isCurrentAccount()) return;
      const result = get().importLibraryData({
        siteLibrary: latest.siteLibrary,
        simulationPresets: detachDeletedSiteReferencesFromPresets(latest.simulationPresets, new Set(removedSites)),
      }, "merge");
      storeLibraryCheckpoint(cloud.syncCutoff);
      const pendingChangesCount = dirtySiteIds.size + dirtySimIds.size;
      const recovered = userIdAtStart && localStorage.getItem(removedEditsKey(userIdAtStart));
      completed = true;
      set({ libraryHydrated: true, syncPending: pendingChangesCount > 0, pendingChangesCount,
        syncStatus: recovered ? "error" : "synced", lastSyncedAt: new Date().toISOString(),
        syncErrorMessage: recovered ? removedEditsMessage : null,
        syncStatusMessage: recovered ? removedEditsMessage : `Synced: ${result.siteCount} sites, ${result.simulationCount} simulations` });
    } catch (error) {
      if (!isCurrentAccount()) return;
      recordSimulationConflicts(error);
      console.error("[appStore] performManualCloudSync FAILED:", error);
      const message = getUiErrorMessage(error);
      if (isAuthRelatedErrorMessage(message)) {
        set({ currentUser: null, authState: "signed_out" });
      }
      set({
        syncPending: true,
        syncStatus: "error",
        syncErrorMessage: message,
        syncStatusMessage: `Sync failed: ${message}`,
      });
    } finally {
      if (isCurrentAccount()) {
        syncInFlight = false;
        set({ syncBusy: false });
        if (completed && (dirtySiteIds.size || dirtySimIds.size)) {
          get().performCloudSyncPush();
        }
      }
    }
  },
  setUiThemePreference: (value) => {
    const normalized = normalizeUiThemePreference(value);
    writeStorage(UI_THEME_PREFERENCE_KEY, normalized);
    set({ uiThemePreference: normalized });
  },
  setUiColorTheme: (value) => {
    const normalized = normalizeUiColorTheme(value);
    writeStorage(UI_COLOR_THEME_KEY, normalized);
    set({ uiColorTheme: normalized });
  },
  revertHolidayThemeForWindow: () => {
    const current = get().holidayWindowState;
    const active = getActiveHolidayTheme(new Date());
    if (!active) return;
    const windowId = active.windowId;
    const next: HolidayThemeWindowState = {
      reverted: appendUniqueWindowId(current.reverted, windowId),
      dismissed: appendUniqueWindowId(current.dismissed, windowId),
    };
    writeHolidayWindowState(next);
    set({ holidayWindowState: next });
  },
  dismissHolidayThemeNotice: () => {
    const current = get().holidayWindowState;
    const active = getActiveHolidayTheme(new Date());
    if (!active) return;
    const windowId = active.windowId;
    const next: HolidayThemeWindowState = {
      reverted: current.reverted,
      dismissed: appendUniqueWindowId(current.dismissed, windowId),
    };
    writeHolidayWindowState(next);
    set({ holidayWindowState: next });
  },
  setBasemapStyleId: (value) => {
    const normalized = normalizeBasemapStyleId(value);
    writeStorage(BASEMAP_STYLE_ID_KEY, normalized);
    set({ basemapStyleId: normalized });
  },
  selectScenario: (id) => {
    const scenario = getScenarioById(id);
    if (!scenario) return;
    get().cancelTerrainLoad();
    const defaults = simulationDefaultsFromPreset(scenario.defaultFrequencyPresetId);
    const migratedScenario = migrateSitesAndLinksToSiteRadioDefaults(scenario.sites, scenario.links);
    const libraryBacked = ensureSitesBackedByLibrary(migratedScenario.sites, get().siteLibrary);
    if (libraryBacked.addedCount > 0) {
      writeStorage(SITE_LIBRARY_KEY, libraryBacked.siteLibrary);
    }
    set({
      selectedScenarioId: scenario.id,
      siteLaunch: null,
      workspaceNavigationEpoch: get().workspaceNavigationEpoch + 1,
      sites: libraryBacked.sites,
      links: applyDefaultsToScenarioLinks(migratedScenario.links, defaults),
      systems: scenario.systems,
      networks: applyDefaultsToScenarioNetworks(scenario.networks, defaults),
      selectedSiteId: scenario.defaultSiteId,
      selectedSiteIds: scenario.defaultSiteId ? [scenario.defaultSiteId] : [],
      selectedLinkId: scenario.defaultLinkId,
      profileCursorIndex: 0,
      temporaryDirectionReversed: false,
      linkColorMode: DEFAULT_LINK_COLOR_MODE,
      siteIconColors: {},
      selectedNetworkId: scenario.defaultNetworkId,
      selectedFrequencyPresetId: scenario.defaultFrequencyPresetId,
      propagationModel: "ITM",
      rxSensitivityTargetDbm: defaults.rxSensitivityTargetDbm,
      environmentLossDb: defaults.environmentLossDb,
      propagationEnvironment: defaults.propagationEnvironment,
      autoPropagationEnvironment: defaults.autoPropagationEnvironment,
      propagationEnvironmentReason: defaults.autoPropagationEnvironment ? "Auto defaults active." : "Manual override active.",
      terrainFetchStatus: "",
      terrainRecommendation: "",
      isHighResTerrainLoaded: false,
      terrainLoadingStartedAtMs: 0,
      terrainLoadEpoch: get().terrainLoadEpoch + 1,
      siteDragPreview: {},
      endpointPickTarget: null,
      mapEditor: null,
      mapEditorSiteDraft: null,
      mapViewport: scenario.viewport,
      siteLibrary: libraryBacked.siteLibrary,
      fitSitesEpoch: get().fitSitesEpoch + 1,
    });
    writeStorage(LAST_SESSION_KEY, { selectedScenarioId: scenario.id, savedAtIso: new Date().toISOString() });
    useCoverageStore.getState().recomputeCoverage();
  },
  loadDemoScenario: () => {
    get().cancelTerrainLoad();
    const scenario = DEMO_SCENARIO;
    const defaults = simulationDefaultsFromPreset(scenario.defaultFrequencyPresetId);
    const libraryBacked = ensureSitesBackedByLibrary(scenario.sites, get().siteLibrary);
    if (libraryBacked.addedCount > 0) {
      writeStorage(SITE_LIBRARY_KEY, libraryBacked.siteLibrary);
    }
    // Resolve link selection: both endpoints must be selected for path profile to show.
    const defaultLink = scenario.links.find((l) => l.id === scenario.defaultLinkId);
    const selectedSiteIds = defaultLink
      ? normalizeSelectedSiteIds([defaultLink.fromSiteId, defaultLink.toSiteId], libraryBacked.sites)
      : scenario.defaultSiteId
        ? [scenario.defaultSiteId]
        : [];
    set({
      // selectedScenarioId intentionally not set — demo stays invisible in scenario UI
      sites: libraryBacked.sites,
      links: applyDefaultsToScenarioLinks(scenario.links, defaults),
      systems: scenario.systems,
      networks: applyDefaultsToScenarioNetworks(scenario.networks, defaults),
      selectedSiteId: selectedSiteIds[0] ?? scenario.defaultSiteId,
      selectedSiteIds,
      selectedLinkId: scenario.defaultLinkId,
      profileCursorIndex: 0,
      temporaryDirectionReversed: false,
      linkColorMode: DEFAULT_LINK_COLOR_MODE,
      siteIconColors: {},
      selectedNetworkId: scenario.defaultNetworkId,
      selectedFrequencyPresetId: scenario.defaultFrequencyPresetId,
      propagationModel: "ITM",
      rxSensitivityTargetDbm: defaults.rxSensitivityTargetDbm,
      environmentLossDb: defaults.environmentLossDb,
      propagationEnvironment: defaults.propagationEnvironment,
      autoPropagationEnvironment: defaults.autoPropagationEnvironment,
      propagationEnvironmentReason: defaults.autoPropagationEnvironment ? "Auto defaults active." : "Manual override active.",
      terrainFetchStatus: "",
      terrainRecommendation: "",
      isHighResTerrainLoaded: false,
      terrainLoadingStartedAtMs: 0,
      terrainLoadEpoch: get().terrainLoadEpoch + 1,
      siteDragPreview: {},
      endpointPickTarget: null,
      mapEditor: null,
      mapEditorSiteDraft: null,
      // mapViewport: undefined — fitSitesEpoch triggers proper fit via MapView
      fitSitesEpoch: get().fitSitesEpoch + 1,
      siteLibrary: libraryBacked.siteLibrary,
      mapOverlayMode: defaultOverlayModeForSelectionCount(selectedSiteIds.length),
    });
    useCoverageStore.getState().recomputeCoverage();
  },
  requestFitToSites: () => set((state) => ({ fitSitesEpoch: state.fitSitesEpoch + 1 })),
  setSelectedLinkId: (id) => {
    let changed = false;
    set((state) => {
      const selectedLink = state.links.find((link) => link.id === id) ?? null;
      const selection = selectedLink
        ? normalizeSelectedSiteIds([selectedLink.fromSiteId, selectedLink.toSiteId], state.sites)
        : [];
      const nextOverlay = defaultOverlayModeForSelectionCount(selection.length);
      if (
        state.selectedLinkId === id &&
        state.profileCursorIndex === 0 &&
        state.temporaryDirectionReversed === false &&
        state.selectedSiteId === (selection[0] ?? state.selectedSiteId) &&
        state.mapOverlayMode === nextOverlay &&
        sameSiteSelection(state.selectedSiteIds, selection)
      ) {
        return state;
      }
      changed = true;
      return {
        selectedLinkId: id,
        profileCursorIndex: 0,
        temporaryDirectionReversed: false,
        selectedSiteIds: selection,
        selectedSiteId: selection[0] ?? state.selectedSiteId,
        mapOverlayMode: nextOverlay,
      };
    });
    if (changed) {
      useCoverageStore.getState().recomputeCoverage();
    }
  },
  setTemporaryDirectionReversed: (value) => set({ temporaryDirectionReversed: Boolean(value) }),
  toggleTemporaryDirectionReversed: () =>
    set((state) => ({ temporaryDirectionReversed: !state.temporaryDirectionReversed })),
  setProfileCursorIndex: (index) => set({ profileCursorIndex: Math.max(0, Math.floor(index)) }),
  setSelectedSiteId: (id) => {
    let changed = false;
    set((state) => {
      const selection = normalizeSelectedSiteIds([id], state.sites);
      const nextSelectedSiteId = selection[0] ?? id;
      const nextOverlay = defaultOverlayModeForSelectionCount(selection.length);
      if (
        state.selectedSiteId === nextSelectedSiteId &&
        state.selectedLinkId === "" &&
        state.mapOverlayMode === nextOverlay &&
        sameSiteSelection(state.selectedSiteIds, selection)
      ) {
        return state;
      }
      changed = true;
      return {
        selectedSiteId: nextSelectedSiteId,
        selectedSiteIds: selection,
        selectedLinkId: "",
        mapOverlayMode: nextOverlay,
      };
    });
    if (changed) {
      useCoverageStore.getState().recomputeCoverage();
    }
  },
  selectSiteById: (id, additive = false) => {
    let changed = false;
    set((state) => {
      const validIds = new Set(state.sites.map((site) => site.id));
      if (!validIds.has(id)) return state;
      const current = normalizeSelectedSiteIds(state.selectedSiteIds, state.sites);
      let nextSelection: string[];
      if (!additive) {
        nextSelection = [id];
      } else if (current.includes(id)) {
        nextSelection = current.filter((candidate) => candidate !== id);
      } else {
        nextSelection = [...current, id];
      }
      const normalizedSelection = normalizeSelectedSiteIds(nextSelection, state.sites);
      const nextSelectedSiteId = normalizedSelection[0] ?? "";
      const nextOverlay = defaultOverlayModeForSelectionCount(normalizedSelection.length);
      if (
        state.selectedSiteId === nextSelectedSiteId &&
        state.selectedLinkId === "" &&
        state.mapOverlayMode === nextOverlay &&
        sameSiteSelection(state.selectedSiteIds, normalizedSelection)
      ) {
        return state;
      }
      changed = true;
      return {
        selectedSiteIds: normalizedSelection,
        selectedSiteId: nextSelectedSiteId,
        selectedLinkId: "",
        mapOverlayMode: nextOverlay,
      };
    });
    if (changed) {
      useCoverageStore.getState().recomputeCoverage();
    }
  },
  clearActiveSelection: () => {
    let changed = false;
    set((state) => {
      const nextOverlay = defaultOverlayModeForSelectionCount(0);
      if (
        !state.selectedSiteIds.length &&
        !state.selectedSiteId &&
        !state.selectedLinkId &&
        !state.temporaryDirectionReversed &&
        state.endpointPickTarget === null &&
        state.profileCursorIndex === 0 &&
        state.mapOverlayMode === nextOverlay
      ) {
        return state;
      }
      changed = true;
      return {
        selectedSiteIds: [],
        selectedSiteId: "",
        selectedLinkId: "",
        temporaryDirectionReversed: false,
        endpointPickTarget: null,
        profileCursorIndex: 0,
        mapOverlayMode: nextOverlay,
      };
    });
    if (changed) {
      useCoverageStore.getState().recomputeCoverage();
    }
  },
  setSelectedNetworkId: (id) => {
    set({ selectedNetworkId: id });
    useCoverageStore.getState().recomputeCoverage();
  },
  setSelectedCoverageResolution: (resolution) => {
    set({ selectedCoverageResolution: resolution });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  setSelectedOverlayRadiusOption: (value) => {
    set({ selectedOverlayRadiusOption: value });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  setSelectedFrequencyPresetId: (id) => {
    set({ selectedFrequencyPresetId: id });
    get().updateCurrentSimulationSnapshot();
  },
  setRxSensitivityTargetDbm: (value) => {
    set({ rxSensitivityTargetDbm: value });
    get().updateCurrentSimulationSnapshot();
  },
  setEnvironmentLossDb: (value) => {
    set({ environmentLossDb: Math.max(0, value) });
    get().updateCurrentSimulationSnapshot();
  },
  setAutoPropagationEnvironment: (value) => {
    set({ autoPropagationEnvironment: value });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
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
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  applyClimateDefaults: (climate) => {
    set((state) => ({
      propagationEnvironment: withClimateDefaults(state.propagationEnvironment, climate),
      autoPropagationEnvironment: false,
      propagationEnvironmentReason: "Manual climate defaults applied.",
    }));
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  setSimulationDefaultsOverrideEnabled: (value) => {
    const defaults = value ? get().getEffectiveSimulationDefaults() : null;
    set({ simulationDefaultsOverrideEnabled: value, simulationDefaultsOverride: defaults });
    get().updateCurrentSimulationSnapshot();
  },
  setSimulationDefaultsOverride: (value) => {
    const defaults = normalizeSimulationDefaults(value);
    set({
      simulationDefaultsOverrideEnabled: true,
      simulationDefaultsOverride: defaults,
      selectedFrequencyPresetId: defaults.frequencyPresetId,
      rxSensitivityTargetDbm: defaults.rxSensitivityTargetDbm,
      environmentLossDb: defaults.environmentLossDb,
      propagationEnvironment: defaults.propagationEnvironment,
      autoPropagationEnvironment: defaults.autoPropagationEnvironment,
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  addSiteByCoordinates: (name, lat, lon) => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    if (!currentUser?.id) {
      console.warn("[appStore] addSiteByCoordinates: Auth required - user not logged in");
      return;
    }
    if (!canEditActiveSavedSimulation(currentUser, selectedScenarioId, simulationPresets)) {
      console.warn(
        `[appStore] addSiteByCoordinates: User ${currentUser.id} cannot edit active simulation ${selectedScenarioId}`,
      );
      return;
    }
    const label = name.trim();
    if (!label) return;
    const id = makeId("site");
    const libraryEntryId = makeId("libsite");
    const newSite: Site = {
      id,
      name: label,
      position: { lat, lon },
      groundElevationM: 0,
      antennaHeightM: 2,
      txPowerDbm: STANDARD_SITE_RADIO.txPowerDbm,
      txGainDbi: STANDARD_SITE_RADIO.txGainDbi,
      rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
      cableLossDb: STANDARD_SITE_RADIO.cableLossDb,
      libraryEntryId,
    };
    set((state) => {
      const entry: SiteLibraryEntry = {
        id: libraryEntryId,
        name: label,
        visibility: "private",
        sharedWith: [],
        position: { lat, lon },
        groundElevationM: 0,
        antennaHeightM: 2,
        txPowerDbm: STANDARD_SITE_RADIO.txPowerDbm,
        txGainDbi: STANDARD_SITE_RADIO.txGainDbi,
        rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
        cableLossDb: STANDARD_SITE_RADIO.cableLossDb,
        createdAt: new Date().toISOString(),
        ownerUserId: currentUser.id,
        createdByUserId: currentUser.id,
        createdByName: currentUser.username,
        createdByAvatarUrl: currentUser.avatarUrl ?? "",
        lastEditedByUserId: currentUser.id,
        lastEditedByName: currentUser.username,
        lastEditedByAvatarUrl: currentUser.avatarUrl ?? "",
        effectiveRole: "owner" as const,
      };
      markDirtySite(entry.id);
      const nextLibrary = normalizeSiteLibrary([entry, ...state.siteLibrary]);
      writeStorage(SITE_LIBRARY_KEY, nextLibrary);
      return {
        ...pendingLibraryState(),
        sites: [...state.sites, newSite],
        selectedSiteId: id,
        selectedSiteIds: [id],
        mapOverlayMode: defaultOverlayModeForSelectionCount(1),
        siteLibrary: nextLibrary,
      };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  deleteSite: (siteId) => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    const user = requireAuth(currentUser, "deleteSite");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(`[appStore] deleteSite: User ${user.id} cannot edit active simulation ${selectedScenarioId}`);
      return;
    }
    set((state) => {
      const remainingSites = state.sites
        .map((site) => {
          if (site.antennaTargetSiteId !== siteId) return site;
          const resolved = resolveTrackedSiteOrientation(site, state.sites);
          return { ...resolved, antennaTargetSiteId: undefined, antennaTargetDetachedReason: "target-deleted" as const };
        })
        .filter((site) => site.id !== siteId);
      if (!remainingSites.length) return state;

      let remainingLinks = state.links.filter(
        (link) => link.fromSiteId !== siteId && link.toSiteId !== siteId,
      );
      if (!remainingLinks.length && remainingSites.length >= 2) {
        const base = state.links[0];
        const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
        const inheritedFrequencyMHz =
          selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? base?.frequencyMHz ?? defaultRadioPreset.frequencyMHz;
        remainingLinks = [
            {
              id: makeId("lnk"),
              name: "Auto Link",
              fromSiteId: remainingSites[0].id,
              toSiteId: remainingSites[1].id,
              frequencyMHz: inheritedFrequencyMHz,
              txPowerDbm: base?.txPowerDbm,
              txGainDbi: base?.txGainDbi,
              rxGainDbi: base?.rxGainDbi,
              cableLossDb: base?.cableLossDb,
            },
          ];
      }
      const safeLinkId = remainingLinks[0]?.id ?? "";
      const safeSiteId =
        state.selectedSiteId === siteId ? remainingSites[0].id : state.selectedSiteId;
      const remainingSelectedIds = normalizeSelectedSiteIds(
        state.selectedSiteIds.filter((id) => id !== siteId),
        remainingSites,
      );
      const nextSelectedIds = remainingSelectedIds.length
        ? remainingSelectedIds
        : safeSiteId && remainingSites.some((site) => site.id === safeSiteId)
          ? [safeSiteId]
          : remainingSites[0]
            ? [remainingSites[0].id]
            : [];
      const nextSiteIconColors = { ...state.siteIconColors };
      delete nextSiteIconColors[siteId];

      return {
        sites: remainingSites,
        links: remainingLinks,
        selectedSiteId: nextSelectedIds[0] ?? safeSiteId,
        selectedSiteIds: nextSelectedIds,
        selectedLinkId: safeLinkId,
        siteIconColors: nextSiteIconColors,
        mapOverlayMode: defaultOverlayModeForSelectionCount(nextSelectedIds.length),
        networks: state.networks.map((network) => ({
          ...network,
          memberships: network.memberships.filter((member) => member.siteId !== siteId),
        })),
      };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  createLink: (fromSiteId, toSiteId, name, color) => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    const user = requireAuth(currentUser, "createLink");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(`[appStore] createLink: User ${user.id} cannot edit active simulation ${selectedScenarioId}`);
      return;
    }
    if (fromSiteId === toSiteId) return;
    const state = get();
    const fromSite = state.sites.find((site) => site.id === fromSiteId);
    const toSite = state.sites.find((site) => site.id === toSiteId);
    if (!fromSite || !toSite) return;
    const base = state.links[0];
    const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
    const inheritedFrequencyMHz = selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? defaultRadioPreset.frequencyMHz;
    const autoName = `${fromSite.name} -> ${toSite.name}`;
    const id = makeId("lnk");
    const link: Link = {
      id,
      name: name?.trim() || autoName,
      fromSiteId,
      toSiteId,
      frequencyMHz: inheritedFrequencyMHz,
      txPowerDbm: base?.txPowerDbm,
      txGainDbi: base?.txGainDbi,
      rxGainDbi: base?.rxGainDbi,
      cableLossDb: base?.cableLossDb,
      color: normalizeSimulationColor(color) ?? undefined,
    };
    set((state) => ({
      links: [...state.links, link],
      selectedLinkId: id,
      selectedSiteIds: normalizeSelectedSiteIds([fromSiteId, toSiteId], state.sites),
      selectedSiteId: fromSiteId,
      mapOverlayMode: defaultOverlayModeForSelectionCount(2),
      temporaryDirectionReversed: false,
    }));
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  addSiteLibraryEntry: (
    name,
    lat,
    lon,
    groundElevationM = 0,
    antennaHeightM = 2,
    txPowerDbm = STANDARD_SITE_RADIO.txPowerDbm,
    txGainDbi = STANDARD_SITE_RADIO.txGainDbi,
    rxGainDbi = STANDARD_SITE_RADIO.rxGainDbi,
    cableLossDb = STANDARD_SITE_RADIO.cableLossDb,
    sourceMeta,
    visibility = "private",
    description,
    iconKey,
  ) => {
    const { currentUser } = get();
    if (!currentUser?.id) {
      console.warn("[appStore] addSiteLibraryEntry: Auth required - user not logged in");
      return "";
    }
    const label = name.trim();
    if (!label) return "";
    const nowIso = new Date().toISOString();
    const normalizedMeta =
      sourceMeta && sourceMeta.sourceType === "mqtt-feed"
        ? {
            ...sourceMeta,
            sourceType: "mqtt-feed",
            importedAt: sourceMeta.importedAt ?? nowIso,
            syncedAt: nowIso,
          }
        : sourceMeta;
    const descriptionText = description?.trim() ?? "";
    const entry: SiteLibraryEntry = {
      id: makeId("libsite"),
      name: label,
      ...(descriptionText ? { description: descriptionText } : {}),
      visibility: visibility === "public" ? "shared" : visibility,
      sharedWith: [],
      position: { lat, lon },
      groundElevationM,
      antennaHeightM,
      txPowerDbm,
      txGainDbi,
      rxGainDbi,
      cableLossDb,
      iconKey,
      createdAt: nowIso,
      sourceMeta: normalizedMeta,
      ownerUserId: currentUser.id,
      createdByUserId: currentUser.id,
      createdByName: currentUser.username,
      createdByAvatarUrl: currentUser.avatarUrl ?? "",
      lastEditedByUserId: currentUser.id,
      lastEditedByName: currentUser.username,
      lastEditedByAvatarUrl: currentUser.avatarUrl ?? "",
      effectiveRole: "owner" as const,
    };
    markDirtySite(entry.id);
    set((state) => {
      const next = normalizeSiteLibrary([entry, ...state.siteLibrary]);
      writeStorage(SITE_LIBRARY_KEY, next);
      return { siteLibrary: next, ...pendingLibraryState() };
    });
    return entry.id;
  },
  deleteLink: (linkId) => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    const user = requireAuth(currentUser, "deleteLink");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(`[appStore] deleteLink: User ${user.id} cannot edit active simulation ${selectedScenarioId}`);
      return;
    }
    set((state) => {
      const remaining = state.links.filter((link) => link.id !== linkId);
      if (!remaining.length) {
        if (state.sites.length < 2) return state;
        const base = state.links[0];
        const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
        const inheritedFrequencyMHz =
          selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? base?.frequencyMHz ?? defaultRadioPreset.frequencyMHz;
        const fallbackLink: Link = {
          id: makeId("lnk"),
          name: "Auto Link",
          fromSiteId: state.sites[0].id,
          toSiteId: state.sites[1].id,
          frequencyMHz: inheritedFrequencyMHz,
          txPowerDbm: base?.txPowerDbm,
          txGainDbi: base?.txGainDbi,
          rxGainDbi: base?.rxGainDbi,
          cableLossDb: base?.cableLossDb,
        };
        return {
          links: [fallbackLink],
          selectedLinkId: fallbackLink.id,
          selectedSiteIds: normalizeSelectedSiteIds([fallbackLink.fromSiteId, fallbackLink.toSiteId], state.sites),
          selectedSiteId: fallbackLink.fromSiteId,
          mapOverlayMode: defaultOverlayModeForSelectionCount(2),
          temporaryDirectionReversed: false,
        };
      }
      return {
        links: remaining,
        selectedLinkId:
          state.selectedLinkId === linkId ? remaining[0].id : state.selectedLinkId,
        selectedSiteIds:
          state.selectedLinkId === linkId
            ? normalizeSelectedSiteIds([remaining[0].fromSiteId, remaining[0].toSiteId], state.sites)
            : state.selectedSiteIds,
        selectedSiteId:
          state.selectedLinkId === linkId
            ? remaining[0].fromSiteId
            : state.selectedSiteId,
        mapOverlayMode:
          state.selectedLinkId === linkId
            ? defaultOverlayModeForSelectionCount(2)
            : state.mapOverlayMode,
        temporaryDirectionReversed:
          state.selectedLinkId === linkId ? false : state.temporaryDirectionReversed,
      };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  insertSiteFromLibrary: (entryId) => {
    get().insertSitesFromLibrary([entryId]);
  },
  insertSitesFromLibrary: (entryIds) => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    const user = requireAuth(currentUser, "insertSitesFromLibrary");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(
        `[appStore] insertSitesFromLibrary: User ${user.id} cannot edit active simulation ${selectedScenarioId}`,
      );
      return;
    }
    const requested = new Set(entryIds);
    if (!requested.size) return;
    const current = get();
    const existingLibraryEntryIds = new Set(
      current.sites.map((site) => site.libraryEntryId).filter((value): value is string => Boolean(value)),
    );
    const entries = current.siteLibrary.filter(
      (candidate) => requested.has(candidate.id) && !existingLibraryEntryIds.has(candidate.id),
    );
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
        txPowerDbm: entry.txPowerDbm,
        txGainDbi: entry.txGainDbi,
        rxGainDbi: entry.rxGainDbi,
        cableLossDb: entry.cableLossDb,
        antennaMode: entry.antennaMode,
        antennaAzimuthDeg: entry.antennaAzimuthDeg,
        antennaTiltDeg: entry.antennaTiltDeg,
        antennaHorizontalBeamwidthDeg: entry.antennaHorizontalBeamwidthDeg,
        antennaVerticalBeamwidthDeg: entry.antennaVerticalBeamwidthDeg,
        antennaMaxAttenuationDb: entry.antennaMaxAttenuationDb,
        iconKey: entry.iconKey,
        libraryEntryId: entry.id,
      };
    });

    set((state) => {
      const nextSites = [...state.sites, ...addedSites];
      const nextSystems = state.systems.length ? state.systems : defaultScenario.systems;
      const selectedNetwork = state.networks.find((network) => network.id === state.selectedNetworkId);
      const inheritedFrequencyMHz =
        selectedNetwork?.frequencyOverrideMHz ??
        selectedNetwork?.frequencyMHz ??
        state.links[0]?.frequencyMHz ??
        defaultRadioPreset.frequencyMHz;

      const nextNetworks =
        state.networks.length > 0
          ? state.networks.map((network) => {
              const membershipBySite = new Set(network.memberships.map((member) => member.siteId));
              const additions = addedSites
                .filter((site) => !membershipBySite.has(site.id))
                .map((site) => ({ siteId: site.id, systemId: nextSystems[0].id }));
              return { ...network, memberships: [...network.memberships, ...additions] };
            })
          : [
              {
                id: makeId("network"),
                name: "Local Mesh",
                frequencyMHz: inheritedFrequencyMHz,
                bandwidthKhz: defaultRadioPreset.bandwidthKhz,
                spreadFactor: defaultRadioPreset.spreadFactor,
                codingRate: defaultRadioPreset.codingRate,
                frequencyOverrideMHz: inheritedFrequencyMHz,
                regionCode: defaultRadioPreset.regionCode,
                memberships: nextSites.map((site) => ({ siteId: site.id, systemId: nextSystems[0].id })),
              },
            ];

      const base = state.links[0];
      const nextLinks =
        state.links.length === 0 && nextSites.length >= 2
          ? [
              {
                id: makeId("lnk"),
                name: "Auto Link",
                fromSiteId: nextSites[0].id,
                toSiteId: nextSites[1].id,
                frequencyMHz: inheritedFrequencyMHz,
                txPowerDbm: base?.txPowerDbm,
                txGainDbi: base?.txGainDbi,
                rxGainDbi: base?.rxGainDbi,
                cableLossDb: base?.cableLossDb,
              },
            ]
          : state.links;

      return {
        sites: nextSites,
        systems: nextSystems,
        networks: nextNetworks,
        links: nextLinks,
        selectedSiteId: createdSiteIds[createdSiteIds.length - 1] ?? state.selectedSiteId,
        selectedSiteIds: createdSiteIds.length
          ? [createdSiteIds[createdSiteIds.length - 1]]
          : state.selectedSiteIds,
        selectedNetworkId: state.selectedNetworkId || nextNetworks[0]?.id || "",
        selectedLinkId: state.selectedLinkId || nextLinks[0]?.id || "",
        mapOverlayMode: defaultOverlayModeForSelectionCount(createdSiteIds.length ? 1 : state.selectedSiteIds.length),
      };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  updateSiteLibraryEntry: (entryId, patch) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "updateSiteLibraryEntry");
    if (!user) return;
    const entry = get().siteLibrary.find((e) => e.id === entryId);
    if (entry && !canEditItem(entry, user)) {
      console.warn(`[appStore] updateSiteLibraryEntry: User ${user.id} cannot edit entry ${entryId}`);
      return;
    }
    markDirtySite(entryId);
    set((state) => {
      const next = dedupeLibraryEntries(
        state.siteLibrary.map((entry) => {
          if (entry.id !== entryId) return entry;
          return {
            ...entry,
            ...patch,
            description: resolveDescriptionUpdate(entry.description, patch.description),
            position: {
              ...entry.position,
              ...(patch.position ?? {}),
            },
            ...(user ? {
              lastEditedByUserId: user.id,
              lastEditedByName: user.username,
              lastEditedByAvatarUrl: user.avatarUrl ?? "",
            } : {}),
          };
        }),
      );
      writeStorage(SITE_LIBRARY_KEY, next);
      const nextSites = state.siteLaunch && !state.selectedScenarioId
        ? state.sites
        : resolveTrackedSiteOrientations(syncLibraryLinkedSiteValues(state.sites, next));
      const nextSitesById = new Map(nextSites.map((site) => [site.id, site]));
      const nextLinks = state.links.map((link) =>
        stripRedundantLinkRadioOverrides(
          link,
          nextSitesById.get(link.fromSiteId),
          nextSitesById.get(link.toSiteId),
        ),
      );
      return { siteLibrary: next, sites: nextSites, links: nextLinks, ...pendingLibraryState() };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  deleteSiteLibraryEntry: async (entryId) => {
    await get().deleteSiteLibraryEntries([entryId]);
  },
  deleteSiteLibraryEntries: async (entryIds) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "deleteSiteLibraryEntries");
    if (!user) throw new Error("Sign in to delete a Site.");
    const requested = [...new Set(entryIds.filter(Boolean))];
    if (!requested.length) return;
    const state = get();
    const requestedEntries: SiteLibraryEntry[] = [];
    for (const entryId of requested) {
      const entry = state.siteLibrary.find((e) => e.id === entryId);
      if (!entry) continue;
      if (!canDeleteLibraryItem(entry, user)) {
        throw new Error("Only the Site owner or a platform admin can delete it.");
      }
      requestedEntries.push(entry);
    }

    for (const { id: entryId } of requestedEntries) {
      await deleteCloudSite(entryId);
      const deleted = new Set([entryId]);
      const affectedSimulationIds: string[] = [];
      set((current) => {
        const next = current.siteLibrary.filter((entry) => entry.id !== entryId);
        writeStorage(SITE_LIBRARY_KEY, next);
        const detachLibraryReference = <T extends { libraryEntryId?: string }>(site: T): T => {
          if (!site.libraryEntryId || !deleted.has(site.libraryEntryId)) return site;
          const detached = { ...site };
          delete detached.libraryEntryId;
          return detached;
        };
        const nextSites = current.sites.map(detachLibraryReference);
        const updatedPresets = current.simulationPresets.map((preset) => {
          const hasRef = preset.snapshot.sites.some((site) => site.libraryEntryId === entryId);
          if (!hasRef) return preset;
          affectedSimulationIds.push(preset.id);
          return {
            ...preset,
            snapshot: {
              ...preset.snapshot,
              sites: preset.snapshot.sites.map(detachLibraryReference),
            },
          };
        });
        writeStorage(SIM_PRESETS_KEY, updatedPresets);
        return { siteLibrary: next, sites: nextSites, simulationPresets: updatedPresets };
      });
      dirtySiteIds.delete(entryId);
      persistPendingLibrary();
      affectedSimulationIds.forEach(markDirtySim);
      set(pendingLibraryState());
    }

    if (dirtySimIds.size === 0) {
        localStorage.removeItem(SYNC_DIGEST_KEY);
    }
  },
  saveCurrentSimulationPreset: (name) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "saveCurrentSimulationPreset");
    if (!user) return null;
    const presetName = name.trim();
    if (!presetName) return null;
    const state = get();
    const existing = state.simulationPresets.find((preset) => preset.name === presetName);
    if (existing && !canEditItem(existing, user)) {
      console.warn(`[appStore] saveCurrentSimulationPreset: User ${user.id} cannot edit simulation ${presetName}`);
      return null;
    }
    const normalized = ensureSitesBackedByLibrary(state.sites, state.siteLibrary);
    const normalizedLinks = state.links.map((link) =>
      stripRedundantLinkRadioOverrides(
        link,
        normalized.sites.find((site) => site.id === link.fromSiteId),
        normalized.sites.find((site) => site.id === link.toSiteId),
      ),
    );
    const snapshot: SimulationPreset["snapshot"] = {
      ...buildSimulationSnapshotFromState(state),
      sites: normalized.sites,
      links: normalizedLinks,
    };

    set((current) => {
      const mergedLibrary =
        normalized.addedCount > 0
          ? normalizeSiteLibrary([...normalized.siteLibrary, ...current.siteLibrary])
          : current.siteLibrary;
      const currentSelectionDescription = current.simulationPresets.find(
        (preset) => preset.id === current.selectedScenarioId,
      )?.description;
      const nextPreset: SimulationPreset = {
        id: existing?.id ?? makeId("sim"),
        cloudRevision: existing?.cloudRevision,
        name: presetName,
        description: existing?.description ?? currentSelectionDescription,
        slug: slugifyValue(presetName),
        slugAliases: Array.from(
          new Set([
            ...((existing?.slugAliases ?? []).map((entry) => slugifyValue(entry))),
            ...(existing?.slug ? [slugifyValue(existing.slug)] : []),
          ]),
        ).filter((entry) => Boolean(entry) && entry !== slugifyValue(presetName)),
        visibility: existing?.visibility ?? "private",
        sharedWith: existing?.sharedWith ?? [],
        updatedAt: new Date().toISOString(),
        snapshot,
        ownerUserId: existing?.ownerUserId ?? user.id,
        createdByUserId: existing?.createdByUserId ?? user.id,
        createdByName: existing?.createdByName ?? user.username,
        createdByAvatarUrl: existing?.createdByAvatarUrl ?? user.avatarUrl ?? "",
        lastEditedByUserId: user.id,
        lastEditedByName: user.username,
        lastEditedByAvatarUrl: user.avatarUrl ?? "",
        effectiveRole: existing?.effectiveRole ?? "owner",
      };
      const next = [nextPreset, ...current.simulationPresets.filter((preset) => preset.id !== nextPreset.id)];
      writeStorage(SIM_PRESETS_KEY, next);
      if (normalized.addedCount > 0) {
        writeStorage(SITE_LIBRARY_KEY, mergedLibrary);
      }
      return {
        ...pendingSimulationMutation(nextPreset.id, mergedLibrary),
        simulationPresets: next,
        siteLibrary: mergedLibrary,
        sites: normalized.sites,
      };
    });
    return get().simulationPresets[0]?.id ?? null;
  },
  createSimulationCopyFromCurrent: (name, options) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "createSimulationCopyFromCurrent");
    if (!user) return null;
    const presetName = name.trim();
    if (!presetName) return null;
    const state = get();
    if (hasDuplicateSimulationName(state.simulationPresets, presetName)) return null;
    const normalized = ensureSitesBackedByLibrary(state.sites, state.siteLibrary);
    const normalizedLinks = state.links.map((link) =>
      stripRedundantLinkRadioOverrides(
        link,
        normalized.sites.find((site) => site.id === link.fromSiteId),
        normalized.sites.find((site) => site.id === link.toSiteId),
      ),
    );
    const snapshot: SimulationPreset["snapshot"] = {
      ...buildSimulationSnapshotFromState(state),
      sites: normalized.sites,
      links: normalizedLinks,
      selectedFrequencyPresetId: options?.frequencyPresetId ?? state.selectedFrequencyPresetId,
      autoPropagationEnvironment: options?.autoPropagationEnvironment ?? state.autoPropagationEnvironment,
      simulationDefaultsOverrideEnabled:
        options?.simulationDefaultsOverrideEnabled ?? state.simulationDefaultsOverrideEnabled,
      simulationDefaultsOverride: options?.simulationDefaultsOverride ?? state.simulationDefaultsOverride ?? undefined,
      linkColorMode: normalizeLinkColorMode(options?.linkColorMode ?? state.linkColorMode),
      siteIconColors: normalizeSiteIconColors(
        options?.siteIconColors ?? state.siteIconColors,
        normalized.sites.map((site) => site.id),
      ),
    };
    set((current) => {
      const mergedLibrary =
        normalized.addedCount > 0
          ? normalizeSiteLibrary([...normalized.siteLibrary, ...current.siteLibrary])
          : current.siteLibrary;
      const nextPreset = newPrivateSimulationCopy(user, presetName, snapshot, options?.description?.trim() || undefined);
      const next = [nextPreset, ...current.simulationPresets];
      writeStorage(SIM_PRESETS_KEY, next);
      if (normalized.addedCount > 0) {
        writeStorage(SITE_LIBRARY_KEY, mergedLibrary);
      }
      return {
        ...pendingSimulationMutation(nextPreset.id, mergedLibrary),
        simulationPresets: next,
        ...(normalized.addedCount > 0 ? { siteLibrary: mergedLibrary } : {}),
      };
    });
    return get().simulationPresets[0]?.id ?? null;
  },
  createBlankSimulationPreset: (name, options) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "createBlankSimulationPreset");
    if (!user) return null;
    const presetName = name.trim();
    if (!presetName) return null;
    if (hasDuplicateSimulationName(get().simulationPresets, presetName)) return null;
    const inheritedDefaults = resolveUserSimulationDefaults(user.simulationDefaultsPreference, user.defaultFrequencyPresetId);
    const defaultPresetId = inheritedDefaults.frequencyPresetId;
    const requestedCustomPreset = findCustomRadioPreset(user.simulationDefaultsPreference, options?.frequencyPresetId);
    const selectedPresetId =
      typeof options?.frequencyPresetId === "string" && (findPresetById(options.frequencyPresetId) || requestedCustomPreset)
        ? options.frequencyPresetId
        : defaultPresetId;
    set((current) => {
      const snapshot: SimulationPreset["snapshot"] = {
        sites: [],
        links: [],
        systems: current.systems.length ? current.systems : defaultScenario.systems,
        networks: [],
        selectedSiteId: "",
        selectedLinkId: "",
        selectedNetworkId: "",
        selectedCoverageResolution: current.selectedCoverageResolution,
        selectedOverlayRadiusOption: current.selectedOverlayRadiusOption,
        propagationModel: current.propagationModel,
        selectedFrequencyPresetId: selectedPresetId,
        rxSensitivityTargetDbm: inheritedDefaults.rxSensitivityTargetDbm,
        environmentLossDb: inheritedDefaults.environmentLossDb,
        propagationEnvironment: inheritedDefaults.propagationEnvironment,
        autoPropagationEnvironment: inheritedDefaults.autoPropagationEnvironment,
        terrainDataset: current.terrainDataset,
        simulationDefaultsOverrideEnabled: false,
        linkColorMode: normalizeLinkColorMode(options?.linkColorMode),
        siteIconColors: normalizeSiteIconColors(options?.siteIconColors, []),
      };
      const nextPreset: SimulationPreset = {
        id: makeId("sim"),
        name: presetName,
        ...(options?.description?.trim() ? { description: options.description.trim() } : {}),
        slug: slugifyValue(presetName),
        slugAliases: [],
        visibility: options?.visibility ?? "private",
        sharedWith: [],
        updatedAt: new Date().toISOString(),
        snapshot,
        ownerUserId: options?.ownerUserId ?? user.id,
        createdByUserId: user.id,
        createdByName: user.username,
        createdByAvatarUrl: user.avatarUrl ?? "",
        lastEditedByUserId: user.id,
        lastEditedByName: user.username,
        lastEditedByAvatarUrl: user.avatarUrl ?? "",
        effectiveRole: "owner",
      };
      const next = [nextPreset, ...current.simulationPresets];
      writeStorage(SIM_PRESETS_KEY, next);
      return { ...pendingSimulationMutation(nextPreset.id), simulationPresets: next };
    });
    return get().simulationPresets[0]?.id ?? null;
  },
  overwriteSimulationPreset: (presetId) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "overwriteSimulationPreset");
    if (!user) return;
    const state = get();
    const existing = state.simulationPresets.find((preset) => preset.id === presetId);
    if (!existing) return;
    if (!canEditItem(existing, user)) {
      console.warn(`[appStore] overwriteSimulationPreset: User ${user.id} cannot edit simulation ${presetId}`);
      return;
    }
    const normalized = ensureSitesBackedByLibrary(state.sites, state.siteLibrary);
    const normalizedLinks = state.links.map((link) =>
      stripRedundantLinkRadioOverrides(
        link,
        normalized.sites.find((site) => site.id === link.fromSiteId),
        normalized.sites.find((site) => site.id === link.toSiteId),
      ),
    );
    const snapshot: SimulationPreset["snapshot"] = {
      ...buildSimulationSnapshotFromState(state),
      sites: normalized.sites,
      links: normalizedLinks,
    };
    set((current) => {
      const mergedLibrary =
        normalized.addedCount > 0
          ? normalizeSiteLibrary([...normalized.siteLibrary, ...current.siteLibrary])
          : current.siteLibrary;
      const nextPreset: SimulationPreset = {
        id: existing.id,
        cloudRevision: existing.cloudRevision,
        name: existing.name,
        description: existing.description,
        slug: existing.slug ?? slugifyValue(existing.name),
        slugAliases: existing.slugAliases ?? [],
        visibility: existing.visibility ?? "private",
        sharedWith: existing.sharedWith ?? [],
        updatedAt: new Date().toISOString(),
        snapshot,
        ownerUserId: existing.ownerUserId,
        createdByUserId: existing.createdByUserId,
        createdByName: existing.createdByName,
        createdByAvatarUrl: existing.createdByAvatarUrl,
        lastEditedByUserId: user.id,
        lastEditedByName: user.username,
        lastEditedByAvatarUrl: user.avatarUrl ?? "",
        effectiveRole: existing.effectiveRole ?? "owner",
      };
      const next = [nextPreset, ...current.simulationPresets.filter((preset) => preset.id !== nextPreset.id)];
      writeStorage(SIM_PRESETS_KEY, next);
      if (normalized.addedCount > 0) {
        writeStorage(SITE_LIBRARY_KEY, mergedLibrary);
      }
      return {
        ...pendingSimulationMutation(nextPreset.id, mergedLibrary),
        simulationPresets: next,
        siteLibrary: mergedLibrary,
        sites: normalized.sites,
      };
    });
  },
  updateCurrentSimulationSnapshot: () => {
    const { currentUser, selectedScenarioId, simulationPresets, sites, links, systems, networks } = get();
    const user = requireAuth(currentUser, "updateCurrentSimulationSnapshot");
    if (!user) return;
    if (!selectedScenarioId) return;
    const presetIndex = simulationPresets.findIndex((p) => p.id === selectedScenarioId);
    if (presetIndex === -1) return;

    const preset = simulationPresets[presetIndex];
    if (!canEditItem(preset, user)) {
      console.warn(
        `[appStore] updateCurrentSimulationSnapshot: User ${user.id} cannot edit simulation ${selectedScenarioId}`,
      );
      return;
    }
    const normalizedSites = ensureSitesBackedByLibrary(sites, get().siteLibrary);
    const normalizedLinks = links.map((link) =>
      stripRedundantLinkRadioOverrides(
        link,
        normalizedSites.sites.find((site) => site.id === link.fromSiteId),
        normalizedSites.sites.find((site) => site.id === link.toSiteId),
      ),
    );
    
    const updatedPreset: SimulationPreset = {
      ...preset,
      snapshot: {
        sites: normalizedSites.sites,
        links: normalizedLinks,
        systems,
        networks,
        selectedSiteId: get().selectedSiteId,
        selectedLinkId: get().selectedLinkId,
        selectedNetworkId: get().selectedNetworkId,
        selectedCoverageResolution: get().selectedCoverageResolution,
        selectedOverlayRadiusOption: get().selectedOverlayRadiusOption,
        propagationModel: get().propagationModel,
        selectedFrequencyPresetId: get().selectedFrequencyPresetId,
        rxSensitivityTargetDbm: get().rxSensitivityTargetDbm,
        environmentLossDb: get().environmentLossDb,
        propagationEnvironment: get().propagationEnvironment,
        autoPropagationEnvironment: get().autoPropagationEnvironment,
        terrainDataset: get().terrainDataset,
        simulationDefaultsOverrideEnabled: get().simulationDefaultsOverrideEnabled,
        simulationDefaultsOverride: get().simulationDefaultsOverride ?? undefined,
        linkColorMode: get().linkColorMode,
        siteIconColors: normalizeSiteIconColors(
          get().siteIconColors,
          normalizedSites.sites.map((site) => site.id),
        ),
      },
      updatedAt: new Date().toISOString(),
      lastEditedByUserId: user.id,
      lastEditedByName: user.username,
      lastEditedByAvatarUrl: user.avatarUrl ?? "",
    };
    
    const newPresets = [...simulationPresets];
    newPresets[presetIndex] = updatedPreset;
    const nextSiteLibrary =
      normalizedSites.addedCount > 0
        ? normalizeSiteLibrary([...normalizedSites.siteLibrary, ...get().siteLibrary])
        : get().siteLibrary;
    if (normalizedSites.addedCount > 0) {
      writeStorage(SITE_LIBRARY_KEY, nextSiteLibrary);
    }
    writeStorage(SIM_PRESETS_KEY, newPresets);
    set({ ...pendingSimulationMutation(selectedScenarioId, nextSiteLibrary),
      simulationPresets: newPresets, siteLibrary: nextSiteLibrary, sites: normalizedSites.sites });
    console.log("[appStore] Updated current simulation snapshot");
  },
  loadSimulationPreset: (presetId) => {
    const preset = get().simulationPresets.find((candidate) => candidate.id === presetId);
    if (!preset || preset.status === "deleted") return;
    get().cancelTerrainLoad();
    const snap = preset.snapshot;
    const rawSites = Array.isArray(snap.sites) ? snap.sites : [];
    const rawLinks = Array.isArray(snap.links) ? snap.links : [];
    const migratedSnap = migrateSitesAndLinksToSiteRadioDefaults(rawSites, rawLinks);
    const effectiveDefaults = resolveEffectiveSimulationDefaultsForSnapshot(snap, get().currentUser);
    const isBlankSnapshot = rawSites.length === 0 && rawLinks.length === 0;
    if (isBlankSnapshot) {
      const snapshotSystems = Array.isArray(snap.systems) && snap.systems.length ? snap.systems : defaultScenario.systems;
      const snapshotNetworks = Array.isArray(snap.networks) ? snap.networks : [];
      const viewport = defaultScenario.viewport;
      const loadedAtIso = new Date().toISOString();
      set({
        selectedScenarioId: preset.id,
        siteLaunch: null,
        workspaceNavigationEpoch: get().workspaceNavigationEpoch + 1,
        sites: [],
        links: [],
        systems: snapshotSystems,
        networks: snapshotNetworks,
        selectedSiteId: "",
        selectedSiteIds: [],
        selectedLinkId: "",
        temporaryDirectionReversed: false,
        linkColorMode: normalizeLinkColorMode(snap.linkColorMode),
        siteIconColors: {},
        selectedNetworkId: "",
        selectedCoverageResolution: normalizeCoverageResolution(snap.selectedCoverageResolution),
        selectedOverlayRadiusOption: isOverlayRadiusOption(snap.selectedOverlayRadiusOption)
          ? snap.selectedOverlayRadiusOption
          : defaultOptionForSelectionCount(0),
        propagationModel: "ITM" as const,
        selectedFrequencyPresetId: effectiveDefaults.frequencyPresetId,
        rxSensitivityTargetDbm: effectiveDefaults.rxSensitivityTargetDbm,
        environmentLossDb: effectiveDefaults.environmentLossDb,
        propagationEnvironment: effectiveDefaults.propagationEnvironment,
        autoPropagationEnvironment: effectiveDefaults.autoPropagationEnvironment,
        simulationDefaultsOverrideEnabled: Boolean(snap.simulationDefaultsOverrideEnabled),
        simulationDefaultsOverride: snap.simulationDefaultsOverride ?? null,
        propagationEnvironmentReason: effectiveDefaults.autoPropagationEnvironment
          ? "Auto defaults active."
          : "Manual override active.",
        terrainDataset: normalizeTerrainDataset(snap.terrainDataset),
        mapViewport: viewport,
        siteDragPreview: {},
        mapOverlayMode: defaultOverlayModeForSelectionCount(0),
        terrainFetchStatus: `Loaded simulation preset: ${preset.name}`,
        fitSitesEpoch: get().fitSitesEpoch + 1,
      });
      writeStorage(LAST_SESSION_KEY, { selectedScenarioId: preset.id, savedAtIso: loadedAtIso });
      useCoverageStore.getState().recomputeCoverage();
      return;
    }
    const recovered = ensureMinimumTopology(
      migratedSnap.sites,
      migratedSnap.links.map((link) => ({
        ...link,
        color: normalizeSimulationColor(link.color) ?? undefined,
      })),
      Array.isArray(snap.systems) ? snap.systems : [],
      Array.isArray(snap.networks) ? snap.networks : [],
    );
    const siteLibrary = libraryForSimulationView(get().siteLibrary, presetId);
    const recoveredSites = syncLibraryLinkedSiteValues(annotateSitesWithLibraryRefs(recovered.sites, siteLibrary), siteLibrary);
    const bounds = simulationAreaBoundsForSites(recoveredSites);
    const viewport = bounds ? boundsToViewport(bounds) : defaultScenario.viewport;
    const selectedSiteId = recoveredSites.some((site) => site.id === snap.selectedSiteId)
      ? snap.selectedSiteId
      : recoveredSites[0].id;
    const selectedLinkId = recovered.links.some((link) => link.id === snap.selectedLinkId)
      ? snap.selectedLinkId
      : recovered.links[0]?.id ?? "";
    const selectedNetworkId = recovered.networks.some((network) => network.id === snap.selectedNetworkId)
      ? snap.selectedNetworkId
      : recovered.networks[0].id;
    set({
      selectedScenarioId: preset.id,
      siteLaunch: null,
      workspaceNavigationEpoch: get().workspaceNavigationEpoch + 1,
      sites: recoveredSites,
      links: recovered.links,
      systems: recovered.systems,
      networks: recovered.networks,
      selectedSiteId,
      selectedSiteIds: selectedSiteId ? [selectedSiteId] : [],
      selectedLinkId,
      temporaryDirectionReversed: false,
      linkColorMode: normalizeLinkColorMode(snap.linkColorMode),
      siteIconColors: normalizeSiteIconColors(
        snap.siteIconColors,
        recoveredSites.map((site) => site.id),
      ),
      selectedNetworkId,
      selectedCoverageResolution: normalizeCoverageResolution(snap.selectedCoverageResolution),
      selectedOverlayRadiusOption: isOverlayRadiusOption(snap.selectedOverlayRadiusOption)
        ? snap.selectedOverlayRadiusOption
        : defaultOptionForSelectionCount(selectedSiteId ? 1 : 0),
      propagationModel: "ITM" as const,
      selectedFrequencyPresetId: effectiveDefaults.frequencyPresetId,
      rxSensitivityTargetDbm: effectiveDefaults.rxSensitivityTargetDbm,
      environmentLossDb: effectiveDefaults.environmentLossDb,
      propagationEnvironment: effectiveDefaults.propagationEnvironment,
      autoPropagationEnvironment: effectiveDefaults.autoPropagationEnvironment,
      simulationDefaultsOverrideEnabled: Boolean(snap.simulationDefaultsOverrideEnabled),
      simulationDefaultsOverride: snap.simulationDefaultsOverride ?? null,
      propagationEnvironmentReason: effectiveDefaults.autoPropagationEnvironment
        ? "Auto defaults active."
        : "Manual override active.",
      terrainDataset:
        normalizeTerrainDataset(snap.terrainDataset),
      mapViewport: viewport,
      siteDragPreview: {},
      terrainFetchStatus: `Loaded simulation preset: ${preset.name}`,
      mapOverlayMode: defaultOverlayModeForSelectionCount(selectedSiteId ? 1 : 0),
      fitSitesEpoch: get().fitSitesEpoch + 1,
    });
    writeStorage(LAST_SESSION_KEY, { selectedScenarioId: preset.id, savedAtIso: new Date().toISOString() });
    useCoverageStore.getState().recomputeCoverage();
  },
  clearSimulationWorkspace: (launch) => {
    get().cancelTerrainLoad();
    const currentUser = get().currentUser;
    const defaults = resolveUserSimulationDefaults(
      currentUser?.simulationDefaultsPreference,
      currentUser?.defaultFrequencyPresetId,
    );
    if (!launch) {
      try {
        localStorage.removeItem(LAST_SESSION_KEY);
        localStorage.removeItem(LAST_SIMULATION_REF_KEY);
      } catch {
        // Best effort only.
      }
    }
    const site = launch ? withSiteRadioDefaults({
      ...STANDARD_SITE_RADIO,
      groundElevationM: 0,
      antennaHeightM: 2,
      ...launch.site,
      id: makeId("site"),
    }) : null;
    clearTerrainLossCache();
    set({
      selectedScenarioId: "",
      sites: site ? [site] : [],
      siteLaunch: site && launch ? { siteId: site.id, source: launch.source, needsElevation: launch.site.groundElevationM === undefined } : null,
      workspaceNavigationEpoch: get().workspaceNavigationEpoch + 1,
      links: [],
      systems: defaultScenario.systems,
      networks: [],
      selectedSiteId: site?.id ?? "",
      selectedSiteIds: site ? [site.id] : [],
      selectedLinkId: "",
      selectedNetworkId: "",
      temporaryDirectionReversed: false,
      profileCursorIndex: 0,
      linkColorMode: DEFAULT_LINK_COLOR_MODE,
      siteIconColors: site && launch?.iconColor ? { [site.id]: launch.iconColor } : {},
      selectedCoverageResolution: "24",
      selectedOverlayRadiusOption: defaultOptionForSelectionCount(site ? 1 : 0),
      selectedFrequencyPresetId: defaults.frequencyPresetId,
      rxSensitivityTargetDbm: defaults.rxSensitivityTargetDbm,
      environmentLossDb: defaults.environmentLossDb,
      propagationEnvironment: defaults.propagationEnvironment,
      autoPropagationEnvironment: defaults.autoPropagationEnvironment,
      propagationEnvironmentReason: defaults.autoPropagationEnvironment
        ? "Auto defaults active."
        : "Manual override active.",
      simulationDefaultsOverrideEnabled: false,
      simulationDefaultsOverride: null,
      terrainFetchStatus: "",
      terrainRecommendation: "",
      isHighResTerrainLoaded: false,
      terrainLoadingStartedAtMs: 0,
      terrainLoadEpoch: get().terrainLoadEpoch + 1,
      terrainProgressPercent: 0,
      terrainProgressTilesLoaded: 0,
      terrainProgressTilesTotal: 0,
      terrainProgressBytesLoaded: 0,
      terrainProgressBytesEstimated: 0,
      terrainProgressTransientDecodeBytesEstimated: 0,
      terrainProgressPhaseLabel: "",
      terrainProgressPhaseIndex: 0,
      terrainProgressPhaseTotal: 0,
      terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics([]),
      siteDragPreview: {},
      endpointPickTarget: null,
      mapEditor: null,
      mapEditorSiteDraft: null,
      mapOverlayMode: defaultOverlayModeForSelectionCount(site ? 1 : 0),
      mapViewport: site ? { center: site.position, zoom: 12 } : defaultScenario.viewport,
      fitSitesEpoch: get().fitSitesEpoch + 1,
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
      completedCoverageRunToken: "",
      calculationCycleSource: null,
    });
    if (site) useCoverageStore.getState().recomputeCoverage();
  },
  renameSimulationPreset: (presetId, name) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "renameSimulationPreset");
    if (!user) return;
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (!existing) return;
    if (!canEditItem(existing, user)) {
      console.warn(`[appStore] renameSimulationPreset: User ${user.id} cannot edit simulation ${presetId}`);
      return;
    }
    const nextName = name.trim();
    if (!nextName) return;
    if (hasDuplicateSimulationName(get().simulationPresets, nextName, presetId)) return;
    set((state) => {
      const next = state.simulationPresets.map((preset) =>
        preset.id === presetId
          ? (() => {
              const nextSlug = slugifyValue(nextName);
              const aliasSet = new Set([
                ...(preset.slug ? [slugifyValue(preset.slug)] : []),
                ...((preset.slugAliases ?? []).map((entry) => slugifyValue(entry))),
              ]);
              aliasSet.delete(nextSlug);
              return {
                ...preset,
                name: nextName,
                slug: nextSlug,
                slugAliases: Array.from(aliasSet).filter(Boolean),
                updatedAt: new Date().toISOString(),
                lastEditedByUserId: user.id,
                lastEditedByName: user.username,
                lastEditedByAvatarUrl: user.avatarUrl ?? "",
              };
            })()
          : preset,
      );
      writeStorage(SIM_PRESETS_KEY, next);
      return { ...pendingSimulationMutation(presetId), simulationPresets: next };
    });
  },
  updateSimulationPresetEntry: (presetId, patch) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "updateSimulationPresetEntry");
    if (!user) return;
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (!existing) return;
    if (!canEditItem(existing, user)) {
      console.warn(`[appStore] updateSimulationPresetEntry: User ${user.id} cannot edit simulation ${presetId}`);
      return;
    }
    if (typeof patch.name === "string") {
      const candidate = patch.name.trim();
      if (!candidate) return;
      if (hasDuplicateSimulationName(get().simulationPresets, candidate, presetId)) return;
    }
    set((state) => {
      const next = state.simulationPresets.map((preset) => {
        if (preset.id !== presetId) return preset;
        const nextName = typeof patch.name === "string" ? patch.name.trim() : preset.name;
        const nextDescription = resolveDescriptionUpdate(preset.description, patch.description);
        const nextSlug = slugifyValue(nextName || preset.name);
        const aliasSet = new Set([
          ...(preset.slug ? [slugifyValue(preset.slug)] : []),
          ...((preset.slugAliases ?? []).map((entry) => slugifyValue(entry))),
        ]);
        aliasSet.delete(nextSlug);
        const nextVisibility = patch.visibility ?? preset.visibility ?? "private";
        const snapshotPatch =
          patch.simulationDefaultsOverrideEnabled !== undefined ||
          patch.simulationDefaultsOverride !== undefined ||
          patch.linkColorMode !== undefined ||
          patch.siteIconColors !== undefined
            ? {
                snapshot: {
                  ...preset.snapshot,
                  simulationDefaultsOverrideEnabled:
                    patch.simulationDefaultsOverrideEnabled ?? preset.snapshot.simulationDefaultsOverrideEnabled,
                  simulationDefaultsOverride:
                    patch.simulationDefaultsOverride === null
                      ? undefined
                      : patch.simulationDefaultsOverride ?? preset.snapshot.simulationDefaultsOverride,
                  linkColorMode: normalizeLinkColorMode(
                    patch.linkColorMode ?? preset.snapshot.linkColorMode,
                  ),
                  siteIconColors: normalizeSiteIconColors(
                    patch.siteIconColors ?? preset.snapshot.siteIconColors,
                    preset.snapshot.sites.map((site) => site.id),
                  ),
                },
              }
            : {};
        return {
          ...preset,
          ...snapshotPatch,
          name: nextName,
          description: nextDescription,
          slug: nextSlug,
          slugAliases: Array.from(aliasSet).filter(Boolean),
          visibility: nextVisibility,
          sharedWith: patch.sharedWith ?? preset.sharedWith,
          updatedAt: new Date().toISOString(),
          lastEditedByUserId: user.id,
          lastEditedByName: user.username,
          lastEditedByAvatarUrl: user.avatarUrl ?? "",
        };
      });
      writeStorage(SIM_PRESETS_KEY, next);
      const activeAppearance = state.selectedScenarioId === presetId
        ? {
            linkColorMode: normalizeLinkColorMode(patch.linkColorMode ?? state.linkColorMode),
            siteIconColors: normalizeSiteIconColors(
              patch.siteIconColors ?? state.siteIconColors,
              state.sites.map((site) => site.id),
            ),
          }
        : {};
      return { ...pendingSimulationMutation(presetId), simulationPresets: next, ...activeAppearance };
    });
  },
  applyDeletedSimulationTombstones: (presetIds) => {
    const deletedIds = new Set((presetIds ?? []).filter(Boolean));
    if (!deletedIds.size) return;
    const state = get();
    const deletingActiveSimulation = deletedIds.has(state.selectedScenarioId);
    set((state) => {
      const next = state.simulationPresets.filter((preset) => !deletedIds.has(preset.id));
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
    deletedIds.forEach((id) => dirtySimIds.delete(id));
    set((current) => ({ simulationConflictIds: current.simulationConflictIds.filter((id) => !deletedIds.has(id)) }));
    persistPendingLibrary();
    if (deletingActiveSimulation) get().clearSimulationWorkspace();
  },
  applyDeletedSiteTombstones: (siteIds) => {
    const deletedIds = new Set((siteIds ?? []).filter(Boolean));
    if (!deletedIds.size) return;
    set((state) => {
      const next = state.siteLibrary.filter((site) => !deletedIds.has(site.id));
      const nextSites = detachDeletedSiteLibraryReferences(state.sites, deletedIds);
      const nextPresets = detachDeletedSiteReferencesFromPresets(state.simulationPresets, deletedIds);
      writeStorage(SITE_LIBRARY_KEY, next);
      writeStorage(SIM_PRESETS_KEY, nextPresets);
      return { siteLibrary: next, sites: nextSites, simulationPresets: nextPresets };
    });
    deletedIds.forEach((id) => dirtySiteIds.delete(id));
    persistPendingLibrary();
  },
  deleteSimulationPreset: async (presetId) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "deleteSimulationPreset");
    if (!user) throw new Error("Sign in to delete a Simulation.");
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (!existing) throw new Error("Simulation not found.");
    const ownsSimulation = existing.effectiveRole !== "viewer"
      && (existing.ownerUserId === user.id || existing.effectiveRole === "owner");
    if (!user.isAdmin && !ownsSimulation) {
      throw new Error("Only the Simulation owner or a platform admin can delete it.");
    }
    const deletingActiveSimulation = get().selectedScenarioId === presetId;
    await deleteCloudSimulation(presetId);
    dirtySimIds.delete(presetId);
    persistPendingLibrary();
    set((current) => ({ simulationConflictIds: current.simulationConflictIds.filter((id) => id !== presetId) }));
    set((state) => {
      const next = user.isAdmin
        ? state.simulationPresets.map((preset) =>
            preset.id === presetId ? { ...preset, status: "deleted" as const, updatedAt: new Date().toISOString() } : preset,
          )
        : state.simulationPresets.filter((preset) => preset.id !== presetId);
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next, ...pendingLibraryState() };
    });
    if (deletingActiveSimulation) {
      get().clearSimulationWorkspace();
    }
    localStorage.removeItem(SYNC_DIGEST_KEY);
  },
  restoreSimulationPreset: async (presetId) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "restoreSimulationPreset");
    if (!user) throw new Error("Sign in to restore a Simulation.");
    if (!user.isAdmin) throw new Error("Only a platform admin can restore a Simulation.");
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (!existing) throw new Error("Simulation not found.");
    const generation = syncAccountGeneration;
    await restoreCloudSimulation(presetId);
    const cloud = partitionTrustedCloudLibrary(await fetchCloudLibrary());
    if (generation !== syncAccountGeneration) return;
    const restored = cloud.simulationPresets.find((preset) => preset.id === presetId);
    if (!restored || restored.status === "deleted") {
      throw new Error("The Simulation was restored, but LinkSim could not reload it. Run Manual Sync to refresh the Library.");
    }
    get().importLibraryData({ simulationPresets: [restored] }, "merge");
  },
  importLibraryData: (bundle, mode, source = "trusted-cloud") => {
    const partitioned = partitionLibraryPayload({
      siteLibrary: bundle.siteLibrary,
      simulationPresets: bundle.simulationPresets,
    });
    if (partitioned.rejected.length) {
      quarantineLibraryRecords(partitioned.rejected, source);
      throw new Error(`Rejected ${partitioned.rejected.length} malformed Library record(s).`);
    }
    let incomingSites = normalizeSiteLibrary(partitioned.siteLibrary as SiteLibraryEntry[]);
    let incomingPresets = normalizeSimulationPresets(partitioned.simulationPresets as SimulationPreset[]);
    const current = get();
    if (source === "public-view-only") {
      const protectedRole = (entry: { effectiveRole?: string }): boolean => entry.effectiveRole !== "viewer";
      const currentSitesById = new Map(current.siteLibrary.map((entry) => [entry.id, entry]));
      const currentSimulationsById = new Map(current.simulationPresets.map((entry) => [entry.id, entry]));
      const collided = incomingSites.some((entry) => {
        const existing = currentSitesById.get(entry.id);
        return Boolean(existing && protectedRole(existing));
      }) || incomingPresets.some((entry) => {
        const existing = currentSimulationsById.get(entry.id);
        return Boolean(existing && protectedRole(existing));
      });
      if (collided && current.currentUser) {
        throw new Error("Public Library data conflicts with an existing local record.");
      }
      incomingSites = incomingSites.map((entry) => ({ ...entry, effectiveRole: "viewer" as const }));
      incomingPresets = incomingPresets.map((entry) => ({ ...entry, effectiveRole: "viewer" as const }));
    }
    const siteCountBefore = current.siteLibrary.length;
    const previousActive = current.simulationPresets.find(({ id }) => id === current.selectedScenarioId);
    const simCountBefore = current.simulationPresets.length;
    const preserveForeignCache = (
      existing: { ownerUserId?: string; effectiveRole?: string; sharedWith?: Array<{ userId: string; role: string }> } | undefined,
      incoming: { effectiveRole?: string },
    ): boolean => Boolean(
      source === "trusted-cloud" && existing && current.currentUser && !current.currentUser.isAdmin
      && existing.ownerUserId && existing.ownerUserId !== current.currentUser.id
      && existing.effectiveRole !== "viewer" && incoming.effectiveRole === "viewer"
      && !canEditLibraryItem(existing, current.currentUser)
    );

    const isOlderCloudRecord = (
      existing: { cloudRevision?: string | null } | undefined,
      incoming: { cloudRevision?: string | null },
    ): boolean => Boolean(source === "trusted-cloud" && existing?.cloudRevision && incoming.cloudRevision &&
      incoming.cloudRevision < existing.cloudRevision);

    const nextSiteLibrary =
      mode === "replace"
        ? incomingSites
        : (() => {
            const byId = new Map(current.siteLibrary.map((entry) => [entry.id, entry]));
            for (const entry of incomingSites) {
              if ((source !== "trusted-cloud" || !dirtySiteIds.has(entry.id)) && !preserveForeignCache(byId.get(entry.id), entry) && !isOlderCloudRecord(byId.get(entry.id), entry)) {
                byId.set(entry.id, entry);
              }
            }
            return normalizeSiteLibrary([...byId.values()]);
          })();

    const mergedSimulationPresets =
      mode === "replace"
        ? incomingPresets
        : (() => {
            const byId = new Map<string, SimulationPreset>();
            for (const preset of current.simulationPresets) byId.set(preset.id, preset);
            for (const preset of incomingPresets) {
              if ((source !== "trusted-cloud" || !dirtySimIds.has(preset.id)) && !preserveForeignCache(byId.get(preset.id), preset) && !isOlderCloudRecord(byId.get(preset.id), preset)) {
                byId.set(preset.id, preset);
              }
            }
            return normalizeSimulationPresets(Array.from(byId.values())).sort((a, b) =>
              a.updatedAt < b.updatedAt ? 1 : -1,
            );
          })();

    // Keep the cloud values in clean snapshots when the corresponding Library
    // entry is being held locally as a draft. This also covers Site-only deltas.
    const pendingCloudSites = source === "trusted-cloud"
      ? incomingSites.filter(({ id }) => dirtySiteIds.has(id))
      : [];
    const pendingCloudSiteIds = new Set(pendingCloudSites.map(({ id }) => id));
    const nextSimulationPresets = pendingCloudSites.length
      ? mergedSimulationPresets.map((preset) => {
          if (dirtySimIds.has(preset.id) || !preset.snapshot.sites.some(
            (site) => site.libraryEntryId && pendingCloudSiteIds.has(site.libraryEntryId),
          )) return preset;
          return { ...preset, snapshot: { ...preset.snapshot,
            sites: syncLibraryLinkedSiteValues(preset.snapshot.sites, pendingCloudSites),
          } };
        })
      : mergedSimulationPresets;

    const preserveWorkspaceSites = source === "public-view-only" || Boolean(current.siteLaunch && !current.selectedScenarioId);
    const workspaceLibrary = [
      ...libraryForSimulationView(nextSiteLibrary, current.selectedScenarioId),
      ...(current.selectedScenarioId && !dirtySimIds.has(current.selectedScenarioId) ? pendingCloudSites : []),
    ];
    const syncedSites = preserveWorkspaceSites
      ? current.sites
      : syncLibraryLinkedSiteValues(annotateSitesWithLibraryRefs(current.sites, workspaceLibrary), workspaceLibrary);

    if (source !== "public-view-only") {
      writeStorage(SITE_LIBRARY_KEY, nextSiteLibrary);
      writeStorage(SIM_PRESETS_KEY, nextSimulationPresets);
    }
    set({
      siteLibrary: nextSiteLibrary,
      simulationPresets: nextSimulationPresets,
      sites: syncedSites,
    });
    const nextActive = nextSimulationPresets.find(({ id }) => id === current.selectedScenarioId);
    if (source === "trusted-cloud" && previousActive && nextActive?.cloudRevision &&
        previousActive.cloudRevision !== nextActive.cloudRevision) {
      get().loadSimulationPreset(nextActive.id);
    } else {
      useCoverageStore.getState().recomputeCoverage();
    }
    return {
      siteCount: nextSiteLibrary.length - siteCountBefore,
      simulationCount: nextSimulationPresets.length - simCountBefore,
    };
  },
  setEndpointPickTarget: (target) => set({ endpointPickTarget: target }),
  openMapEditor: (payload) => set({ mapEditor: payload, mapEditorSiteDraft: null }),
  closeMapEditor: () => set({ mapEditor: null, mapEditorSiteDraft: null }),
  setMapEditorSiteDraft: (draft) => set({ mapEditorSiteDraft: draft }),
  requestSiteLibraryDraftAt: (lat, lon, suggestedName, sourceMeta) =>
    set({
      pendingSiteLibraryDraft: {
        lat,
        lon,
        token: makeId("draft"),
        suggestedName: typeof suggestedName === "string" ? suggestedName : undefined,
        sourceMeta:
          sourceMeta && sourceMeta.sourceType === "mqtt-feed"
            ? {
                ...sourceMeta,
                sourceType: "mqtt-feed",
              }
            : undefined,
      },
    }),
  clearPendingSiteLibraryDraft: () => set({ pendingSiteLibraryDraft: null }),
  openLibrary: (tab) => set({ libraryRequest: { tab } }),
  closeLibrary: () => set({ libraryRequest: null }),
  setShowNewSimulationRequest: (show) => set({ showNewSimulationRequest: show }),
  requestOpenSiteLibraryEntry: (entryId) =>
    set({
      pendingSiteLibraryOpenEntryId: entryId.trim() ? entryId : null,
    }),
  clearOpenSiteLibraryEntryRequest: () => set({ pendingSiteLibraryOpenEntryId: null }),
  setMapOverlayMode: (mode) => {
    let changed = false;
    set((state) => {
      if (state.mapOverlayMode === mode) return state;
      changed = true;
      return { mapOverlayMode: mode };
    });
    if (changed) useCoverageStore.getState().recomputeCoverage();
  },
  setDiscoveryVisibility: ({ libraryVisible, mqttVisible }) =>
    set((state) => {
      if (
        state.discoveryLibraryVisible === libraryVisible &&
        state.discoveryMqttVisible === mqttVisible
      ) {
        return state;
      }
      return {
        discoveryLibraryVisible: libraryVisible,
        discoveryMqttVisible: mqttVisible,
      };
    }),
  setMapDiscoveryMqttNodes: (nodes) =>
    set((state) => {
      if (
        state.mapDiscoveryMqttNodes.length === nodes.length &&
        state.mapDiscoveryMqttNodes.every((node, index) => node.nodeId === nodes[index]?.nodeId)
      ) {
        return state;
      }
      return { mapDiscoveryMqttNodes: nodes };
    }),
  applyFrequencyPresetToSelectedNetwork: () => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    const user = requireAuth(currentUser, "applyFrequencyPresetToSelectedNetwork");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(
        `[appStore] applyFrequencyPresetToSelectedNetwork: User ${user.id} cannot edit active simulation ${selectedScenarioId}`,
      );
      return;
    }
    const { selectedFrequencyPresetId, selectedNetworkId } = get();
    const preset = findPresetById(selectedFrequencyPresetId);
    const customPreset = findCustomRadioPreset(user.simulationDefaultsPreference, selectedFrequencyPresetId);
    if (!preset && !customPreset) return;
    const defaults = customPreset?.defaults ?? simulationDefaultsFromPreset(preset?.id ?? FALLBACK_SIMULATION_PRESET_ID);

    set((state) => ({
      networks: state.networks.map((network) =>
        network.id === selectedNetworkId
          ? {
              ...network,
              frequencyMHz: defaults.frequencyMHz,
              bandwidthKhz: defaults.bandwidthKhz,
              spreadFactor: defaults.spreadFactor,
              codingRate: defaults.codingRate,
              frequencyOverrideMHz: defaults.frequencyMHz,
              regionCode: defaults.regionCode,
            }
          : network,
      ),
      links: state.links.map((link) => ({ ...link, frequencyMHz: defaults.frequencyMHz })),
      rxSensitivityTargetDbm: defaults.rxSensitivityTargetDbm,
      environmentLossDb: defaults.environmentLossDb,
      propagationEnvironment: defaults.propagationEnvironment,
      autoPropagationEnvironment: defaults.autoPropagationEnvironment,
    }));
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  updateSite: (id, patch) => {
    const { currentUser, sites, siteLibrary, selectedScenarioId, simulationPresets, siteLaunch } = get();
    if (!selectedScenarioId && siteLaunch && id === siteLaunch.siteId) {
      const site = sites.find((candidate) => candidate.id === id);
      if (!site) return;
      const moved = patch.position && (patch.position.lat !== site.position.lat || patch.position.lon !== site.position.lon);
      set({
        sites: sites.map((candidate) => candidate.id === id ? withSiteRadioDefaults({ ...candidate, ...patch }) : candidate),
        siteLaunch: {
          ...siteLaunch,
          needsElevation: patch.groundElevationM !== undefined ? false : Boolean(moved) || siteLaunch.needsElevation,
        },
      });
      useCoverageStore.getState().recomputeCoverage();
      return;
    }
    const user = requireAuth(currentUser, "updateSite");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(`[appStore] updateSite: User ${user.id} cannot edit active simulation ${selectedScenarioId}`);
      return;
    }
    const existingSite = sites.find((site) => site.id === id);
    if (existingSite?.libraryEntryId) {
      const linkedEntry = siteLibrary.find((entry) => entry.id === existingSite.libraryEntryId);
      if (linkedEntry && !canEditItem(linkedEntry, user)) {
        console.warn(`[appStore] updateSite: User ${user.id} cannot edit linked site library entry ${linkedEntry.id}`);
        return;
      }
    }
    set((state) => {
      const nextSites = resolveTrackedSiteOrientations(state.sites.map((site) =>
        site.id === id ? withSiteRadioDefaults({ ...site, ...patch }) : site,
      ));
      const updatedSite = nextSites.find((site) => site.id === id);
      if (!updatedSite?.libraryEntryId) {
        return { sites: nextSites };
      }
      const nextLibrary = state.siteLibrary.map((entry) =>
        entry.id === updatedSite.libraryEntryId
          ? {
              ...entry,
              name: updatedSite.name,
              position: updatedSite.position,
              groundElevationM: updatedSite.groundElevationM,
              antennaHeightM: updatedSite.antennaHeightM,
              txPowerDbm: updatedSite.txPowerDbm,
              txGainDbi: updatedSite.txGainDbi,
              rxGainDbi: updatedSite.rxGainDbi,
              cableLossDb: updatedSite.cableLossDb,
              antennaMode: updatedSite.antennaMode,
              ...(updatedSite.antennaTargetSiteId
                ? {}
                : {
                    antennaAzimuthDeg: updatedSite.antennaAzimuthDeg,
                    antennaTiltDeg: updatedSite.antennaTiltDeg,
                  }),
              antennaHorizontalBeamwidthDeg: updatedSite.antennaHorizontalBeamwidthDeg,
              antennaVerticalBeamwidthDeg: updatedSite.antennaVerticalBeamwidthDeg,
              antennaMaxAttenuationDb: updatedSite.antennaMaxAttenuationDb,
              iconKey: updatedSite.iconKey,
            }
          : entry,
      );
      const previousEntry = state.siteLibrary.find(({ id }) => id === updatedSite.libraryEntryId);
      const updatedEntry = nextLibrary.find(({ id }) => id === updatedSite.libraryEntryId);
      if (updatedEntry && JSON.stringify(previousEntry) !== JSON.stringify(updatedEntry)) markDirtySite(updatedEntry.id);
      writeStorage(SITE_LIBRARY_KEY, nextLibrary);
      return { sites: nextSites, siteLibrary: nextLibrary, ...pendingLibraryState() };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  setSiteDragPreview: (id, preview) =>
    set((state) => ({
      siteDragPreview: { ...state.siteDragPreview, [id]: preview },
    })),
  clearSiteDragPreview: (id) =>
    set((state) => {
      if (!id) return { siteDragPreview: {} };
      if (!(id in state.siteDragPreview)) return {};
      const next = { ...state.siteDragPreview };
      delete next[id];
      return { siteDragPreview: next };
    }),
  updateLink: (id, patch) => {
    const { currentUser, selectedScenarioId, simulationPresets } = get();
    const user = requireAuth(currentUser, "updateLink");
    if (!user) return;
    if (!canEditActiveSavedSimulation(user, selectedScenarioId, simulationPresets)) {
      console.warn(`[appStore] updateLink: User ${user.id} cannot edit active simulation ${selectedScenarioId}`);
      return;
    }
    set((state) => ({
      links: state.links.map((link) => {
        if (link.id !== id) return link;
        const next = { ...link, ...patch };
        if ("color" in patch) {
          next.color = normalizeSimulationColor(patch.color) ?? undefined;
        }

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

        const fromSite = state.sites.find((site) => site.id === next.fromSiteId) ?? null;
        const toSite = state.sites.find((site) => site.id === next.toSiteId) ?? null;
        return stripRedundantLinkRadioOverrides(next, fromSite, toSite);
      }),
    }));
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  updateMapViewport: (patch) =>
    {
      set((state) => ({
        mapViewport: {
          ...(state.mapViewport ?? { center: { lat: 59.9, lon: 10.75 }, zoom: 8 }),
          ...patch,
          center: {
            ...(state.mapViewport?.center ?? { lat: 59.9, lon: 10.75 }),
            ...(patch.center ?? {}),
          },
        },
      }));
    },
  recommendAndFetchTerrainForCurrentArea: async (targetRadiusKm = 20) => {
    if (get().isTerrainFetching) return;
    const { sites, srtmTiles } = get();
    if (!sites.length) return;

    const radiusKm = Math.max(20, Math.min(500, Math.round(targetRadiusKm)));
    const bounds = bufferedBoundsForSites(sites, radiusKm);
    if (!bounds) return;

    let requiredTileKeys: string[];
    try {
      requiredTileKeys = tilesForBounds(bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon);
    } catch (error) {
      set({
        terrainFetchStatus: `Terrain fetch failed: ${getUiErrorMessage(error)}`,
        isTerrainFetching: false,
        isTerrainRecommending: false,
        isHighResTerrainLoaded: false,
      });
      return;
    }
    const existingTileKeys = new Set(
      srtmTiles.filter((tile) => tile.sourceId === "copernicus30").map((tile) => tile.key),
    );
    const missingTileKeys = requiredTileKeys.filter((key) => !existingTileKeys.has(key));
    if (!missingTileKeys.length) {
      set({
        terrainDataset: "copernicus30",
        terrainFetchStatus: "GLO-30 terrain is already loaded for this area.",
        terrainRecommendation: "",
        isTerrainFetching: false,
        isTerrainRecommending: false,
        isHighResTerrainLoaded: true,
        terrainLoadingStartedAtMs: 0,
        terrainProgressPercent: 100,
        terrainProgressTilesLoaded: 0,
        terrainProgressTilesTotal: 0,
        terrainProgressBytesLoaded: 0,
        terrainProgressBytesEstimated: 0,
        terrainProgressTransientDecodeBytesEstimated: 0,
        terrainProgressPhaseLabel: "",
        terrainProgressPhaseIndex: 0,
        terrainProgressPhaseTotal: 0,
      });
      return;
    }

    const controller = new AbortController();
    terrainLoadAbortController = controller;
    const epoch = get().terrainLoadEpoch + 1;
    let bytesLoaded = 0;
    let measuredTiles = 0;
    clearTerrainLossCache();
    set({
      terrainDataset: "copernicus30",
      terrainLoadEpoch: epoch,
      isTerrainRecommending: false,
      isTerrainFetching: true,
      isHighResTerrainLoaded: false,
      terrainRecommendation: "",
      terrainFetchStatus: `Loading GLO-30 terrain for ${radiusKm} km...`,
      terrainLoadingStartedAtMs: Date.now(),
      terrainProgressPercent: 0,
      terrainProgressTilesLoaded: 0,
      terrainProgressTilesTotal: missingTileKeys.length,
      terrainProgressBytesLoaded: 0,
      terrainProgressBytesEstimated: 0,
      terrainProgressTransientDecodeBytesEstimated:
        Math.min(2, missingTileKeys.length) * COPERNICUS_30_TILE_DECODED_BYTES,
      terrainProgressPhaseLabel: "GLO-30 terrain",
      terrainProgressPhaseIndex: 1,
      terrainProgressPhaseTotal: 1,
    });

    const onTileProgress = (progress: CopernicusTileProgress) => {
      if (controller.signal.aborted || get().terrainLoadEpoch !== epoch) return;
      if (progress.bytes > 0) {
        bytesLoaded += progress.bytes;
        measuredTiles += 1;
      }
      const estimatedBytes =
        measuredTiles > 0
          ? Math.round((bytesLoaded / measuredTiles) * missingTileKeys.length)
          : 0;
      set({
        terrainProgressPercent: Math.round((progress.completedTiles / Math.max(1, progress.totalTiles)) * 100),
        terrainProgressTilesLoaded: progress.completedTiles,
        terrainProgressTilesTotal: progress.totalTiles,
        terrainProgressBytesLoaded: bytesLoaded,
        terrainProgressBytesEstimated: estimatedBytes,
      });
    };

    try {
      const result = await loadCopernicus30TilesByKeys(missingTileKeys, {
        concurrency: 2,
        signal: controller.signal,
        onTileProgress,
      });
      if (controller.signal.aborted || get().terrainLoadEpoch !== epoch) return;

      const parts = [
        `Loaded ${result.tiles.length} tile(s)`,
        result.fetchedTiles.length ? `${result.fetchedTiles.length} fetched` : "",
        result.cacheHits.length ? `${result.cacheHits.length} from cache` : "",
        result.seaLevelTiles.length ? `${result.seaLevelTiles.length} sea-level` : "",
        result.failedTiles.length ? `${result.failedTiles.length} unavailable` : "",
      ].filter(Boolean);
      const missing = result.failedTiles.length
        ? ` Missing: ${result.failedTiles.slice(0, 4).join(", ")}${result.failedTiles.length > 4 ? "..." : ""}`
        : "";
      set((state) => {
        const nextTiles =
          result.tiles.length > 0 ? mergeSrtmTiles(state.srtmTiles, result.tiles) : state.srtmTiles;
        return {
          srtmTiles: nextTiles,
          terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics(nextTiles),
          terrainFetchStatus: `${parts.join(", ")} from Copernicus GLO-30.${missing}`,
          isTerrainFetching: false,
          isTerrainRecommending: false,
          isHighResTerrainLoaded: result.failedTiles.length === 0,
          terrainLoadingStartedAtMs: 0,
          terrainProgressPercent: 100,
          terrainProgressTransientDecodeBytesEstimated: 0,
          terrainProgressPhaseLabel: "",
          terrainProgressPhaseIndex: 0,
          terrainProgressPhaseTotal: 0,
        };
      });
      useCoverageStore.getState().recomputeCoverage();
    } catch (error) {
      if (controller.signal.aborted || get().terrainLoadEpoch !== epoch) return;
      set({
        terrainFetchStatus: `Terrain fetch failed: ${getUiErrorMessage(error)}`,
        isTerrainFetching: false,
        isTerrainRecommending: false,
        isHighResTerrainLoaded: false,
        terrainLoadingStartedAtMs: 0,
        terrainProgressTransientDecodeBytesEstimated: 0,
        terrainProgressPhaseLabel: "",
        terrainProgressPhaseIndex: 0,
        terrainProgressPhaseTotal: 0,
      });
      useCoverageStore.getState().recomputeCoverage();
    } finally {
      if (terrainLoadAbortController === controller) terrainLoadAbortController = null;
    }
  },
  cancelTerrainLoad: () => {
    if (!terrainLoadAbortController) return;
    terrainLoadAbortController?.abort(new DOMException("Terrain loading stopped", "AbortError"));
    terrainLoadAbortController = null;
    set((state) => ({
      terrainLoadEpoch: state.terrainLoadEpoch + 1,
      isTerrainFetching: false,
      isTerrainRecommending: false,
      isHighResTerrainLoaded: false,
      terrainFetchStatus: "Terrain loading stopped.",
      terrainLoadingStartedAtMs: 0,
      terrainProgressPercent: 0,
      terrainProgressTilesLoaded: 0,
      terrainProgressTilesTotal: 0,
      terrainProgressBytesLoaded: 0,
      terrainProgressBytesEstimated: 0,
      terrainProgressTransientDecodeBytesEstimated: 0,
      terrainProgressPhaseLabel: "",
      terrainProgressPhaseIndex: 0,
      terrainProgressPhaseTotal: 0,
    }));
  },
  loadTerrainForCoordinate: async (lat: number, lon: number) => {
    const { isEditorTerrainFetching, srtmTiles } = get();
    if (isEditorTerrainFetching) return;
    if (sampleSrtmElevation(srtmTiles, lat, lon) !== null) return;
    const tileKey = tilesForBounds(lat, lat, lon, lon)[0];
    if (!tileKey) return;
    set({ isEditorTerrainFetching: true });
    try {
      const result = await loadCopernicus30TilesByKeys([tileKey], { concurrency: 1 });
      if (result.tiles.length > 0) {
        set((state) => {
          const nextTiles = mergeSrtmTiles(state.srtmTiles, result.tiles);
          return {
            srtmTiles: nextTiles,
            terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics(nextTiles),
          };
        });
      }
    } finally {
      set({ isEditorTerrainFetching: false });
    }
  },
  clearTerrainCache: async () => {
    get().cancelTerrainLoad();
    set({ isTerrainFetching: true, terrainProgressPercent: 0 });
    await clearCopernicusCache();
    clearTerrainLossCache();
    set((state) => {
      return {
        srtmTiles: [],
        terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics([]),
        isTerrainFetching: false,
        isHighResTerrainLoaded: false,
        terrainLoadingStartedAtMs: 0,
        terrainLoadEpoch: state.terrainLoadEpoch + 1,
        terrainProgressPercent: 0,
        terrainProgressTilesLoaded: 0,
        terrainProgressTilesTotal: 0,
        terrainProgressBytesLoaded: 0,
        terrainProgressBytesEstimated: 0,
        terrainProgressTransientDecodeBytesEstimated: 0,
        terrainProgressPhaseLabel: "",
        terrainProgressPhaseIndex: 0,
        terrainProgressPhaseTotal: 0,
        terrainFetchStatus: "Terrain source caches cleared.",
      };
    });
    useCoverageStore.getState().recomputeCoverage();
  },
  getSelectedLink: () => {
    const { links, selectedLinkId, sites, networks, selectedNetworkId } = get();
    const link = links.find((candidate) => candidate.id === selectedLinkId);
    if (link) {
      const fromSite = sites.find((site) => site.id === link.fromSiteId) ?? null;
      const toSite = sites.find((site) => site.id === link.toSiteId) ?? null;
      const radio = resolveLinkRadio(link, fromSite, toSite);
      return { ...link, ...radio };
    }
    if (links[0]) {
      const base = links[0];
      const fromSite = sites.find((site) => site.id === base.fromSiteId) ?? null;
      const toSite = sites.find((site) => site.id === base.toSiteId) ?? null;
      const radio = resolveLinkRadio(base, fromSite, toSite);
      return { ...base, ...radio };
    }
    if (sites.length >= 2) {
      const selectedNetwork = networks.find((network) => network.id === selectedNetworkId);
      const inheritedFrequencyMHz =
        selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? defaultRadioPreset.frequencyMHz;
      return {
        id: "__auto__",
        name: "Auto Link",
        fromSiteId: sites[0].id,
        toSiteId: sites[1].id,
        frequencyMHz: inheritedFrequencyMHz,
        txPowerDbm: sites[0]?.txPowerDbm ?? STANDARD_SITE_RADIO.txPowerDbm,
        txGainDbi: sites[0]?.txGainDbi ?? STANDARD_SITE_RADIO.txGainDbi,
        rxGainDbi: sites[1]?.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi,
        cableLossDb: sites[0]?.cableLossDb ?? STANDARD_SITE_RADIO.cableLossDb,
      };
    }
    return {
      ...defaultScenario.links[0],
      txPowerDbm: STANDARD_SITE_RADIO.txPowerDbm,
      txGainDbi: STANDARD_SITE_RADIO.txGainDbi,
      rxGainDbi: STANDARD_SITE_RADIO.rxGainDbi,
      cableLossDb: STANDARD_SITE_RADIO.cableLossDb,
    };
  },
  getSelectedSite: () => {
    const { sites, selectedSiteId, selectedSiteIds } = get();
    const normalizedIds = normalizeSelectedSiteIds(selectedSiteIds, sites);
    const site = sites.find((candidate) => candidate.id === (normalizedIds[0] ?? selectedSiteId));
    return site ?? sites[0] ?? defaultScenario.sites[0];
  },
  getSelectedSiteIds: () => {
    const { sites, selectedSiteIds, selectedSiteId } = get();
    const normalizedIds = normalizeSelectedSiteIds(selectedSiteIds, sites);
    if (normalizedIds.length) return normalizedIds;
    if (selectedSiteId && sites.some((site) => site.id === selectedSiteId)) return [selectedSiteId];
    return [];
  },
  getSelectedNetwork: () => {
    const { networks, selectedNetworkId } = get();
    const network = networks.find((candidate) => candidate.id === selectedNetworkId);
    return network ?? networks[0] ?? defaultScenario.networks[0];
  },
  getSelectedSites: () => {
    const { sites, getSelectedLink, temporaryDirectionReversed, getSelectedSiteIds } = get();
    const selectedIds = getSelectedSiteIds();
    if (selectedIds.length >= 2) {
      const fromId = selectedIds[0];
      const toId = selectedIds[selectedIds.length - 1];
      const effectiveFromId = temporaryDirectionReversed ? toId : fromId;
      const effectiveToId = temporaryDirectionReversed ? fromId : toId;
      const fromSite = sites.find((s) => s.id === effectiveFromId);
      const toSite = sites.find((s) => s.id === effectiveToId);
      return {
        fromSite: fromSite ?? sites[0] ?? defaultScenario.sites[0],
        toSite: toSite ?? sites[Math.min(1, Math.max(0, sites.length - 1))] ?? defaultScenario.sites[1],
      };
    }
    const link = getSelectedLink();
    const effectiveFromId = temporaryDirectionReversed ? link.toSiteId : link.fromSiteId;
    const effectiveToId = temporaryDirectionReversed ? link.fromSiteId : link.toSiteId;
    const fromSite = sites.find((s) => s.id === effectiveFromId);
    const toSite = sites.find((s) => s.id === effectiveToId);
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
        terrainSamples: 32,
        environment: autoDerived?.environment ?? propagationEnvironment,
      },
    );
  },
  getSelectedProfile: () => {
    const {
      getSelectedLink,
      getSelectedNetwork,
      getSelectedSites,
      srtmTiles,
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
    const effectiveEnvironment = autoDerived?.environment ?? propagationEnvironment;

    return buildProfile(
      effectiveLink,
      fromSite,
      toSite,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      120,
      { kFactor: atmosphericBendingNUnitsToKFactor(effectiveEnvironment.atmosphericBendingNUnits) },
    );
  },
}));

setAppStoreBridge({
  getState: () => useAppStore.getState() as unknown as Record<string, unknown>,
  setState: (patch) => useAppStore.setState(patch as Parameters<typeof useAppStore.setState>[0]),
});
