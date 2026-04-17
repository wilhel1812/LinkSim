import { create } from "zustand";
import { clearTerrainLossCache } from "../lib/coverage";
import { setAppStoreBridge, useCoverageStore } from "./coverageStore";
import { findPresetById } from "../lib/frequencyPlans";
import { haversineDistanceKm } from "../lib/geo";
import { getUiErrorMessage } from "../lib/uiError";
import { fetchCloudLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import {
  migrateSitesAndLinksToSiteRadioDefaults,
  resolveLinkRadio,
  STANDARD_SITE_RADIO,
  stripRedundantLinkRadioOverrides,
  withSiteRadioDefaults,
} from "../lib/linkRadio";
import {
  defaultPropagationEnvironment,
  deriveDynamicPropagationEnvironment,
  withClimateDefaults,
} from "../lib/propagationEnvironment";
import { analyzeLink, buildProfile } from "../lib/propagation";
import { BUILTIN_SCENARIOS, defaultScenario, DEMO_SCENARIO, getScenarioById } from "../lib/scenarios";
import { boundsToViewport, simulationAreaBoundsForSites } from "../lib/simulationArea";
import { tilesForBounds } from "../lib/terrainTiles";
import { mergeSrtmTiles } from "../lib/terrainMerge";
import { parseSrtmTile, sampleSrtmElevation } from "../lib/srtm";
import { DEFAULT_BASEMAP_STYLE_ID, BASEMAP_STYLE_REGISTRY } from "../lib/basemaps";
import {
  clearCopernicusCache,
  loadCopernicusTilesForAreaPhased,
  recommendCopernicusDatasetForArea,
  type CopernicusDataset,
  type CopernicusLoadResult,
  type CopernicusTileProgress,
} from "../lib/copernicusTerrainClient";
import {
  normalizeTerrainDataset,
  TERRAIN_DATASET_FETCH_LABEL,
  TERRAIN_DATASET_LABEL,
  type TerrainDataset,
} from "../lib/terrainDataset";
import { atmosphericBendingNUnitsToKFactor } from "../lib/terrainLoss";
import {
  estimateTerrainMemoryDiagnostics,
  estimateTransientDecodeBytes,
  type TerrainMemoryDiagnostics,
} from "../lib/terrainMemory";
import {
  defaultOptionForSelectionCount,
  isOverlayRadiusOption,
  type SimulationOverlayRadiusOption,
} from "../lib/simulationOverlayRadius";
import type { LocaleCode } from "../i18n/locales";
import type { UiColorTheme } from "../themes/types";
import { getActiveHolidayTheme } from "../themes/holidayThemes";
import type { CloudUser } from "../lib/cloudUser";
import type { MeshmapNode } from "../lib/meshtasticMqtt";
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
const SYNC_SIGNATURE_KEY = "linksim-sync-signature-v1";
const MIGRATION_DEFAULT_PRIVATE_KEY = "linksim-migration-default-private-v2";

let hydrated = false;
let syncTimer: number | null = null;
let syncInFlight = false;
let localMutationRevision = 0;
let syncedMutationRevision = 0;
let lastSyncedPayloadSignature: string | null = (() => {
  try {
    return localStorage.getItem(SYNC_SIGNATURE_KEY);
  } catch {
    return null;
  }
})();

const recordLocalMutation = (): number => {
  localMutationRevision += 1;
  return Math.max(0, localMutationRevision - syncedMutationRevision);
};

const markSyncedThrough = (revision: number = localMutationRevision): number => {
  syncedMutationRevision = Math.max(syncedMutationRevision, revision);
  return Math.max(0, localMutationRevision - syncedMutationRevision);
};

const LAST_FETCHED_AT_KEY = "linksim-last-fetched-at-v1";

let dirtySiteIds = new Set<string>();
let dirtySimIds = new Set<string>();
let requiresFullPush = true;

const markDirtySite = (id: string): void => {
  dirtySiteIds.add(id);
};
const markDirtySim = (id: string): void => {
  dirtySimIds.add(id);
};

const resetSyncRevisions = (): void => {
  localMutationRevision = 0;
  syncedMutationRevision = 0;
  lastSyncedPayloadSignature = null;
  dirtySiteIds = new Set();
  dirtySimIds = new Set();
  requiresFullPush = true;
  localStorage.removeItem(SYNC_SIGNATURE_KEY);
  localStorage.removeItem(LAST_FETCHED_AT_KEY);
};

const canEditLibraryItem = (
  item: { ownerUserId?: string; effectiveRole?: string },
  currentUser: CloudUser | null,
): boolean => {
  if (!currentUser) return false;
  if (item.ownerUserId === currentUser.id) return true;
  return (
    item.effectiveRole === "owner" || item.effectiveRole === "admin" || item.effectiveRole === "editor"
  );
};

const requireAuth = (currentUser: CloudUser | null, action: string): CloudUser | null => {
  if (!currentUser?.id) {
    console.warn(`[appStore] ${action}: Auth required - user not logged in`);
    return null;
  }
  return currentUser;
};

const FALLBACK_NEW_SIMULATION_PRESET_ID = "oslo-local-869618";

const resolveDefaultFrequencyPresetIdForNewSimulation = (currentUser: CloudUser | null): string => {
  const preferred = currentUser?.defaultFrequencyPresetId;
  if (typeof preferred === "string" && findPresetById(preferred)) return preferred;
  return FALLBACK_NEW_SIMULATION_PRESET_ID;
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

const canEditItem = (
  item: { ownerUserId?: string; effectiveRole?: string },
  currentUser: CloudUser | null,
): boolean => {
  if (!currentUser) return false;
  if (item.ownerUserId === currentUser.id) return true;
  return (
    item.effectiveRole === "owner" ||
    item.effectiveRole === "admin" ||
    item.effectiveRole === "editor"
  );
};

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

const adoptOrphanedEntries = (
  entries: SiteLibraryEntry[],
  userId: string,
  username: string,
  avatarUrl: string,
): SiteLibraryEntry[] => {
  let adoptedCount = 0;
  const fixed = entries.map((entry) => {
    if (entry.ownerUserId) return entry;
    adoptedCount++;
    return {
      ...entry,
      ownerUserId: userId,
      createdByUserId: userId,
      createdByName: username,
      createdByAvatarUrl: avatarUrl,
      lastEditedByUserId: userId,
      lastEditedByName: username,
      lastEditedByAvatarUrl: avatarUrl,
    };
  });
  if (adoptedCount > 0) {
    console.log(`[appStore] Adopted ${adoptedCount} orphaned library entries for user ${userId}`);
  }
  return fixed;
};

const adoptOrphanedSimulations = (
  simulations: SimulationPreset[],
  userId: string,
  username: string,
  avatarUrl: string,
): SimulationPreset[] => {
  let adoptedCount = 0;
  const fixed = simulations.map((sim) => {
    if (sim.ownerUserId) return sim;
    adoptedCount++;
    return {
      ...sim,
      ownerUserId: userId,
      createdByUserId: userId,
      createdByName: username,
      createdByAvatarUrl: avatarUrl,
      lastEditedByUserId: userId,
      lastEditedByName: username,
      lastEditedByAvatarUrl: avatarUrl,
    };
  });
  if (adoptedCount > 0) {
    console.log(`[appStore] Adopted ${adoptedCount} orphaned simulation presets for user ${userId}`);
  }
  return fixed;
};

export type MapOverlayMode = "none" | "heatmap" | "contours" | "passfail" | "relay";
export type AuthSessionState = "checking" | "signed_in" | "signed_out";

type SiteLibraryEntry = {
  id: string;
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
  createdAt: string;
  sourceMeta?: {
    sourceType: string;
    sourceUrl?: string;
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
  name: string;
  description?: string;
  slug?: string;
  slugAliases?: string[];
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
  };
};

type SyncPayload = {
  siteLibrary: SiteLibraryEntry[];
  simulationPresets: SimulationPreset[];
};

type EditableSyncPayloadInfo = {
  payload: SyncPayload;
  skippedCount: number;
  signature: string;
};

const sortById = <T extends { id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

const computeSyncPayloadSignature = (payload: SyncPayload): string =>
  JSON.stringify({
    siteLibrary: sortById(payload.siteLibrary),
    simulationPresets: sortById(payload.simulationPresets),
  });

const buildEditableSyncPayloadInfo = (
  siteLibrary: SiteLibraryEntry[],
  simulationPresets: SimulationPreset[],
  currentUser: CloudUser | null,
): EditableSyncPayloadInfo => {
  const editableSites = siteLibrary.filter((site) => canEditLibraryItem(site, currentUser));
  const editableSims = simulationPresets.filter((sim) => canEditLibraryItem(sim, currentUser));
  const payload = { siteLibrary: editableSites, simulationPresets: editableSims };
  return {
    payload,
    skippedCount: siteLibrary.length - editableSites.length + simulationPresets.length - editableSims.length,
    signature: computeSyncPayloadSignature(payload),
  };
};

const buildDeltaSyncPayloadInfo = (
  siteLibrary: SiteLibraryEntry[],
  simulationPresets: SimulationPreset[],
  currentUser: CloudUser | null,
): EditableSyncPayloadInfo => {
  const editableSites = siteLibrary.filter((site) => canEditLibraryItem(site, currentUser) && dirtySiteIds.has(site.id));
  const editableSims = simulationPresets.filter((sim) => canEditLibraryItem(sim, currentUser) && dirtySimIds.has(sim.id));
  const payload = { siteLibrary: editableSites, simulationPresets: editableSims };
  return {
    payload,
    skippedCount: 0,
    signature: computeSyncPayloadSignature(payload),
  };
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
  showSimulationLibraryRequest: boolean;
  showNewSimulationRequest: boolean;
  showSiteLibraryRequest: boolean;
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
  isInitializing: boolean;
  initializeCloudSync: () => Promise<void>;
  performCloudSyncPush: () => void;
  performManualCloudSync: () => Promise<void>;
  setLocale: (locale: LocaleCode) => void;
  setSyncStatus: (status: "syncing" | "synced" | "error") => void;
  setLastSyncedAt: (iso: string | null) => void;
  setSyncErrorMessage: (message: string | null) => void;
  setCurrentUser: (user: CloudUser | null) => void;
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
    txPowerDbm?: number,
    txGainDbi?: number,
    rxGainDbi?: number,
    cableLossDb?: number,
    sourceMeta?: SiteLibraryEntry["sourceMeta"],
    visibility?: "private" | "public" | "shared",
    description?: string,
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
        | "visibility"
        | "sharedWith"
      >
    >,
  ) => void;
  deleteSiteLibraryEntry: (entryId: string) => void;
  deleteSiteLibraryEntries: (entryIds: string[]) => void;
  saveCurrentSimulationPreset: (name: string) => string | null;
  createBlankSimulationPreset: (
    name: string,
    options?: {
      description?: string;
      frequencyPresetId?: string;
      visibility?: "private" | "public" | "shared";
      ownerUserId?: string;
      createdByUserId?: string;
      createdByName?: string;
      createdByAvatarUrl?: string;
      lastEditedByUserId?: string;
      lastEditedByName?: string;
      lastEditedByAvatarUrl?: string;
    },
  ) => string | null;
  overwriteSimulationPreset: (presetId: string) => void;
  updateCurrentSimulationSnapshot: () => void;
  loadSimulationPreset: (presetId: string) => void;
  renameSimulationPreset: (presetId: string, name: string) => void;
  updateSimulationPresetEntry: (
    presetId: string,
    patch: Partial<Pick<SimulationPreset, "name" | "description" | "visibility" | "sharedWith">>,
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
  requestSiteLibraryDraftAt: (
    lat: number,
    lon: number,
    suggestedName?: string,
    sourceMeta?: SiteLibraryEntry["sourceMeta"],
  ) => void;
  clearPendingSiteLibraryDraft: () => void;
  setShowSimulationLibraryRequest: (show: boolean) => void;
  setShowNewSimulationRequest: (show: boolean) => void;
  setShowSiteLibraryRequest: (show: boolean) => void;
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
  ingestSrtmFiles: (files: FileList | File[]) => Promise<void>;
  recommendTerrainDatasetForCurrentArea: () => Promise<void>;
  fetchTerrainForCurrentArea: (targetRadiusKm?: number) => Promise<void>;
  recommendAndFetchTerrainForCurrentArea: (targetRadiusKm?: number) => Promise<void>;
  loadTerrainForCurrentArea: (targetRadiusKm?: number) => Promise<void>;
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
const LAST_SESSION_KEY = "linksim-last-session-v1";
const UI_THEME_PREFERENCE_KEY = "linksim-ui-theme-v1";
const UI_COLOR_THEME_KEY = "linksim-ui-color-theme-v1";
const BASEMAP_STYLE_ID_KEY = "linksim-basemap-style-v2";

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

const writeStorage = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`[appStore] Failed to write to localStorage (${key}):`, error);
    return false;
  }
};

const getLatestSnapshotValue = <T,>(_key: string): T | null => null;



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
  dedupeLibraryEntries(
    entries
      .filter((entry) => !isLegacyDemoSiteLibraryEntry(entry))
      .map((entry) => ({
        ...entry,
        txPowerDbm:
          typeof entry.txPowerDbm === "number" && Number.isFinite(entry.txPowerDbm)
            ? entry.txPowerDbm
            : STANDARD_SITE_RADIO.txPowerDbm,
        txGainDbi:
          typeof entry.txGainDbi === "number" && Number.isFinite(entry.txGainDbi)
            ? entry.txGainDbi
            : STANDARD_SITE_RADIO.txGainDbi,
        rxGainDbi:
          typeof entry.rxGainDbi === "number" && Number.isFinite(entry.rxGainDbi)
            ? entry.rxGainDbi
            : STANDARD_SITE_RADIO.rxGainDbi,
        cableLossDb:
          typeof entry.cableLossDb === "number" && Number.isFinite(entry.cableLossDb)
            ? entry.cableLossDb
            : STANDARD_SITE_RADIO.cableLossDb,
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
          links: migrated.links,
        },
      };
    });

const siteNamePosKey = (
  site: Pick<Site, "name" | "position"> | Pick<SiteLibraryEntry, "name" | "position">,
): string =>
  `${site.name.trim().toLowerCase()}|${site.position.lat.toFixed(6)}|${site.position.lon.toFixed(6)}`;

const siteNameKey = (name: string): string => name.trim().toLowerCase();

const pickClosestLibraryEntryByPosition = (
  site: Pick<Site, "position">,
  candidates: SiteLibraryEntry[],
): SiteLibraryEntry | undefined => {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  return candidates
    .slice()
    .sort(
      (a, b) =>
        haversineDistanceKm(site.position, a.position) - haversineDistanceKm(site.position, b.position),
    )[0];
};

const annotateSitesWithLibraryRefs = (sites: Site[], library: SiteLibraryEntry[]): Site[] => {
  if (!sites.length || !library.length) return sites.map((site) => withSiteRadioDefaults(site));
  const libraryByFingerprint = new Map<string, SiteLibraryEntry[]>();
  const libraryByName = new Map<string, SiteLibraryEntry[]>();
  for (const entry of library) {
    const posKey = siteNamePosKey(entry);
    const currentByPos = libraryByFingerprint.get(posKey) ?? [];
    libraryByFingerprint.set(posKey, [...currentByPos, entry]);
    const nameKey = siteNameKey(entry.name);
    const currentByName = libraryByName.get(nameKey) ?? [];
    libraryByName.set(nameKey, [...currentByName, entry]);
  }
  return sites.map((site) => {
    if (site.libraryEntryId) return withSiteRadioDefaults(site);
    const matchesByPos = libraryByFingerprint.get(siteNamePosKey(site)) ?? [];
    if (matchesByPos.length === 1) return withSiteRadioDefaults({ ...site, libraryEntryId: matchesByPos[0].id });
    const matchesByName = libraryByName.get(siteNameKey(site.name)) ?? [];
    const closestByName = pickClosestLibraryEntryByPosition(site, matchesByName);
    if (closestByName) return withSiteRadioDefaults({ ...site, libraryEntryId: closestByName.id });
    return withSiteRadioDefaults(site);
  });
};

const syncLibraryLinkedSiteValues = (sites: Site[], library: SiteLibraryEntry[]): Site[] => {
  if (!sites.length || !library.length) return sites.map((site) => withSiteRadioDefaults(site));
  const byId = new Map<string, SiteLibraryEntry>(library.map((entry) => [entry.id, entry]));
  const byNamePos = new Map<string, SiteLibraryEntry[]>();
  const byName = new Map<string, SiteLibraryEntry[]>();
  for (const entry of library) {
    const posKey = siteNamePosKey(entry);
    const currentByPos = byNamePos.get(posKey) ?? [];
    byNamePos.set(posKey, [...currentByPos, entry]);
    const nameKey = siteNameKey(entry.name);
    const currentByName = byName.get(nameKey) ?? [];
    byName.set(nameKey, [...currentByName, entry]);
  }
  return sites.map((site) => {
    const direct = site.libraryEntryId ? byId.get(site.libraryEntryId) : undefined;
    const inferredMatchesByPos = byNamePos.get(siteNamePosKey(site)) ?? [];
    const inferredByPos = inferredMatchesByPos.length === 1 ? inferredMatchesByPos[0] : undefined;
    const inferredMatchesByName = byName.get(siteNameKey(site.name)) ?? [];
    const inferredByName = pickClosestLibraryEntryByPosition(site, inferredMatchesByName);
    const entry = direct ?? inferredByPos ?? inferredByName;
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
  const byId = new Map<string, SiteLibraryEntry>(nextLibrary.map((entry) => [entry.id, entry]));
  const byNamePos = new Map<string, SiteLibraryEntry[]>();
  const byName = new Map<string, SiteLibraryEntry[]>();
  for (const entry of nextLibrary) {
    const posKey = siteNamePosKey(entry);
    byNamePos.set(posKey, [...(byNamePos.get(posKey) ?? []), entry]);
    const nameKey = siteNameKey(entry.name);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), entry]);
  }
  let addedCount = 0;
  const normalizedSites = sites.map((site) => {
    const normalizedSite = withSiteRadioDefaults(site);
    const direct = normalizedSite.libraryEntryId ? byId.get(normalizedSite.libraryEntryId) : undefined;
    const inferredMatchesByPos = byNamePos.get(siteNamePosKey(normalizedSite)) ?? [];
    const inferredByPos = inferredMatchesByPos.length === 1 ? inferredMatchesByPos[0] : undefined;
    const inferredMatchesByName = byName.get(siteNameKey(normalizedSite.name)) ?? [];
    const inferredByName = pickClosestLibraryEntryByPosition(normalizedSite, inferredMatchesByName);
    let entry = direct ?? inferredByPos ?? inferredByName;
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
        createdAt: new Date().toISOString(),
      };
      nextLibrary.unshift(entry);
      byId.set(entry.id, entry);
      const posKey = siteNamePosKey(entry);
      byNamePos.set(posKey, [...(byNamePos.get(posKey) ?? []), entry]);
      const nameKey = siteNameKey(entry.name);
      byName.set(nameKey, [...(byName.get(nameKey) ?? []), entry]);
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
      libraryEntryId: entry.id,
    };
  });
  return {
    sites: normalizedSites,
    siteLibrary: dedupeLibraryEntries(nextLibrary),
    addedCount,
  };
};

const hasPrivateLibrarySiteReferences = (
  sites: Site[],
  siteLibrary: SiteLibraryEntry[],
): boolean => {
  if (!sites.length || !siteLibrary.length) return false;
  const privateIds = new Set(
    siteLibrary
      .filter((entry) => (entry.visibility ?? "private") === "private")
      .map((entry) => entry.id),
  );
  if (!privateIds.size) return false;
  return sites.some((site) => typeof site.libraryEntryId === "string" && privateIds.has(site.libraryEntryId));
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
              frequencyMHz: 869.618,
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
let initialSiteLibrary = normalizeSiteLibrary(Array.isArray(recoveredSiteLibraryRaw) ? recoveredSiteLibraryRaw : []);
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
let initialSimulationPresets = normalizeSimulationPresets(
  Array.isArray(recoveredSimulationPresetsRaw) ? recoveredSimulationPresetsRaw : [],
);
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
    const { signature } = buildEditableSyncPayloadInfo(
      initialSiteLibrary,
      initialSimulationPresets,
      null,
    );
    lastSyncedPayloadSignature = signature;
    writeStorage(SYNC_SIGNATURE_KEY, signature);
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
  value === "pink" || value === "blue" || value === "red" || value === "green" || value === "yellow"
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
  typeof value === "string" && BASEMAP_STYLE_REGISTRY.some((e) => e.id === value.trim())
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

type TerrainFetchBounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };

const bufferedBoundsForSites = (sites: Site[], radiusKm: number): TerrainFetchBounds | null => {
  if (!sites.length) return null;
  const minLat = Math.min(...sites.map((site) => site.position.lat));
  const maxLat = Math.max(...sites.map((site) => site.position.lat));
  const minLon = Math.min(...sites.map((site) => site.position.lon));
  const maxLon = Math.max(...sites.map((site) => site.position.lon));
  const centerLat = (minLat + maxLat) / 2;
  const latDelta = Math.max(0.01, radiusKm / 111.32);
  const lonDelta = Math.max(0.01, radiusKm / (111.32 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180))));
  return {
    minLat: minLat - latDelta,
    maxLat: maxLat + latDelta,
    minLon: minLon - lonDelta,
    maxLon: maxLon + lonDelta,
  };
};

const initialBasemapStyleId = normalizeBasemapStyleId(
  readStorage<string>(BASEMAP_STYLE_ID_KEY, DEFAULT_BASEMAP_STYLE_ID),
);

const normalizeCoverageResolution = (value: unknown): CoverageResolution => {
  if (value === "24" || value === "42" || value === "84" || value === "168") return value;
  if (value === "high") return "42";
  if (value === "normal") return "24";
  return "24";
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
  rxSensitivityTargetDbm: -120,
  environmentLossDb: 0,
  propagationEnvironment: defaultPropagationEnvironment(),
  autoPropagationEnvironment: true,
  propagationEnvironmentReason: "Auto defaults active.",
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
  pendingSiteLibraryDraft: null,
  showSimulationLibraryRequest: false,
  showNewSimulationRequest: false,
  showSiteLibraryRequest: false,
  pendingSiteLibraryOpenEntryId: null,
  scenarioOptions: BUILTIN_SCENARIOS.map((scenario) => ({ id: scenario.id, name: scenario.name })),
  mapOverlayMode: "heatmap",
  discoveryLibraryVisible: false,
  discoveryMqttVisible: false,
  mapDiscoveryMqttNodes: [],
  syncStatus: "synced",
  syncPending: false,
  pendingChangesCount: 0,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,
  syncErrorMessage: null,
  syncTrigger: 0,
  syncBusy: false,
  syncStatusMessage: "",
  currentUser: null,
  authState: "checking",
  isInitializing: false,
  setLocale: (locale) => set({ locale }),
  setSyncStatus: (status: "syncing" | "synced" | "error") => set({ syncStatus: status }),
  setLastSyncedAt: (iso: string | null) => set({ lastSyncedAt: iso }),
  setSyncErrorMessage: (message: string | null) => set({ syncErrorMessage: message }),
  setCurrentUser: (user) =>
    set({
      currentUser: user,
      authState: user ? "signed_in" : "signed_out",
    }),
  getDefaultFrequencyPresetIdForNewSimulation: () => {
    const state = get();
    return resolveDefaultFrequencyPresetIdForNewSimulation(state.currentUser);
  },
  setAuthState: (value) => set({ authState: value }),
  setIsOnline: (value) => set({ isOnline: value }),
  triggerSync: () => set((state) => ({ syncTrigger: state.syncTrigger + 1 })),
  setIsInitializing: (value: boolean) => set({ isInitializing: value }),
  initializeCloudSync: async () => {
    const applyStartupSelection = !hydrated;
    console.log("[appStore] initializeCloudSync START - applyStartupSelection:", applyStartupSelection);
    set({ syncBusy: true, syncStatus: "syncing", syncStatusMessage: "Syncing...", isInitializing: true });
    try {
      const lastFetchedAt = (() => {
        try { return localStorage.getItem(LAST_FETCHED_AT_KEY) ?? undefined; } catch { return undefined; }
      })();
      console.log("[appStore] Fetching cloud library...", lastFetchedAt ? `(delta since ${lastFetchedAt})` : "(full)");
      const cloud = await fetchCloudLibrary(lastFetchedAt ? { since: lastFetchedAt } : undefined);
      console.log("[appStore] Cloud data received:", {
        sites: cloud.siteLibrary.length,
        simulations: cloud.simulationPresets.length,
        isDelta: cloud.isDelta,
      });

      // Delta fetch: merge server items by ID (server wins), keep local items not returned
      if (cloud.isDelta) {
        const deltaSites = cloud.siteLibrary as SiteLibraryEntry[];
        const deltaSims = cloud.simulationPresets as SimulationPreset[];
        set((state) => {
          const siteById = new Map(deltaSites.map((s) => [s.id, s]));
          const simById = new Map(deltaSims.map((s) => [s.id, s]));
          const mergedSites = state.siteLibrary.map((s) => siteById.get(s.id) ?? s);
          for (const site of deltaSites) {
            if (!state.siteLibrary.some((s) => s.id === site.id)) mergedSites.push(site);
          }
          const mergedSims = state.simulationPresets.map((s) => simById.get(s.id) ?? s);
          for (const sim of deltaSims) {
            if (!state.simulationPresets.some((s) => s.id === sim.id)) mergedSims.push(sim);
          }
          writeStorage(SITE_LIBRARY_KEY, mergedSites);
          writeStorage(SIM_PRESETS_KEY, mergedSims);
          return { siteLibrary: mergedSites, simulationPresets: mergedSims };
        });
        try { localStorage.setItem(LAST_FETCHED_AT_KEY, new Date().toISOString()); } catch { /* ignore */ }
        hydrated = true;
        requiresFullPush = false;
        set({
          syncPending: false,
          pendingChangesCount: 0,
          syncStatus: "synced",
          syncErrorMessage: null,
          syncBusy: false,
          syncStatusMessage: "Up to date",
          isInitializing: false,
        });
        return;
      }

      // Full fetch path (unchanged)
      const { currentUser, importLibraryData, loadSimulationPreset, selectScenario } = get();
      let remotePayloadSignature: string | null = null;

      const cloudSites = Array.isArray(cloud.siteLibrary) ? cloud.siteLibrary as SiteLibraryEntry[] : [];
      const cloudSims = Array.isArray(cloud.simulationPresets) ? cloud.simulationPresets as SimulationPreset[] : [];

      if (currentUser?.id) {
        const fixedCloudSites = adoptOrphanedEntries(
          cloudSites,
          currentUser.id,
          currentUser.username,
          currentUser.avatarUrl ?? "",
        );
        const fixedCloudSims = adoptOrphanedSimulations(
          cloudSims as SimulationPreset[],
          currentUser.id,
          currentUser.username,
          currentUser.avatarUrl ?? "",
        );
        const cloudPresets = fixedCloudSims as Parameters<ReturnType<typeof get>["importLibraryData"]>[0]["simulationPresets"];

        console.log("[appStore] Merging cloud data with local (with ownership fixes)...");
        const result = importLibraryData(
          {
            siteLibrary: fixedCloudSites as Parameters<ReturnType<typeof get>["importLibraryData"]>[0]["siteLibrary"],
            simulationPresets: cloudPresets,
          },
          "merge",
        );
        console.log("[appStore] Merge result:", result);
        hydrated = true;
        try { localStorage.setItem(LAST_FETCHED_AT_KEY, new Date().toISOString()); } catch { /* ignore */ }
        if (applyStartupSelection && typeof window !== "undefined") {
          const lastRefRaw = window.localStorage.getItem(LAST_SIMULATION_REF_KEY);
          const lastRef = (lastRefRaw ?? "").trim();
          if (lastRef.startsWith("saved:")) {
            const presetId = lastRef.slice("saved:".length);
            if (presetId && fixedCloudSims.some((preset) => preset.id === presetId)) {
              console.log("[appStore] Restoring last simulation:", presetId);
              loadSimulationPreset(presetId);
            }
          } else if (lastRef.startsWith("builtin:")) {
            const scenarioId = lastRef.slice("builtin:".length);
            if (scenarioId) {
              console.log("[appStore] Restoring last scenario:", scenarioId);
              selectScenario(scenarioId);
            }
          }
        }
        const postMergeState = get();
        remotePayloadSignature = buildEditableSyncPayloadInfo(
          postMergeState.siteLibrary,
          postMergeState.simulationPresets,
          currentUser,
        ).signature;
      } else {
        const cloudPresets =
          (cloud.simulationPresets as Parameters<ReturnType<typeof get>["importLibraryData"]>[0]["simulationPresets"] | undefined) ?? [];

        console.log("[appStore] Merging cloud data with local...");
        const result = importLibraryData(
          {
            siteLibrary: cloudSites as Parameters<ReturnType<typeof get>["importLibraryData"]>[0]["siteLibrary"],
            simulationPresets: cloudPresets,
          },
          "merge",
        );
        console.log("[appStore] Merge result:", result);
        hydrated = true;
        try { localStorage.setItem(LAST_FETCHED_AT_KEY, new Date().toISOString()); } catch { /* ignore */ }
        resetSyncRevisions();
        remotePayloadSignature = buildEditableSyncPayloadInfo(cloudSites, cloudPresets as SimulationPreset[], currentUser).signature;
        set({
          syncPending: false,
          pendingChangesCount: 0,
          syncStatus: "synced",
          lastSyncedAt: new Date().toISOString(),
          syncErrorMessage: null,
          syncBusy: false,
          syncStatusMessage: `Synced: ${result.siteCount} sites, ${result.simulationCount} simulations`,
        });
      }
      if (remotePayloadSignature) {
        lastSyncedPayloadSignature = remotePayloadSignature;
        writeStorage(SYNC_SIGNATURE_KEY, remotePayloadSignature);
      }
      const currentState = get();
      const currentPayload = buildEditableSyncPayloadInfo(
        currentState.siteLibrary,
        currentState.simulationPresets,
        currentState.currentUser,
      );
      if (currentPayload.signature === lastSyncedPayloadSignature) {
        console.log("[appStore] initializeCloudSync SUCCESS - no startup sync needed");
        set({
          syncPending: false,
          pendingChangesCount: 0,
          syncStatus: "synced",
          syncErrorMessage: null,
          syncBusy: false,
          syncStatusMessage: "Up to date",
          isInitializing: false,
        });
        return;
      }
      console.log("[appStore] initializeCloudSync SUCCESS - hydrated: true, scheduling sync...");
      if (syncTimer !== null) {
        window.clearTimeout(syncTimer);
      }
      set({ syncPending: true, syncBusy: true });
      syncTimer = window.setTimeout(async () => {
        if (!get().isOnline) {
          set({
            syncBusy: false,
            syncPending: true,
            syncStatus: "error",
            syncStatusMessage: "Offline. Changes are saved locally and will sync when reconnected.",
            syncErrorMessage: null,
            isInitializing: false,
          });
          return;
        }
        if (syncInFlight) {
          set({ syncPending: true, syncStatusMessage: "Waiting for active sync to finish..." });
          return;
        }
        console.log("[appStore] Post-init sync timer fired, checking for changes...");
        set({ syncStatus: "syncing", syncStatusMessage: "Checking for changes..." });
        const revisionAtStart = localMutationRevision;
        syncInFlight = true;
        try {
          const { siteLibrary, simulationPresets, currentUser } = get();
          const { payload, skippedCount, signature } = buildEditableSyncPayloadInfo(
            siteLibrary,
            simulationPresets,
            currentUser,
          );
          if (signature === lastSyncedPayloadSignature) {
            console.log("[appStore] Post-init: no changes to sync");
            markSyncedThrough(revisionAtStart);
            set({
              syncPending: false,
              pendingChangesCount: 0,
              syncStatus: "synced",
              syncErrorMessage: null,
              syncStatusMessage: "Up to date",
              isInitializing: false,
            });
            syncInFlight = false;
            set({ syncBusy: false, isInitializing: false });
            return;
          }
          console.log("[appStore] Post-init pushing payload:", {
            sites: payload.siteLibrary.length,
            simulations: payload.simulationPresets.length,
            skipped: skippedCount,
          });
          await pushCloudLibrary(payload);
          lastSyncedPayloadSignature = signature;
          writeStorage(SYNC_SIGNATURE_KEY, signature);
          console.log("[appStore] Post-init Push SUCCESS");
          const remaining = markSyncedThrough(revisionAtStart);
          set({
            syncPending: false,
            pendingChangesCount: remaining,
            syncStatus: "synced",
            lastSyncedAt: new Date().toISOString(),
            syncErrorMessage: null,
            syncStatusMessage: "Changes saved",
            isInitializing: false,
          });
        } catch (error) {
          console.error("[appStore] Post-init sync FAILED:", error);
          const message = getUiErrorMessage(error);
          set({
            syncPending: true,
            syncStatus: "error",
            syncErrorMessage: message,
            syncStatusMessage: `Save failed: ${message}`,
            isInitializing: false,
          });
        } finally {
          syncInFlight = false;
          set({ syncBusy: false, isInitializing: false });
        }
      }, SYNC_DEBOUNCE_MS);
    } catch (error) {
      console.error("[appStore] initializeCloudSync FAILED:", error);
      const message = getUiErrorMessage(error);
      if (isAuthRelatedErrorMessage(message)) {
        set({ currentUser: null, authState: "signed_out" });
      }
      set({
        syncPending: true,
        syncStatus: "error",
        syncErrorMessage: message,
        syncBusy: false,
        syncStatusMessage: `Sync failed: ${message}`,
        isInitializing: false,
      });
    }
  },
  performCloudSyncPush: () => {
    if (!hydrated) {
      console.log("[appStore] performCloudSyncPush skipped - not hydrated yet");
      return;
    }
    const { siteLibrary, simulationPresets, currentUser } = get();
    const currentPayload = buildEditableSyncPayloadInfo(siteLibrary, simulationPresets, currentUser);
    if (currentPayload.signature === lastSyncedPayloadSignature) {
      console.log("[appStore] performCloudSyncPush skipped - no changes since last sync");
      const remaining = markSyncedThrough();
      set({
        syncPending: remaining > 0,
        pendingChangesCount: remaining,
        syncStatus: "synced",
        syncErrorMessage: null,
        syncStatusMessage: "Up to date",
      });
      return;
    }
    const pendingChangesCount = recordLocalMutation();
    if (get().authState === "signed_out" || !get().currentUser?.id) {
      set({
        syncPending: true,
        syncStatus: "error",
        syncErrorMessage: "Not signed in.",
        syncStatusMessage: "Not signed in; cloud sync unavailable. Sign in and open Sync Status to recover pending changes.",
        pendingChangesCount,
      });
      return;
    }
    if (!get().isOnline) {
      set({
        syncPending: true,
        syncStatus: "error",
        syncErrorMessage: null,
        syncStatusMessage: "Offline. Changes are saved locally and will sync when reconnected.",
        pendingChangesCount,
      });
      return;
    }
    if (syncTimer !== null) {
      window.clearTimeout(syncTimer);
    }
    console.log("[appStore] Changes detected, scheduling sync in", SYNC_DEBOUNCE_MS, "ms");
    console.log("[appStore] Setting syncPending: true");
    set({
      syncPending: true,
      syncStatus: "synced",
      pendingChangesCount,
      syncErrorMessage: null,
      syncStatusMessage: `${pendingChangesCount} pending change${pendingChangesCount === 1 ? "" : "s"}`,
    });
    const timerId = window.setTimeout(async () => {
      if (!get().isOnline) {
        set({
          syncBusy: false,
          syncPending: true,
          syncStatus: "error",
          syncErrorMessage: null,
          syncStatusMessage: "Offline. Changes are saved locally and will sync when reconnected.",
        });
        return;
      }
      if (syncInFlight) {
        set({ syncPending: true, syncStatusMessage: "Waiting for active sync to finish..." });
        return;
      }
      console.log("[appStore] Auto-sync timer fired, pushing to cloud...");
      set({ syncBusy: true, syncStatus: "syncing", syncStatusMessage: "Saving changes..." });
      const revisionAtStart = localMutationRevision;
      syncInFlight = true;
      try {
        const { siteLibrary, simulationPresets, currentUser } = get();
        const isFullPush = requiresFullPush;
        const { payload, skippedCount, signature } = isFullPush
          ? buildEditableSyncPayloadInfo(siteLibrary, simulationPresets, currentUser)
          : buildDeltaSyncPayloadInfo(siteLibrary, simulationPresets, currentUser);
        const nothingDirty = !isFullPush && payload.siteLibrary.length === 0 && payload.simulationPresets.length === 0;
        if (signature === lastSyncedPayloadSignature || nothingDirty) {
          const remaining = markSyncedThrough(revisionAtStart);
          dirtySiteIds = new Set();
          dirtySimIds = new Set();
          requiresFullPush = false;
          set({
            syncPending: remaining > 0,
            pendingChangesCount: remaining,
            syncStatus: "synced",
            syncErrorMessage: null,
            syncStatusMessage: "No changes to sync",
          });
          return;
        }
        console.log("[appStore] Pushing payload:", {
          sites: payload.siteLibrary.length,
          simulations: payload.simulationPresets.length,
          skipped: skippedCount,
          isDelta: !isFullPush,
        });
        await pushCloudLibrary(payload);
        dirtySiteIds = new Set();
        dirtySimIds = new Set();
        requiresFullPush = false;
        // After push, recompute full signature so next push comparison is accurate
        lastSyncedPayloadSignature = buildEditableSyncPayloadInfo(siteLibrary, simulationPresets, currentUser).signature;
        writeStorage(SYNC_SIGNATURE_KEY, lastSyncedPayloadSignature);
        console.log("[appStore] Push SUCCESS");
        const remaining = markSyncedThrough(revisionAtStart);
        set({
          syncPending: remaining > 0,
          pendingChangesCount: remaining,
          syncStatus: "synced",
          lastSyncedAt: new Date().toISOString(),
          syncErrorMessage: null,
          syncStatusMessage: "Changes saved",
        });
      } catch (error) {
        console.error("[appStore] Auto-push FAILED:", error);
        const message = getUiErrorMessage(error);
        const isAuthError = isAuthRelatedErrorMessage(message);
        if (isAuthError) {
          console.log("[appStore] Auth error - keeping pending changes until auth is restored");
          set({
            currentUser: null,
            authState: "signed_out",
            syncPending: true,
            syncStatus: "error",
            syncErrorMessage: message,
            syncStatusMessage: "Not signed in; cloud sync unavailable. Sign in and open Sync Status to recover pending changes.",
          });
        } else {
          set({
            syncPending: true,
            syncStatus: "error",
            syncErrorMessage: message,
            syncStatusMessage: `Save failed: ${message}`,
          });
        }
      } finally {
        syncInFlight = false;
        set({ syncBusy: false });
      }
    }, SYNC_DEBOUNCE_MS);
    syncTimer = timerId;
  },
  performManualCloudSync: async () => {
    console.log("[appStore] performManualCloudSync START");
    if (!hydrated) {
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
    set({ syncBusy: true, syncStatus: "syncing", syncStatusMessage: "Syncing..." });
    try {
      const { siteLibrary, simulationPresets, currentUser, importLibraryData } = get();
      const editableSites = siteLibrary.filter((site) => canEditLibraryItem(site, currentUser));
      const editableSims = simulationPresets.filter((sim) => canEditLibraryItem(sim, currentUser));
      const skippedCount = siteLibrary.length - editableSites.length + simulationPresets.length - editableSims.length;
      const payload = { siteLibrary: editableSites, simulationPresets: editableSims };
      const payloadSignature = computeSyncPayloadSignature(payload);
      console.log("[appStore] Pushing local data to cloud:", {
        sites: editableSites.length,
        simulations: editableSims.length,
        skipped: skippedCount,
      });
      await pushCloudLibrary(payload);
      lastSyncedPayloadSignature = payloadSignature;
      writeStorage(SYNC_SIGNATURE_KEY, payloadSignature);
      console.log("[appStore] Push SUCCESS, fetching cloud data...");
      const cloud = await fetchCloudLibrary();
      console.log("[appStore] Cloud data received:", {
        sites: cloud.siteLibrary.length,
        simulations: cloud.simulationPresets.length,
      });
      const cloudPresets =
        (cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"] | undefined) ?? [];
      console.log("[appStore] Merging cloud data with local...");
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloudPresets,
        },
        "merge",
      );
      console.log("[appStore] Merge result:", result);
      hydrated = true;
      const remaining = markSyncedThrough();
      set({
        syncPending: remaining > 0,
        pendingChangesCount: remaining,
        syncStatus: "synced",
        lastSyncedAt: new Date().toISOString(),
        syncErrorMessage: null,
        syncBusy: false,
        syncStatusMessage: `Synced: ${result.siteCount} sites, ${result.simulationCount} simulations`,
      });
      console.log("[appStore] performManualCloudSync SUCCESS");
    } catch (error) {
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
      syncInFlight = false;
      set({ syncBusy: false });
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
    const migratedScenario = migrateSitesAndLinksToSiteRadioDefaults(scenario.sites, scenario.links);
    const libraryBacked = ensureSitesBackedByLibrary(migratedScenario.sites, get().siteLibrary);
    if (libraryBacked.addedCount > 0) {
      writeStorage(SITE_LIBRARY_KEY, libraryBacked.siteLibrary);
    }
    set({
      selectedScenarioId: scenario.id,
      sites: libraryBacked.sites,
      links: migratedScenario.links,
      systems: scenario.systems,
      networks: scenario.networks,
      selectedSiteId: scenario.defaultSiteId,
      selectedSiteIds: scenario.defaultSiteId ? [scenario.defaultSiteId] : [],
      selectedLinkId: scenario.defaultLinkId,
      profileCursorIndex: 0,
      temporaryDirectionReversed: false,
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
      isHighResTerrainLoaded: false,
      terrainLoadingStartedAtMs: 0,
      terrainLoadEpoch: 0,
      siteDragPreview: {},
      endpointPickTarget: null,
      mapViewport: scenario.viewport,
      siteLibrary: libraryBacked.siteLibrary,
      fitSitesEpoch: get().fitSitesEpoch + 1,
    });
    writeStorage(LAST_SESSION_KEY, { selectedScenarioId: scenario.id, savedAtIso: new Date().toISOString() });
    useCoverageStore.getState().recomputeCoverage();
  },
  loadDemoScenario: () => {
    const scenario = DEMO_SCENARIO;
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
      links: scenario.links,
      systems: scenario.systems,
      networks: scenario.networks,
      selectedSiteId: selectedSiteIds[0] ?? scenario.defaultSiteId,
      selectedSiteIds,
      selectedLinkId: scenario.defaultLinkId,
      profileCursorIndex: 0,
      temporaryDirectionReversed: false,
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
      isHighResTerrainLoaded: false,
      terrainLoadingStartedAtMs: 0,
      terrainLoadEpoch: 0,
      siteDragPreview: {},
      endpointPickTarget: null,
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
  setTerrainDataset: (dataset) => {
    set({ terrainDataset: dataset });
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

      return {
        sites: remainingSites,
        links: remainingLinks,
        selectedSiteId: nextSelectedIds[0] ?? safeSiteId,
        selectedSiteIds: nextSelectedIds,
        selectedLinkId: safeLinkId,
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
  createLink: (fromSiteId, toSiteId, name) => {
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
    const inheritedFrequencyMHz = selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 869.618;
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
      return { siteLibrary: next };
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
          selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? base?.frequencyMHz ?? 869.618;
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
        869.618;

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
                bandwidthKhz: 62,
                spreadFactor: 8,
                codingRate: 5,
                frequencyOverrideMHz: inheritedFrequencyMHz,
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
      const nextSites = syncLibraryLinkedSiteValues(state.sites, next);
      const nextSitesById = new Map(nextSites.map((site) => [site.id, site]));
      const nextLinks = state.links.map((link) =>
        stripRedundantLinkRadioOverrides(
          link,
          nextSitesById.get(link.fromSiteId),
          nextSitesById.get(link.toSiteId),
        ),
      );
      return { siteLibrary: next, sites: nextSites, links: nextLinks };
    });
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  deleteSiteLibraryEntry: (entryId) => {
    get().deleteSiteLibraryEntries([entryId]);
  },
  deleteSiteLibraryEntries: (entryIds) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "deleteSiteLibraryEntries");
    if (!user) return;
    const requested = new Set(entryIds);
    if (!requested.size) return;
    const state = get();
    for (const entryId of entryIds) {
      const entry = state.siteLibrary.find((e) => e.id === entryId);
      if (entry && !canEditItem(entry, user)) {
        console.warn(`[appStore] deleteSiteLibraryEntries: User ${user.id} cannot delete entry ${entryId}`);
        return;
      }
    }
    set((state) => {
      const next = state.siteLibrary.filter((entry) => !requested.has(entry.id));
      writeStorage(SITE_LIBRARY_KEY, next);
      const updatedPresets = state.simulationPresets.map((preset) => {
        const hasRef = preset.snapshot.sites.some((site) => site.libraryEntryId && requested.has(site.libraryEntryId));
        if (!hasRef) return preset;
        return {
          ...preset,
          snapshot: {
            ...preset.snapshot,
            sites: preset.snapshot.sites.map((site) =>
              site.libraryEntryId && requested.has(site.libraryEntryId)
                ? { ...site, libraryEntryId: undefined }
                : site,
            ),
          },
        };
      });
      writeStorage(SIM_PRESETS_KEY, updatedPresets);
      return { siteLibrary: next, simulationPresets: updatedPresets };
    });
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
      sites: normalized.sites,
      links: normalizedLinks,
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
      };

    set((current) => {
      const mergedLibrary =
        normalized.addedCount > 0
          ? normalizeSiteLibrary([...normalized.siteLibrary, ...current.siteLibrary])
          : current.siteLibrary;
      const currentSelectionDescription = current.simulationPresets.find(
        (preset) => preset.id === current.selectedScenarioId,
      )?.description;
      const visibilityBase = existing?.visibility ?? "private";
      const visibilitySafe =
        visibilityBase !== "private" && hasPrivateLibrarySiteReferences(snapshot.sites, mergedLibrary)
          ? "private"
          : visibilityBase;
      const nextPreset: SimulationPreset = {
        id: existing?.id ?? makeId("sim"),
        name: presetName,
        description: existing?.description ?? currentSelectionDescription,
        slug: slugifyValue(presetName),
        slugAliases: Array.from(
          new Set([
            ...((existing?.slugAliases ?? []).map((entry) => slugifyValue(entry))),
            ...(existing?.slug ? [slugifyValue(existing.slug)] : []),
          ]),
        ).filter((entry) => Boolean(entry) && entry !== slugifyValue(presetName)),
        visibility: visibilitySafe,
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
      markDirtySim(nextPreset.id);
      const next = [nextPreset, ...current.simulationPresets.filter((preset) => preset.id !== nextPreset.id)];
      writeStorage(SIM_PRESETS_KEY, next);
      if (normalized.addedCount > 0) {
        writeStorage(SITE_LIBRARY_KEY, mergedLibrary);
      }
      return {
        simulationPresets: next,
        siteLibrary: mergedLibrary,
        sites: normalized.sites,
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
    const defaultPresetId = resolveDefaultFrequencyPresetIdForNewSimulation(user);
    const selectedPresetId =
      typeof options?.frequencyPresetId === "string" && findPresetById(options.frequencyPresetId)
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
        rxSensitivityTargetDbm: current.rxSensitivityTargetDbm,
        environmentLossDb: current.environmentLossDb,
        propagationEnvironment: current.propagationEnvironment,
        autoPropagationEnvironment: current.autoPropagationEnvironment,
        terrainDataset: current.terrainDataset,
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
      };
      const next = [nextPreset, ...current.simulationPresets];
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
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
      sites: normalized.sites,
      links: normalizedLinks,
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
      };
    set((current) => {
      const mergedLibrary =
        normalized.addedCount > 0
          ? normalizeSiteLibrary([...normalized.siteLibrary, ...current.siteLibrary])
          : current.siteLibrary;
      const visibilityBase = existing.visibility ?? "private";
      const visibilitySafe =
        visibilityBase !== "private" && hasPrivateLibrarySiteReferences(snapshot.sites, mergedLibrary)
          ? "private"
          : visibilityBase;
      const nextPreset: SimulationPreset = {
        id: existing.id,
        name: existing.name,
        description: existing.description,
        slug: existing.slug ?? slugifyValue(existing.name),
        slugAliases: existing.slugAliases ?? [],
        visibility: visibilitySafe,
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
    markDirtySim(selectedScenarioId);
    writeStorage(SIM_PRESETS_KEY, newPresets);
    set({ simulationPresets: newPresets, siteLibrary: nextSiteLibrary, sites: normalizedSites.sites });
    console.log("[appStore] Updated current simulation snapshot");
  },
  loadSimulationPreset: (presetId) => {
    const preset = get().simulationPresets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    const snap = preset.snapshot;
    const rawSites = Array.isArray(snap.sites) ? snap.sites : [];
    const rawLinks = Array.isArray(snap.links) ? snap.links : [];
    const migratedSnap = migrateSitesAndLinksToSiteRadioDefaults(rawSites, rawLinks);
    const isBlankSnapshot = rawSites.length === 0 && rawLinks.length === 0;
    if (isBlankSnapshot) {
      const snapshotSystems = Array.isArray(snap.systems) && snap.systems.length ? snap.systems : defaultScenario.systems;
      const snapshotNetworks = Array.isArray(snap.networks) ? snap.networks : [];
      const viewport = defaultScenario.viewport;
      const loadedAtIso = new Date().toISOString();
      set({
        selectedScenarioId: preset.id,
        sites: [],
        links: [],
        systems: snapshotSystems,
        networks: snapshotNetworks,
        selectedSiteId: "",
        selectedSiteIds: [],
        selectedLinkId: "",
        temporaryDirectionReversed: false,
        selectedNetworkId: "",
        selectedCoverageResolution: normalizeCoverageResolution(snap.selectedCoverageResolution),
        selectedOverlayRadiusOption: isOverlayRadiusOption(snap.selectedOverlayRadiusOption)
          ? snap.selectedOverlayRadiusOption
          : defaultOptionForSelectionCount(0),
        propagationModel: "ITM" as const,
        selectedFrequencyPresetId: typeof snap.selectedFrequencyPresetId === "string" ? snap.selectedFrequencyPresetId : "custom",
        rxSensitivityTargetDbm: typeof snap.rxSensitivityTargetDbm === "number" ? snap.rxSensitivityTargetDbm : -120,
        environmentLossDb: typeof snap.environmentLossDb === "number" ? snap.environmentLossDb : 0,
        propagationEnvironment: snap.propagationEnvironment ?? defaultPropagationEnvironment(),
        autoPropagationEnvironment: snap.autoPropagationEnvironment ?? true,
        propagationEnvironmentReason: (snap.autoPropagationEnvironment ?? true)
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
      migratedSnap.links,
      Array.isArray(snap.systems) ? snap.systems : [],
      Array.isArray(snap.networks) ? snap.networks : [],
    );
    const libraryBacked = ensureSitesBackedByLibrary(recovered.sites, get().siteLibrary);
    const recoveredSites = syncLibraryLinkedSiteValues(libraryBacked.sites, libraryBacked.siteLibrary);
    const bounds = simulationAreaBoundsForSites(recoveredSites);
    const viewport = bounds ? boundsToViewport(bounds) : defaultScenario.viewport;
    const selectedSiteId = recoveredSites.some((site) => site.id === snap.selectedSiteId)
      ? snap.selectedSiteId
      : recoveredSites[0].id;
    const selectedLinkId = recovered.links.some((link) => link.id === snap.selectedLinkId)
      ? snap.selectedLinkId
      : recovered.links[0].id;
    const selectedNetworkId = recovered.networks.some((network) => network.id === snap.selectedNetworkId)
      ? snap.selectedNetworkId
      : recovered.networks[0].id;
    set({
      selectedScenarioId: preset.id,
      sites: recoveredSites,
      links: recovered.links,
      systems: recovered.systems,
      networks: recovered.networks,
      selectedSiteId,
      selectedSiteIds: selectedSiteId ? [selectedSiteId] : [],
      selectedLinkId,
      temporaryDirectionReversed: false,
      selectedNetworkId,
      selectedCoverageResolution: normalizeCoverageResolution(snap.selectedCoverageResolution),
      selectedOverlayRadiusOption: isOverlayRadiusOption(snap.selectedOverlayRadiusOption)
        ? snap.selectedOverlayRadiusOption
        : defaultOptionForSelectionCount(selectedSiteId ? 1 : 0),
      propagationModel: "ITM" as const,
      selectedFrequencyPresetId: typeof snap.selectedFrequencyPresetId === "string" ? snap.selectedFrequencyPresetId : "custom",
      rxSensitivityTargetDbm:
        typeof snap.rxSensitivityTargetDbm === "number" ? snap.rxSensitivityTargetDbm : -120,
      environmentLossDb: typeof snap.environmentLossDb === "number" ? snap.environmentLossDb : 0,
      propagationEnvironment: snap.propagationEnvironment ?? defaultPropagationEnvironment(),
      autoPropagationEnvironment: snap.autoPropagationEnvironment ?? true,
      propagationEnvironmentReason: (snap.autoPropagationEnvironment ?? true)
        ? "Auto defaults active."
        : "Manual override active.",
      terrainDataset:
        normalizeTerrainDataset(snap.terrainDataset),
      mapViewport: viewport,
      siteDragPreview: {},
      terrainFetchStatus: `Loaded simulation preset: ${preset.name}`,
      siteLibrary: libraryBacked.siteLibrary,
      mapOverlayMode: defaultOverlayModeForSelectionCount(selectedSiteId ? 1 : 0),
      fitSitesEpoch: get().fitSitesEpoch + 1,
    });
    if (libraryBacked.addedCount > 0) {
      writeStorage(SITE_LIBRARY_KEY, libraryBacked.siteLibrary);
    }
    writeStorage(LAST_SESSION_KEY, { selectedScenarioId: preset.id, savedAtIso: new Date().toISOString() });
    useCoverageStore.getState().recomputeCoverage();
  },
  renameSimulationPreset: (presetId, name) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "renameSimulationPreset");
    if (!user) return;
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (existing && !canEditItem(existing, user)) {
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
      return { simulationPresets: next };
    });
  },
  updateSimulationPresetEntry: (presetId, patch) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "updateSimulationPresetEntry");
    if (!user) return;
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (existing && !canEditItem(existing, user)) {
      console.warn(`[appStore] updateSimulationPresetEntry: User ${user.id} cannot edit simulation ${presetId}`);
      return;
    }
    if (typeof patch.name === "string") {
      const candidate = patch.name.trim();
      if (!candidate) return;
      if (hasDuplicateSimulationName(get().simulationPresets, candidate, presetId)) return;
    }
    markDirtySim(presetId);
    set((state) => {
      const next = state.simulationPresets.map((preset) => {
        if (preset.id !== presetId) return preset;
        const nextName = typeof patch.name === "string" ? patch.name.trim() : preset.name;
        const nextDescription =
          typeof patch.description === "string" ? patch.description.trim() || undefined : preset.description;
        const nextSlug = slugifyValue(nextName || preset.name);
        const aliasSet = new Set([
          ...(preset.slug ? [slugifyValue(preset.slug)] : []),
          ...((preset.slugAliases ?? []).map((entry) => slugifyValue(entry))),
        ]);
        aliasSet.delete(nextSlug);
        const nextVisibilityRaw = patch.visibility ?? preset.visibility ?? "private";
        const nextVisibility =
          nextVisibilityRaw !== "private" && hasPrivateLibrarySiteReferences(preset.snapshot.sites, state.siteLibrary)
            ? "private"
            : nextVisibilityRaw;
        return {
          ...preset,
          ...patch,
          name: nextName,
          description: nextDescription,
          slug: nextSlug,
          slugAliases: Array.from(aliasSet).filter(Boolean),
          visibility: nextVisibility,
          updatedAt: new Date().toISOString(),
          lastEditedByUserId: user.id,
          lastEditedByName: user.username,
          lastEditedByAvatarUrl: user.avatarUrl ?? "",
        };
      });
      writeStorage(SIM_PRESETS_KEY, next);
      return { simulationPresets: next };
    });
  },
  deleteSimulationPreset: (presetId) => {
    const { currentUser } = get();
    const user = requireAuth(currentUser, "deleteSimulationPreset");
    if (!user) return;
    const existing = get().simulationPresets.find((preset) => preset.id === presetId);
    if (existing && !canEditItem(existing, user)) {
      console.warn(`[appStore] deleteSimulationPreset: User ${user.id} cannot delete simulation ${presetId}`);
      return;
    }
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

    const libraryBackedSites = ensureSitesBackedByLibrary(
      annotateSitesWithLibraryRefs(current.sites, nextSiteLibrary),
      nextSiteLibrary,
    );
    const syncedSites = syncLibraryLinkedSiteValues(
      libraryBackedSites.sites,
      libraryBackedSites.siteLibrary,
    );

    writeStorage(SITE_LIBRARY_KEY, libraryBackedSites.siteLibrary);
    writeStorage(SIM_PRESETS_KEY, nextSimulationPresets);
    set({
      siteLibrary: libraryBackedSites.siteLibrary,
      simulationPresets: nextSimulationPresets,
      sites: syncedSites,
    });
    useCoverageStore.getState().recomputeCoverage();
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
  setShowSimulationLibraryRequest: (show) => set({ showSimulationLibraryRequest: show }),
  setShowNewSimulationRequest: (show) => set({ showNewSimulationRequest: show }),
  setShowSiteLibraryRequest: (show) => set({ showSiteLibraryRequest: show }),
  requestOpenSiteLibraryEntry: (entryId) =>
    set({
      pendingSiteLibraryOpenEntryId: entryId.trim() ? entryId : null,
    }),
  clearOpenSiteLibraryEntryRequest: () => set({ pendingSiteLibraryOpenEntryId: null }),
  setMapOverlayMode: (mode) =>
    set((state) => {
      if (state.mapOverlayMode === mode) return state;
      return { mapOverlayMode: mode };
    }),
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
    useCoverageStore.getState().recomputeCoverage();
    get().updateCurrentSimulationSnapshot();
  },
  updateSite: (id, patch) => {
    const { currentUser, sites, siteLibrary, selectedScenarioId, simulationPresets } = get();
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
      const nextSites = state.sites.map((site) =>
        site.id === id ? withSiteRadioDefaults({ ...site, ...patch }) : site,
      );
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
            }
          : entry,
      );
      writeStorage(SITE_LIBRARY_KEY, nextLibrary);
      return { sites: nextSites, siteLibrary: nextLibrary };
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
  ingestSrtmFiles: async (files) => {
    set({
      isTerrainFetching: true,
      terrainProgressPercent: 0,
      terrainProgressTilesLoaded: 0,
      terrainProgressTilesTotal: 0,
      terrainProgressBytesLoaded: 0,
      terrainProgressBytesEstimated: 0,
    });
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
        const nextTiles = mergeSrtmTiles(state.srtmTiles, parsed);
        return {
          srtmTiles: nextTiles,
          terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics(nextTiles),
          isTerrainFetching: false,
          terrainProgressPercent: 0,
        };
      });
      clearTerrainLossCache();
      useCoverageStore.getState().recomputeCoverage();
    } finally {
      set({ isTerrainFetching: false, terrainProgressPercent: 0 });
    }
  },
  recommendTerrainDatasetForCurrentArea: async () => {
    const { sites } = get();
    if (!sites.length) return;

    const bounds = bufferedBoundsForSites(sites, 20);
    if (!bounds) return;

    set({ terrainRecommendation: "Evaluating terrain dataset coverage...", isTerrainRecommending: true });
    try {
      const copernicusRecommendation = await recommendCopernicusDatasetForArea(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        ["copernicus90"] as const,
      );
      const perDataset = `${TERRAIN_DATASET_LABEL.copernicus90}: ${Math.round(copernicusRecommendation.byDataset.copernicus90.completeness * 100)}% (${copernicusRecommendation.byDataset.copernicus90.availableTiles}/${copernicusRecommendation.expectedTiles})`;
      set({
        terrainDataset: "copernicus90",
        terrainRecommendation: `Terrain coverage: ${perDataset}`,
        isTerrainRecommending: false,
      });
    } catch (error) {
      const message = getUiErrorMessage(error);
      set({ terrainRecommendation: `Recommendation failed: ${message}`, isTerrainRecommending: false });
    }
  },
  fetchTerrainForCurrentArea: async (targetRadiusKm = 20) => {
    const { sites, srtmTiles, isTerrainFetching } = get();
    if (isTerrainFetching) return;
    if (!sites.length) return;

    const radiusKm = Math.max(20, Math.min(500, Math.round(targetRadiusKm)));
    const coreBounds = bufferedBoundsForSites(sites, radiusKm);
    const extendedBounds = bufferedBoundsForSites(sites, radiusKm);
    if (!coreBounds || !extendedBounds) return;

    const requiredTileKeys = new Set(
      tilesForBounds(coreBounds.minLat, coreBounds.maxLat, coreBounds.minLon, coreBounds.maxLon),
    );
    const extendedTileKeys = new Set(
      tilesForBounds(extendedBounds.minLat, extendedBounds.maxLat, extendedBounds.minLon, extendedBounds.maxLon),
    );
    const extendedOnlyKeys = new Set([...extendedTileKeys].filter((key) => !requiredTileKeys.has(key)));
    const existingTileKeys = new Set(srtmTiles.filter((t) => t.sourceId === "copernicus30").map((t) => t.key));
    const alreadyHasHighRes = [...requiredTileKeys].every((k) => existingTileKeys.has(k));
    const SMALL_AREA_TILE_THRESHOLD = 4;
    const isSmallArea = requiredTileKeys.size <= SMALL_AREA_TILE_THRESHOLD;

    const endpointKeys = new Set<string>();
    const prioritizedSites = sites.length >= 2 ? [sites[0], sites[sites.length - 1]] : sites;
    for (const site of prioritizedSites) {
      for (const dLat of [-1, 0, 1]) {
        for (const dLon of [-1, 0, 1]) {
          const lat = site.position.lat + dLat;
          const lon = site.position.lon + dLon;
          const ns = lat >= 0 ? "N" : "S";
          const ew = lon >= 0 ? "E" : "W";
          endpointKeys.add(`${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`);
        }
      }
    }

    set({
      terrainFetchStatus:
        (isSmallArea ? "Loading terrain (30m, small area)" : "Loading terrain (90m, broad coverage)") +
        ` for ${radiusKm} km...`,
      isTerrainFetching: true,
      isHighResTerrainLoaded: alreadyHasHighRes,
      terrainLoadingStartedAtMs: Date.now(),
      terrainProgressPercent: 0,
      terrainProgressTilesLoaded: 0,
      terrainProgressTilesTotal: isSmallArea ? requiredTileKeys.size : requiredTileKeys.size,
      terrainProgressBytesLoaded: 0,
      terrainProgressBytesEstimated: 0,
    });

    let terrainProgressTilesLoaded = 0;
    let terrainProgressTilesTotal = isSmallArea ? requiredTileKeys.size : requiredTileKeys.size;
    let terrainProgressBytesLoaded = 0;
    let terrainProgressMeasuredTiles = 0;
    const syncTerrainProgress = () => {
      const estimatedBytes =
        terrainProgressMeasuredTiles > 0
          ? Math.round((terrainProgressBytesLoaded / terrainProgressMeasuredTiles) * Math.max(terrainProgressTilesTotal, 1))
          : 0;
      const percent =
        terrainProgressTilesTotal > 0
          ? Math.min(100, Math.round((terrainProgressTilesLoaded / terrainProgressTilesTotal) * 100))
          : 0;
      set({
        terrainProgressPercent: percent,
        terrainProgressTilesLoaded,
        terrainProgressTilesTotal,
        terrainProgressBytesLoaded,
        terrainProgressBytesEstimated: estimatedBytes,
      });
    };
    const extendTerrainProgressTotal = (byTiles: number) => {
      if (byTiles <= 0) return;
      terrainProgressTilesTotal += byTiles;
      syncTerrainProgress();
    };
    const makeTileProgressHandler = () => {
      const seen = new Set<string>();
      return (progress: CopernicusTileProgress) => {
        const key = progress.tileKey;
        if (seen.has(key)) return;
        seen.add(key);
        terrainProgressTilesLoaded += 1;
        if (progress.bytes > 0) {
          terrainProgressBytesLoaded += progress.bytes;
          terrainProgressMeasuredTiles += 1;
        }
        syncTerrainProgress();
      };
    };

    const loadPhased = async (
      dataset: CopernicusDataset,
      bounds: TerrainFetchBounds,
      priorityKeys?: Set<string>,
      skipRemaining = false,
    ) =>
      loadCopernicusTilesForAreaPhased(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        dataset,
        priorityKeys,
        { skipRemaining, onTileProgress: makeTileProgressHandler() },
      );

    const applyTiles = (result: CopernicusLoadResult) => {
      if (!result.tiles.length) return;
      set((state) => {
        const nextTiles = mergeSrtmTiles(state.srtmTiles, result.tiles);
        return {
          srtmTiles: nextTiles,
          terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics(nextTiles),
        };
      });
      useCoverageStore.getState().recomputeCoverage();
    };

    const mergeLoadResults = (left: CopernicusLoadResult, right: CopernicusLoadResult): CopernicusLoadResult => ({
      tiles: [...left.tiles, ...right.tiles],
      failedTiles: [...left.failedTiles, ...right.failedTiles],
      fetchedTiles: [...left.fetchedTiles, ...right.fetchedTiles],
      cacheHits: [...left.cacheHits, ...right.cacheHits],
      fallbackTiles: [...left.fallbackTiles, ...right.fallbackTiles],
    });

    const formatStatus = (result: CopernicusLoadResult, sourceLabel: string, priorityLoaded = false): string => {
      const parts = [
        `Loaded ${result.tiles.length} tile(s)`,
        result.fetchedTiles.length ? `${result.fetchedTiles.length} fetched` : "",
        result.cacheHits.length ? `${result.cacheHits.length} from cache` : "",
        result.fallbackTiles.length ? `${result.fallbackTiles.length} fallback to Copernicus GLO-90` : "",
        result.failedTiles.length ? `${result.failedTiles.length} failed` : "",
        priorityLoaded && endpointKeys.size > 0 ? `priority tiles done` : "",
      ].filter(Boolean);
      const missing = result.failedTiles;
      return `${parts.join(", ")} from ${sourceLabel}.${missing.length ? ` Missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}` : ""}`;
    };

    try {
      if (alreadyHasHighRes) {
        set({
          terrainFetchStatus: formatStatus(
            { tiles: [], fetchedTiles: [], cacheHits: [], fallbackTiles: [], failedTiles: [] },
            TERRAIN_DATASET_FETCH_LABEL.copernicus30,
          ),
          isTerrainFetching: false,
          terrainLoadingStartedAtMs: 0,
          terrainProgressPercent: 100,
        });
        return;
      }

      if (isSmallArea) {
        set({ terrainFetchStatus: `Loading terrain (30m, small area) for ${radiusKm} km...`, isHighResTerrainLoaded: false });
        const phased = await loadPhased("copernicus30", coreBounds);
        applyTiles(phased.priority);
        applyTiles(phased.remaining);
        const thirtyResult = mergeLoadResults(phased.priority, phased.remaining);
        set({
          terrainFetchStatus: formatStatus(thirtyResult, TERRAIN_DATASET_FETCH_LABEL.copernicus30),
          isTerrainFetching: false,
          isHighResTerrainLoaded: true,
          terrainLoadingStartedAtMs: 0,
          terrainLoadEpoch: 0,
          terrainProgressPercent: 100,
        });
        return;
      }

      const ninetyPhased = await loadPhased("copernicus90", coreBounds, endpointKeys);
      applyTiles(ninetyPhased.priority);
      set({ terrainFetchStatus: `Loading terrain (90m, broad coverage refinement) for ${radiusKm} km...` });
      applyTiles(ninetyPhased.remaining);
      const ninetyResult = mergeLoadResults(ninetyPhased.priority, ninetyPhased.remaining);

      const currentState = get();
      const currentTileKeys = new Set(currentState.srtmTiles.filter((t) => t.sourceId === "copernicus30").map((t) => t.key));
      const hasHighResNow = [...requiredTileKeys].every((k) => currentTileKeys.has(k));
      if (hasHighResNow) {
        set({
          terrainFetchStatus: formatStatus(ninetyResult, TERRAIN_DATASET_FETCH_LABEL.copernicus90),
          isTerrainFetching: false,
          isHighResTerrainLoaded: true,
          terrainLoadingStartedAtMs: 0,
          terrainProgressPercent: 100,
        });
        return;
      }

      extendTerrainProgressTotal(requiredTileKeys.size);
      set({ terrainFetchStatus: `Loading terrain (30m, high-res refinement) for ${radiusKm} km...`, isHighResTerrainLoaded: false });
      const thirtyPhased = await loadPhased("copernicus30", coreBounds, endpointKeys);
      applyTiles(thirtyPhased.priority);
      applyTiles(thirtyPhased.remaining);
      const thirtyResult = mergeLoadResults(thirtyPhased.priority, thirtyPhased.remaining);

      if (extendedOnlyKeys.size > 0) {
        extendTerrainProgressTotal(extendedOnlyKeys.size);
        set({ terrainFetchStatus: `Loading terrain (30m, extended radial area) for ${radiusKm} km...` });
        const extendedPhased = await loadPhased("copernicus30", extendedBounds, extendedOnlyKeys, true);
        applyTiles(extendedPhased.priority);
      }
      set({
        terrainFetchStatus: formatStatus(thirtyResult, TERRAIN_DATASET_FETCH_LABEL.copernicus30),
        isTerrainFetching: false,
        isHighResTerrainLoaded: true,
        terrainLoadingStartedAtMs: 0,
        terrainLoadEpoch: 0,
        terrainProgressPercent: 100,
      });
    } catch (error) {
      const message = getUiErrorMessage(error);
      set({ terrainFetchStatus: `Terrain fetch failed: ${message}`, isTerrainFetching: false, terrainLoadingStartedAtMs: 0 });
    }
  },
  recommendAndFetchTerrainForCurrentArea: (targetRadiusKm) => get().loadTerrainForCurrentArea(targetRadiusKm),
  loadTerrainForCoordinate: async (lat: number, lon: number) => {
    const { isEditorTerrainFetching, srtmTiles, terrainDataset } = get();
    if (isEditorTerrainFetching) return;
    if (sampleSrtmElevation(srtmTiles, lat, lon) !== null) return;
    set({ isEditorTerrainFetching: true });
    try {
      const minLat = Math.floor(lat);
      const minLon = Math.floor(lon);
      const result = await loadCopernicusTilesForAreaPhased(
        minLat,
        minLat + 1,
        minLon,
        minLon + 1,
        terrainDataset ?? "copernicus90",
      );
      const incoming = [...result.priority.tiles, ...result.remaining.tiles];
      if (incoming.length > 0) {
        set((state) => {
          const nextTiles = mergeSrtmTiles(state.srtmTiles, incoming);
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
  loadTerrainForCurrentArea: async (targetRadiusKm = 20) => {
    if (get().isTerrainFetching) return;
    const { sites } = get();
    if (!sites.length) return;

    const radiusKm = Math.max(20, Math.min(500, Math.round(targetRadiusKm)));
    const coreBounds = bufferedBoundsForSites(sites, radiusKm);
    const extendedBounds = bufferedBoundsForSites(sites, radiusKm);
    if (!coreBounds || !extendedBounds) return;

    const { terrainLoadEpoch: currentEpoch } = get();
    const epoch = currentEpoch + 1;
    clearTerrainLossCache();
    set({
      terrainLoadEpoch: epoch,
      isTerrainRecommending: true,
      isTerrainFetching: true,
      terrainRecommendation: "Evaluating terrain dataset coverage...",
      terrainFetchStatus: `Loading terrain (90m) for ${radiusKm} km...`,
      terrainLoadingStartedAtMs: Date.now(),
      terrainProgressPercent: 0,
      terrainProgressTilesLoaded: 0,
      terrainProgressTilesTotal: 0,
      terrainProgressBytesLoaded: 0,
      terrainProgressBytesEstimated: 0,
      terrainProgressTransientDecodeBytesEstimated: 0,
      terrainProgressPhaseLabel: "",
      terrainProgressPhaseIndex: 0,
      terrainProgressPhaseTotal: 0,
    });

    try {
      const copernicusRecommendation = await recommendCopernicusDatasetForArea(
        coreBounds.minLat,
        coreBounds.maxLat,
        coreBounds.minLon,
        coreBounds.maxLon,
        ["copernicus90"] as const,
      );
      if (get().terrainLoadEpoch !== epoch) return;
      const perDataset = `${TERRAIN_DATASET_LABEL.copernicus90}: ${Math.round(copernicusRecommendation.byDataset.copernicus90.completeness * 100)}% (${copernicusRecommendation.byDataset.copernicus90.availableTiles}/${copernicusRecommendation.expectedTiles})`;
      set({
        terrainDataset: "copernicus90",
        terrainRecommendation: `Terrain coverage: ${perDataset}`,
        isTerrainRecommending: false,
      });
    } catch (error) {
      if (get().terrainLoadEpoch !== epoch) return;
      const message = getUiErrorMessage(error);
      set({
        terrainRecommendation: `Recommendation failed: ${message}`,
        terrainFetchStatus: `Terrain fetch failed: ${message}`,
        isTerrainRecommending: false,
        isTerrainFetching: false,
        terrainLoadingStartedAtMs: 0,
        terrainProgressPercent: 0,
        terrainProgressTransientDecodeBytesEstimated: 0,
        terrainProgressPhaseLabel: "",
        terrainProgressPhaseIndex: 0,
        terrainProgressPhaseTotal: 0,
      });
      return;
    }

    if (get().terrainLoadEpoch !== epoch) return;

    const { srtmTiles } = get();
    const requiredTileKeys = new Set(
      tilesForBounds(coreBounds.minLat, coreBounds.maxLat, coreBounds.minLon, coreBounds.maxLon),
    );
    const extendedTileKeys = new Set(
      tilesForBounds(extendedBounds.minLat, extendedBounds.maxLat, extendedBounds.minLon, extendedBounds.maxLon),
    );
    const extendedOnlyKeys = new Set([...extendedTileKeys].filter((key) => !requiredTileKeys.has(key)));
    const existingTileKeys = new Set(srtmTiles.filter((t) => t.sourceId === "copernicus30").map((t) => t.key));
    const alreadyHasHighRes = [...requiredTileKeys].every((k) => existingTileKeys.has(k));
    const SMALL_AREA_TILE_THRESHOLD = 4;
    const isSmallArea = requiredTileKeys.size <= SMALL_AREA_TILE_THRESHOLD;

    const endpointKeys = new Set<string>();
    const prioritizedSites = sites.length >= 2 ? [sites[0], sites[sites.length - 1]] : sites;
    for (const site of prioritizedSites) {
      for (const dLat of [-1, 0, 1]) {
        for (const dLon of [-1, 0, 1]) {
          const lat = site.position.lat + dLat;
          const lon = site.position.lon + dLon;
          const ns = lat >= 0 ? "N" : "S";
          const ew = lon >= 0 ? "E" : "W";
          endpointKeys.add(`${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`);
        }
      }
    }

    const terrainPhaseTotal = isSmallArea ? 1 : extendedOnlyKeys.size > 0 ? 3 : 2;
    set({
      terrainFetchStatus:
        (isSmallArea ? "Loading terrain (30m, small area)" : "Loading terrain (90m, broad coverage)") +
        ` for ${radiusKm} km...`,
      isHighResTerrainLoaded: alreadyHasHighRes,
      terrainProgressPhaseTotal: terrainPhaseTotal,
    });

    let terrainProgressTilesLoaded = 0;
    let terrainProgressTilesTotal = isSmallArea ? requiredTileKeys.size : requiredTileKeys.size;
    let terrainProgressBytesLoaded = 0;
    let terrainProgressMeasuredTiles = 0;
    let terrainProgressPhaseIndex = 0;
    let terrainProgressPhaseLabel = "";
    let terrainPhaseTileCounts: { copernicus30: number; copernicus90: number } = { copernicus30: 0, copernicus90: 0 };
    const syncTerrainProgress = () => {
      const estimatedBytes =
        terrainProgressMeasuredTiles > 0
          ? Math.round((terrainProgressBytesLoaded / terrainProgressMeasuredTiles) * Math.max(terrainProgressTilesTotal, 1))
          : 0;
      const percent =
        terrainProgressTilesTotal > 0
          ? Math.min(100, Math.round((terrainProgressTilesLoaded / terrainProgressTilesTotal) * 100))
          : 0;
      set({
        terrainProgressPercent: percent,
        terrainProgressTilesLoaded,
        terrainProgressTilesTotal,
        terrainProgressBytesLoaded,
        terrainProgressBytesEstimated: estimatedBytes,
        terrainProgressTransientDecodeBytesEstimated: estimateTransientDecodeBytes(terrainPhaseTileCounts),
        terrainProgressPhaseLabel,
        terrainProgressPhaseIndex,
        terrainProgressPhaseTotal: terrainPhaseTotal,
      });
    };
    const startTerrainPhase = (phaseLabel: string, totalTiles: number, statusText: string) => {
      terrainProgressPhaseIndex += 1;
      terrainProgressPhaseLabel = phaseLabel;
      terrainProgressTilesLoaded = 0;
      terrainProgressTilesTotal = Math.max(0, totalTiles);
      terrainProgressBytesLoaded = 0;
      terrainProgressMeasuredTiles = 0;
      terrainPhaseTileCounts = { copernicus30: 0, copernicus90: 0 };
      set({
        terrainFetchStatus: statusText,
        terrainProgressPhaseIndex,
        terrainProgressPhaseLabel,
        terrainProgressPhaseTotal: terrainPhaseTotal,
      });
      syncTerrainProgress();
    };
    const makeTileProgressHandler = () => {
      const seen = new Set<string>();
      return (progress: CopernicusTileProgress) => {
        const key = progress.tileKey;
        if (seen.has(key)) return;
        seen.add(key);
        terrainProgressTilesLoaded += 1;
        if (progress.dataset === "copernicus30") terrainPhaseTileCounts.copernicus30 += 1;
        if (progress.dataset === "copernicus90") terrainPhaseTileCounts.copernicus90 += 1;
        if (progress.bytes > 0) {
          terrainProgressBytesLoaded += progress.bytes;
          terrainProgressMeasuredTiles += 1;
        }
        syncTerrainProgress();
      };
    };

    const loadPhased = async (
      dataset: CopernicusDataset,
      bounds: TerrainFetchBounds,
      priorityKeys?: Set<string>,
      skipRemaining = false,
    ) =>
      loadCopernicusTilesForAreaPhased(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        dataset,
        priorityKeys,
        { skipRemaining, onTileProgress: makeTileProgressHandler() },
      );

    const applyTiles = (result: CopernicusLoadResult) => {
      if (!result.tiles.length) return;
      set((state) => {
        const nextTiles = mergeSrtmTiles(state.srtmTiles, result.tiles);
        return {
          srtmTiles: nextTiles,
          terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics(nextTiles),
        };
      });
      useCoverageStore.getState().recomputeCoverage();
    };

    const mergeLoadResults = (left: CopernicusLoadResult, right: CopernicusLoadResult): CopernicusLoadResult => ({
      tiles: [...left.tiles, ...right.tiles],
      failedTiles: [...left.failedTiles, ...right.failedTiles],
      fetchedTiles: [...left.fetchedTiles, ...right.fetchedTiles],
      cacheHits: [...left.cacheHits, ...right.cacheHits],
      fallbackTiles: [...left.fallbackTiles, ...right.fallbackTiles],
    });

    const formatStatus = (result: CopernicusLoadResult, sourceLabel: string): string => {
      const parts = [
        `Loaded ${result.tiles.length} tile(s)`,
        result.fetchedTiles.length ? `${result.fetchedTiles.length} fetched` : "",
        result.cacheHits.length ? `${result.cacheHits.length} from cache` : "",
        result.fallbackTiles.length ? `${result.fallbackTiles.length} fallback to Copernicus GLO-90` : "",
        result.failedTiles.length ? `${result.failedTiles.length} failed` : "",
      ].filter(Boolean);
      const missing = result.failedTiles;
      return `${parts.join(", ")} from ${sourceLabel}.${missing.length ? ` Missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}` : ""}`;
    };

    try {
      if (alreadyHasHighRes) {
        if (get().terrainLoadEpoch !== epoch) return;
        set({
          terrainFetchStatus: formatStatus(
            { tiles: [], fetchedTiles: [], cacheHits: [], fallbackTiles: [], failedTiles: [] },
            TERRAIN_DATASET_FETCH_LABEL.copernicus30,
          ),
          isTerrainFetching: false,
          terrainLoadingStartedAtMs: 0,
          terrainProgressPercent: 100,
          terrainProgressTransientDecodeBytesEstimated: 0,
          terrainProgressPhaseLabel: "",
          terrainProgressPhaseIndex: 0,
          terrainProgressPhaseTotal: 0,
        });
        return;
      }

      if (isSmallArea) {
        set({ isHighResTerrainLoaded: false });
        startTerrainPhase("30m small area", requiredTileKeys.size, `Loading terrain (30m, small area) for ${radiusKm} km...`);
        const phased = await loadPhased("copernicus30", coreBounds);
        if (get().terrainLoadEpoch !== epoch) return;
        applyTiles(phased.priority);
        applyTiles(phased.remaining);
        const thirtyResult = mergeLoadResults(phased.priority, phased.remaining);
        set({
          terrainFetchStatus: formatStatus(thirtyResult, TERRAIN_DATASET_FETCH_LABEL.copernicus30),
          isTerrainFetching: false,
          isHighResTerrainLoaded: true,
          terrainLoadingStartedAtMs: 0,
          terrainProgressPercent: 100,
          terrainProgressTransientDecodeBytesEstimated: 0,
          terrainProgressPhaseLabel: "",
          terrainProgressPhaseIndex: 0,
          terrainProgressPhaseTotal: 0,
        });
        return;
      }

      startTerrainPhase("90m broad coverage", requiredTileKeys.size, `Loading terrain (90m, broad coverage) for ${radiusKm} km...`);
      const ninetyPhased = await loadPhased("copernicus90", coreBounds, endpointKeys);
      if (get().terrainLoadEpoch !== epoch) return;
      applyTiles(ninetyPhased.priority);
      applyTiles(ninetyPhased.remaining);
      const ninetyResult = mergeLoadResults(ninetyPhased.priority, ninetyPhased.remaining);

      const currentState = get();
      const currentTileKeys = new Set(currentState.srtmTiles.filter((t) => t.sourceId === "copernicus30").map((t) => t.key));
      const hasHighResNow = [...requiredTileKeys].every((k) => currentTileKeys.has(k));
      if (hasHighResNow) {
        set({
          terrainFetchStatus: formatStatus(ninetyResult, TERRAIN_DATASET_FETCH_LABEL.copernicus90),
          isTerrainFetching: false,
          isHighResTerrainLoaded: true,
          terrainLoadingStartedAtMs: 0,
          terrainProgressPercent: 100,
          terrainProgressTransientDecodeBytesEstimated: 0,
          terrainProgressPhaseLabel: "",
          terrainProgressPhaseIndex: 0,
          terrainProgressPhaseTotal: 0,
        });
        return;
      }

      set({ isHighResTerrainLoaded: false });
      startTerrainPhase(
        "30m high-res refinement",
        requiredTileKeys.size,
        `Loading terrain (30m, high-res refinement) for ${radiusKm} km...`,
      );
      const thirtyPhased = await loadPhased("copernicus30", coreBounds, endpointKeys);
      if (get().terrainLoadEpoch !== epoch) return;
      applyTiles(thirtyPhased.priority);
      applyTiles(thirtyPhased.remaining);
      const thirtyResult = mergeLoadResults(thirtyPhased.priority, thirtyPhased.remaining);

      if (extendedOnlyKeys.size > 0) {
        startTerrainPhase(
          "30m radial extension",
          extendedOnlyKeys.size,
          `Loading terrain (30m, extended radial area) for ${radiusKm} km...`,
        );
        const extendedPhased = await loadPhased("copernicus30", extendedBounds, extendedOnlyKeys, true);
        if (get().terrainLoadEpoch !== epoch) return;
        applyTiles(extendedPhased.priority);
      }
      set({
        terrainFetchStatus: formatStatus(thirtyResult, TERRAIN_DATASET_FETCH_LABEL.copernicus30),
        isTerrainFetching: false,
        isHighResTerrainLoaded: true,
        terrainLoadingStartedAtMs: 0,
        terrainProgressPercent: 100,
        terrainProgressTransientDecodeBytesEstimated: 0,
        terrainProgressPhaseLabel: "",
        terrainProgressPhaseIndex: 0,
        terrainProgressPhaseTotal: 0,
      });
    } catch (error) {
      if (get().terrainLoadEpoch !== epoch) return;
      set({
        terrainFetchStatus: `Terrain fetch failed: ${getUiErrorMessage(error)}`,
        isTerrainFetching: false,
        terrainLoadingStartedAtMs: 0,
        terrainProgressTransientDecodeBytesEstimated: 0,
        terrainProgressPhaseLabel: "",
        terrainProgressPhaseIndex: 0,
        terrainProgressPhaseTotal: 0,
      });
    }
  },
  clearTerrainCache: async () => {
    set({ isTerrainFetching: true, terrainProgressPercent: 0 });
    await clearCopernicusCache();
    clearTerrainLossCache();
    set((state) => {
      const nextTiles = state.srtmTiles.filter((tile) => tile.sourceKind === "manual-upload");
      return {
        srtmTiles: nextTiles,
        terrainMemoryDiagnostics: estimateTerrainMemoryDiagnostics(nextTiles),
        isTerrainFetching: false,
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
        selectedNetwork?.frequencyOverrideMHz ?? selectedNetwork?.frequencyMHz ?? 869.618;
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
