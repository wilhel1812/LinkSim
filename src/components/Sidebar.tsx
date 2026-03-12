import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Map, {
  Layer,
  Marker,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MarkerDragEvent,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import { useSystemTheme } from "../hooks/useSystemTheme";
import { t, LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n/locales";
import { fetchElevations } from "../lib/elevationService";
import { FREQUENCY_PRESETS } from "../lib/frequencyPlans";
import { searchLocations, type GeocodeResult } from "../lib/geocode";
import { LEGACY_ASSETS } from "../lib/legacyAssets";
import {
  fetchCollaboratorDirectory,
  fetchResourceChanges,
  fetchUserById,
  updateUserRole,
  type CollaboratorDirectoryUser,
  type CloudUser,
  type ResourceChange,
} from "../lib/cloudUser";
import {
  fetchMeshmapNodes,
  getCachedMeshmapSnapshotInfo,
  getDefaultMeshmapFeedUrl,
  readPreferredMeshmapSourceUrl,
  savePreferredMeshmapSourceUrl,
  type MeshmapNode,
} from "../lib/meshtasticMqtt";
import { deriveDynamicPropagationEnvironment } from "../lib/propagationEnvironment";
import { analyzeLink } from "../lib/propagation";
import { sampleSrtmElevation } from "../lib/srtm";
import { PRIMARY_ATTRIBUTION, REMOTE_SRTM_ENDPOINTS } from "../lib/terrainCatalog";
import { getUiErrorMessage } from "../lib/uiError";
import { useAppStore } from "../store/appStore";
import type { CoverageMode, PropagationModel, RadioClimate } from "../types/radio";
import { AuthSyncPanel } from "./AuthSyncPanel";
import { InfoTip } from "./InfoTip";
import { ModalOverlay } from "./ModalOverlay";
import { UserAdminPanel } from "./UserAdminPanel";

const metric = (label: string, value: string) => (
  <div className="metric-row" key={label}>
    <span className="metric-label">{label}</span>
    <span className="metric-value">{value}</span>
  </div>
);

const parseNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAccessVisibility = (value: unknown): "private" | "public" | "shared" => {
  if (value === "shared" || value === "public_write") return "shared";
  if (value === "public" || value === "public_read") return "public";
  return "private";
};

const initialsForUser = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const UserBadge = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
  <span className="user-list-row">
    {avatarUrl && avatarUrl.trim() ? (
      <img alt={name} className="profile-avatar" src={avatarUrl} />
    ) : (
      <span className="profile-avatar">{initialsForUser(name)}</span>
    )}
    <span>{name}</span>
  </span>
);

const styleByTheme = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

const RADIO_CLIMATE_OPTIONS: RadioClimate[] = [
  "Equatorial",
  "Continental Subtropical",
  "Maritime Subtropical",
  "Desert",
  "Continental Temperate",
  "Maritime Temperate (Land)",
  "Maritime Temperate (Sea)",
];

const meshmapNodesLayer: LayerProps = {
  id: "meshmap-nodes-layer",
  type: "circle",
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 4, 12, 6],
    "circle-color": "#2bc0ff",
    "circle-opacity": 0.82,
    "circle-stroke-width": 1,
    "circle-stroke-color": "#0a1a24",
  },
};

const meshmapLabelsLayer: LayerProps = {
  id: "meshmap-labels-layer",
  type: "symbol",
  layout: {
    "text-field": ["get", "label"],
    "text-font": ["Open Sans Regular"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 9, 10, 12, 12],
    "text-offset": [0, 1.2],
    "text-anchor": "top",
    "text-allow-overlap": false,
  },
  paint: {
    "text-color": "#e7f1ff",
    "text-halo-color": "rgba(10, 26, 36, 0.95)",
    "text-halo-width": 1.3,
  },
};

const clampSNR = (spreadFactor: number): number => {
  const map: Record<number, number> = {
    7: -7.5,
    8: -10,
    9: -12.5,
    10: -15,
    11: -17.5,
    12: -20,
  };
  return map[spreadFactor] ?? -10;
};

const estimateLoRaSensitivityDbm = (bandwidthKhz: number, spreadFactor: number): number => {
  const bandwidthHz = Math.max(1_000, bandwidthKhz * 1_000);
  const noiseFloor = -174 + 10 * Math.log10(bandwidthHz);
  const noiseFigure = 6;
  const snrLimit = clampSNR(spreadFactor);
  return noiseFloor + noiseFigure + snrLimit;
};

const downloadJson = (fileName: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};
const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";
const SITE_LIBRARY_KEY = "rmw-site-library-v1";
const SIM_PRESETS_KEY = "rmw-sim-presets-v1";
const STORAGE_BOOT_KEY = "rmw-storage-boot-v1";
const STORAGE_HEALTH_KEY = "rmw-storage-health-v1";

type LibraryBackupPayload = {
  schemaVersion: 1;
  exportedAtIso: string;
  origin: string;
  siteLibrary?: unknown[];
  simulationPresets?: unknown[];
};

type StorageHealth = {
  lastExportIso?: string;
  lastImportIso?: string;
  lastRestoreIso?: string;
};

const readStorageHealth = (): StorageHealth => {
  try {
    const raw = localStorage.getItem(STORAGE_HEALTH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StorageHealth;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeStorageHealth = (value: StorageHealth) => {
  try {
    localStorage.setItem(STORAGE_HEALTH_KEY, JSON.stringify(value));
  } catch {
    // Best effort only.
  }
};

const formatChangeSummary = (action: string, note: string | null): string => {
  if (note && note.trim()) return note;
  if (action === "created") return "Created record.";
  if (action === "updated") return "Updated record.";
  return "Change recorded.";
};

const getSnapshotCount = (key: string): number => {
  try {
    const raw = localStorage.getItem(`${key}-snapshots-v1`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
};

export function Sidebar() {
  const theme = useSystemTheme();
  const links = useAppStore((state) => state.links);
  const sites = useAppStore((state) => state.sites);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const selectedCoverageMode = useAppStore((state) => state.selectedCoverageMode);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const propagationEnvironmentReason = useAppStore((state) => state.propagationEnvironmentReason);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const scenarioOptions = useAppStore((state) => state.scenarioOptions);
  const locale = useAppStore((state) => state.locale);
  const networks = useAppStore((state) => state.networks);
  const setLocale = useAppStore((state) => state.setLocale);
  const selectScenario = useAppStore((state) => state.selectScenario);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const setSelectedSiteId = useAppStore((state) => state.setSelectedSiteId);
  const setSelectedNetworkId = useAppStore((state) => state.setSelectedNetworkId);
  const setSelectedCoverageMode = useAppStore((state) => state.setSelectedCoverageMode);
  const setSelectedFrequencyPresetId = useAppStore((state) => state.setSelectedFrequencyPresetId);
  const setRxSensitivityTargetDbm = useAppStore((state) => state.setRxSensitivityTargetDbm);
  const setEnvironmentLossDb = useAppStore((state) => state.setEnvironmentLossDb);
  const setAutoPropagationEnvironment = useAppStore((state) => state.setAutoPropagationEnvironment);
  const setPropagationEnvironment = useAppStore((state) => state.setPropagationEnvironment);
  const applyClimateDefaults = useAppStore((state) => state.applyClimateDefaults);
  const pendingSiteLibraryDraft = useAppStore((state) => state.pendingSiteLibraryDraft);
  const clearPendingSiteLibraryDraft = useAppStore((state) => state.clearPendingSiteLibraryDraft);
  const applyFrequencyPresetToSelectedNetwork = useAppStore(
    (state) => state.applyFrequencyPresetToSelectedNetwork,
  );
  const setPropagationModel = useAppStore((state) => state.setPropagationModel);
  const updateLink = useAppStore((state) => state.updateLink);
  const ingestSrtmFiles = useAppStore((state) => state.ingestSrtmFiles);
  const syncSiteElevationsOnline = useAppStore((state) => state.syncSiteElevationsOnline);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const terrainFetchStatus = useAppStore((state) => state.terrainFetchStatus);
  const terrainRecommendation = useAppStore((state) => state.terrainRecommendation);
  const setTerrainDataset = useAppStore((state) => state.setTerrainDataset);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const insertSitesFromLibrary = useAppStore((state) => state.insertSitesFromLibrary);
  const updateSiteLibraryEntry = useAppStore((state) => state.updateSiteLibraryEntry);
  const deleteSiteLibraryEntry = useAppStore((state) => state.deleteSiteLibraryEntry);
  const deleteSiteLibraryEntries = useAppStore((state) => state.deleteSiteLibraryEntries);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const createLink = useAppStore((state) => state.createLink);
  const deleteLink = useAppStore((state) => state.deleteLink);
  const addSiteLibraryEntry = useAppStore((state) => state.addSiteLibraryEntry);
  const saveCurrentSimulationPreset = useAppStore((state) => state.saveCurrentSimulationPreset);
  const overwriteSimulationPreset = useAppStore((state) => state.overwriteSimulationPreset);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const renameSimulationPreset = useAppStore((state) => state.renameSimulationPreset);
  const updateSimulationPresetEntry = useAppStore((state) => state.updateSimulationPresetEntry);
  const deleteSimulationPreset = useAppStore((state) => state.deleteSimulationPreset);
  const importLibraryData = useAppStore((state) => state.importLibraryData);
  const restoreLibrariesFromSnapshots = useAppStore((state) => state.restoreLibrariesFromSnapshots);
  const recommendTerrainDatasetForCurrentArea = useAppStore(
    (state) => state.recommendTerrainDatasetForCurrentArea,
  );
  const fetchTerrainForCurrentArea = useAppStore((state) => state.fetchTerrainForCurrentArea);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const clearTerrainCache = useAppStore((state) => state.clearTerrainCache);
  const getSelectedAnalysis = useAppStore((state) => state.getSelectedAnalysis);
  const getSelectedLink = useAppStore((state) => state.getSelectedLink);
  const getSelectedSite = useAppStore((state) => state.getSelectedSite);
  const getSelectedNetwork = useAppStore((state) => state.getSelectedNetwork);
  const model = useAppStore((state) => state.propagationModel);
  const analysis = getSelectedAnalysis();
  const selectedLink = getSelectedLink();
  const selectedSite = getSelectedSite();
  const selectedNetwork = getSelectedNetwork();
  const effectiveNetworkFrequencyMHz = selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz;
  const selectedFrequencyPreset = FREQUENCY_PRESETS.find((preset) => preset.id === selectedFrequencyPresetId);
  const isLoraEstimateRelevant = (selectedFrequencyPreset?.source ?? "Meshtastic") !== "RadioMobile";
  const fromSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const toSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const sourceSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const destinationSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const adjustedRxDbm = analysis.rxLevelDbm - environmentLossDb;
  const linkMarginDb = adjustedRxDbm - rxSensitivityTargetDbm;
  const loraSensitivitySuggestionDbm = estimateLoRaSensitivityDbm(
    selectedNetwork.bandwidthKhz,
    selectedNetwork.spreadFactor,
  );
  const effectivePropagationEnvironment = useMemo(() => {
    if (!autoPropagationEnvironment || !fromSite || !toSite) return propagationEnvironment;
    return deriveDynamicPropagationEnvironment({
      from: fromSite.position,
      to: toSite.position,
      fromGroundM: fromSite.groundElevationM,
      toGroundM: toSite.groundElevationM,
      terrainSampler: ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
    }).environment;
  }, [autoPropagationEnvironment, fromSite, toSite, propagationEnvironment, srtmTiles]);

  const runWhatIf = (
    txPowerDeltaDbm = 0,
    freqScale = 1,
    antennaDeltaM = 0,
  ): number | null => {
    if (!sourceSite || !destinationSite) return null;
    const alt = analyzeLink(
      {
        ...selectedLink,
        txPowerDbm: selectedLink.txPowerDbm + txPowerDeltaDbm,
        frequencyMHz: effectiveNetworkFrequencyMHz * freqScale,
      },
      { ...sourceSite, antennaHeightM: sourceSite.antennaHeightM + antennaDeltaM },
      { ...destinationSite, antennaHeightM: destinationSite.antennaHeightM + antennaDeltaM },
      model,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      { environment: effectivePropagationEnvironment },
    );
    return alt.rxLevelDbm - environmentLossDb;
  };

  const whatIfRows = [
    { label: "Current", rxDbm: adjustedRxDbm },
    { label: "+3 dB TX", rxDbm: runWhatIf(3, 1, 0) },
    { label: "+6 dB TX", rxDbm: runWhatIf(6, 1, 0) },
    { label: "+10 m antennas", rxDbm: runWhatIf(0, 1, 10) },
    { label: "Freq -10%", rxDbm: runWhatIf(0, 0.9, 0) },
    { label: "Freq +10%", rxDbm: runWhatIf(0, 1.1, 0) },
  ].map((row) => ({
    ...row,
    marginDb: row.rxDbm === null ? null : row.rxDbm - rxSensitivityTargetDbm,
  }));
  const hasNonAutoLinks = useMemo(
    () => links.some((link) => (link.name ?? "").trim().toLowerCase() !== "auto link"),
    [links],
  );
  const visibleLinks = useMemo(
    () =>
      hasNonAutoLinks
        ? links.filter((link) => (link.name ?? "").trim().toLowerCase() !== "auto link")
        : links,
    [hasNonAutoLinks, links],
  );
  const [newPresetName, setNewPresetName] = useState("");
  const [simulationSaveStatus, setSimulationSaveStatus] = useState("");
  const [showSimulationLibraryManager, setShowSimulationLibraryManager] = useState(false);
  const [simulationLibraryQuery, setSimulationLibraryQuery] = useState("");
  const [editingSimulationId, setEditingSimulationId] = useState<string | null>(null);
  const [editingSimulationName, setEditingSimulationName] = useState("");
  const [linkModal, setLinkModal] = useState<{
    mode: "add" | "edit";
    linkId: string | null;
    name: string;
    fromSiteId: string;
    toSiteId: string;
    txPowerDbm: number;
    txGainDbi: number;
    rxGainDbi: number;
    cableLossDb: number;
    status: string;
  } | null>(null);
  const [showSiteLibraryManager, setShowSiteLibraryManager] = useState(false);
  const [siteLibraryQuery, setSiteLibraryQuery] = useState("");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [editingLibraryName, setEditingLibraryName] = useState("");
  const [editingLibraryLat, setEditingLibraryLat] = useState(0);
  const [editingLibraryLon, setEditingLibraryLon] = useState(0);
  const [editingLibraryGroundM, setEditingLibraryGroundM] = useState(0);
  const [editingLibraryAntennaM, setEditingLibraryAntennaM] = useState(2);
  const [editingLibraryStatus, setEditingLibraryStatus] = useState("");
  const [showAddLibraryForm, setShowAddLibraryForm] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryLat, setNewLibraryLat] = useState(60.0);
  const [newLibraryLon, setNewLibraryLon] = useState(10.0);
  const [newLibraryGroundM, setNewLibraryGroundM] = useState(0);
  const [newLibraryAntennaM, setNewLibraryAntennaM] = useState(2);
  const [librarySearchQuery, setLibrarySearchQuery] = useState("");
  const [librarySearchStatus, setLibrarySearchStatus] = useState("");
  const [librarySearchResults, setLibrarySearchResults] = useState<GeocodeResult[]>([]);
  const [librarySearchPickBusyId, setLibrarySearchPickBusyId] = useState<string | null>(null);
  const [showMeshtasticBrowser, setShowMeshtasticBrowser] = useState(false);
  const [meshmapNodes, setMeshmapNodes] = useState<MeshmapNode[]>([]);
  const [meshmapSourceUrl, setMeshmapSourceUrl] = useState(readPreferredMeshmapSourceUrl);
  const [meshmapCachedSummary, setMeshmapCachedSummary] = useState(() => getCachedMeshmapSnapshotInfo());
  const [meshmapStatus, setMeshmapStatus] = useState("");
  const [meshmapLoading, setMeshmapLoading] = useState(false);
  const [meshmapSelectedNodeId, setMeshmapSelectedNodeId] = useState<string | null>(null);
  const [meshmapView, setMeshmapView] = useState(() => ({
    longitude: sourceSite?.position.lon ?? 10.75,
    latitude: sourceSite?.position.lat ?? 59.9,
    zoom: 7.5,
  }));
  const [selectedSimulationRef, setSelectedSimulationRef] = useState<string>(() => {
    const fallback = `builtin:${selectedScenarioId}`;
    try {
      const stored = localStorage.getItem(LAST_SIMULATION_REF_KEY);
      return stored && stored.trim() ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const [startupSimulationApplied, setStartupSimulationApplied] = useState(false);
  const [storageImportMode, setStorageImportMode] = useState<"merge" | "replace">("merge");
  const [storageStatus, setStorageStatus] = useState("");
  const [storageHealth, setStorageHealth] = useState<StorageHealth>(() => readStorageHealth());
  const [profilePopupUser, setProfilePopupUser] = useState<CloudUser | null>(null);
  const [profilePopupBusy, setProfilePopupBusy] = useState(false);
  const [profilePopupStatus, setProfilePopupStatus] = useState("");
  const [changeLogPopup, setChangeLogPopup] = useState<{
    kind: "site" | "simulation";
    resourceId: string;
    label: string;
    changes: ResourceChange[];
    busy: boolean;
    status: string;
  } | null>(null);
  const [resourceDetailsPopup, setResourceDetailsPopup] = useState<{
    kind: "site" | "simulation";
    resourceId: string;
    label: string;
    createdByUserId: string | null;
    createdByName: string;
    createdByAvatarUrl: string;
    lastEditedByUserId: string | null;
    lastEditedByName: string;
    lastEditedByAvatarUrl: string;
  } | null>(null);
  const [resourceAccessVisibility, setResourceAccessVisibility] = useState<"private" | "public" | "shared">("shared");
  const [resourceCollaboratorUserIds, setResourceCollaboratorUserIds] = useState<string[]>([]);
  const [resourceCollaboratorQuery, setResourceCollaboratorQuery] = useState("");
  const [resourceCollaboratorDirectory, setResourceCollaboratorDirectory] = useState<CollaboratorDirectoryUser[]>([]);
  const [resourceCollaboratorDirectoryBusy, setResourceCollaboratorDirectoryBusy] = useState(false);
  const [resourceCollaboratorDirectoryStatus, setResourceCollaboratorDirectoryStatus] = useState("");
  const [resourceAccessStatus, setResourceAccessStatus] = useState("");
  const [storageOriginWarning, setStorageOriginWarning] = useState("");
  const [storageSnapshotInfo, setStorageSnapshotInfo] = useState(() => ({
    siteSnapshots: getSnapshotCount(SITE_LIBRARY_KEY),
    simulationSnapshots: getSnapshotCount(SIM_PRESETS_KEY),
  }));
  const hasLocalLibraryData = siteLibrary.length > 0 || simulationPresets.length > 0;
  const filteredSiteLibrary = useMemo(() => {
    const q = siteLibraryQuery.trim().toLowerCase();
    if (!q) return siteLibrary;
    return siteLibrary.filter((entry) => {
      const hay = `${entry.name} ${entry.position.lat.toFixed(5)} ${entry.position.lon.toFixed(5)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [siteLibrary, siteLibraryQuery]);
  const newestSiteLibraryEntryId = useMemo(() => {
    if (!siteLibrary.length) return "";
    const parseTs = (value: string): number => {
      const ts = Date.parse(value);
      return Number.isFinite(ts) ? ts : 0;
    };
    return siteLibrary
      .slice()
      .sort((a, b) => parseTs(b.createdAt) - parseTs(a.createdAt))[0]?.id ?? siteLibrary[0].id;
  }, [siteLibrary]);
  const filteredSimulationPresets = useMemo(() => {
    const q = simulationLibraryQuery.trim().toLowerCase();
    if (!q) return simulationPresets;
    return simulationPresets.filter((preset) => {
      const hay = `${preset.name} ${preset.updatedAt}`.toLowerCase();
      return hay.includes(q);
    });
  }, [simulationPresets, simulationLibraryQuery]);
  const filteredBuiltinScenarios = useMemo(() => {
    const q = simulationLibraryQuery.trim().toLowerCase();
    if (!q) return scenarioOptions;
    return scenarioOptions.filter((scenario) => scenario.name.toLowerCase().includes(q));
  }, [scenarioOptions, simulationLibraryQuery]);
  const activeSimulationLabel = useMemo(() => {
    if (selectedSimulationRef.startsWith("saved:")) {
      const presetId = selectedSimulationRef.replace("saved:", "");
      const preset = simulationPresets.find((candidate) => candidate.id === presetId);
      return preset ? `${preset.name} (saved)` : "Saved simulation";
    }
    const scenarioId = selectedSimulationRef.replace("builtin:", "");
    const scenario = scenarioOptions.find((candidate) => candidate.id === scenarioId);
    return scenario ? `${scenario.name} (built-in)` : "Built-in simulation";
  }, [selectedSimulationRef, simulationPresets, scenarioOptions]);
  const collaboratorDirectoryById = useMemo(
    () => new globalThis.Map(resourceCollaboratorDirectory.map((user) => [user.id, user])),
    [resourceCollaboratorDirectory],
  );
  const selectedCollaboratorUsers = useMemo(
    () =>
      resourceCollaboratorUserIds.map((userId) => {
        const user = collaboratorDirectoryById.get(userId);
        return {
          id: userId,
          username: user?.username ?? userId,
          email: user?.email ?? "",
          avatarUrl: user?.avatarUrl ?? "",
        };
      }),
    [collaboratorDirectoryById, resourceCollaboratorUserIds],
  );
  const collaboratorCandidates = useMemo(() => {
    const q = resourceCollaboratorQuery.trim().toLowerCase();
    const selectedIds = new Set(resourceCollaboratorUserIds);
    const filtered = resourceCollaboratorDirectory.filter((user) => {
      if (selectedIds.has(user.id)) return false;
      if (!q) return true;
      const hay = `${user.username} ${user.email}`.toLowerCase();
      return hay.includes(q);
    });
    return filtered.slice(0, 30);
  }, [resourceCollaboratorDirectory, resourceCollaboratorUserIds, resourceCollaboratorQuery]);
  const lastStorageActionLabel = useMemo(() => {
    const entries = [
      storageHealth.lastExportIso ? `Export ${new Date(storageHealth.lastExportIso).toLocaleString()}` : null,
      storageHealth.lastImportIso ? `Import ${new Date(storageHealth.lastImportIso).toLocaleString()}` : null,
      storageHealth.lastRestoreIso ? `Restore ${new Date(storageHealth.lastRestoreIso).toLocaleString()}` : null,
    ].filter((entry): entry is string => Boolean(entry));
    return entries.length ? entries.join(" | ") : "No backup/import/restore actions recorded yet.";
  }, [storageHealth]);
  useEffect(() => {
    if (selectedSimulationRef.startsWith("saved:")) {
      const presetId = selectedSimulationRef.replace("saved:", "");
      const exists = simulationPresets.some((preset) => preset.id === presetId);
      if (!exists) {
        const fallback = `builtin:${selectedScenarioId}`;
        setSelectedSimulationRef(fallback);
        try {
          localStorage.setItem(LAST_SIMULATION_REF_KEY, fallback);
        } catch {
          // ignore
        }
      }
    }
  }, [selectedSimulationRef, simulationPresets, selectedScenarioId]);
  useEffect(() => {
    if (!visibleLinks.length) return;
    const stillVisible = visibleLinks.some((link) => link.id === selectedLinkId);
    if (stillVisible) return;
    setSelectedLinkId(visibleLinks[0].id);
  }, [selectedLinkId, setSelectedLinkId, visibleLinks]);
  useEffect(() => {
    if (!resourceDetailsPopup) return;
    let canceled = false;
    setResourceCollaboratorDirectoryBusy(true);
    setResourceCollaboratorDirectoryStatus("");
    void fetchCollaboratorDirectory()
      .then((users) => {
        if (canceled) return;
        setResourceCollaboratorDirectory(users);
      })
      .catch((error) => {
        if (canceled) return;
        const message = getUiErrorMessage(error);
        setResourceCollaboratorDirectoryStatus(`Collaborator lookup unavailable: ${message}`);
      })
      .finally(() => {
        if (canceled) return;
        setResourceCollaboratorDirectoryBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, [resourceDetailsPopup]);
  const meshmapNodesInView = useMemo(() => {
    const lonSpan = Math.max(0.12, 360 / Math.pow(2, meshmapView.zoom) * 2.2);
    const latSpan = Math.max(0.12, 170 / Math.pow(2, meshmapView.zoom) * 1.8);
    const minLon = meshmapView.longitude - lonSpan / 2;
    const maxLon = meshmapView.longitude + lonSpan / 2;
    const minLat = meshmapView.latitude - latSpan / 2;
    const maxLat = meshmapView.latitude + latSpan / 2;
    const inView = meshmapNodes.filter(
      (node) => node.lon >= minLon && node.lon <= maxLon && node.lat >= minLat && node.lat <= maxLat,
    );
    return inView.slice(0, 4500);
  }, [meshmapNodes, meshmapView]);
  const meshmapNodesGeoJson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: meshmapNodesInView.map((node) => ({
        type: "Feature" as const,
        properties: {
          nodeId: node.nodeId,
          longName: node.longName ?? "",
          shortName: node.shortName ?? "",
          label: node.longName ?? node.nodeId,
          hwModel: node.hwModel ?? "",
          lastSeenUnix: node.lastSeenUnix ?? 0,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [node.lon, node.lat],
        },
      })),
    }),
    [meshmapNodesInView],
  );
  const selectedMeshmapNode =
    meshmapSelectedNodeId === null
      ? null
      : meshmapNodes.find((node) => node.nodeId === meshmapSelectedNodeId) ?? null;

  useEffect(() => {
    if (!pendingSiteLibraryDraft) return;
    setShowSiteLibraryManager(true);
    setShowAddLibraryForm(true);
    setNewLibraryName("");
    setNewLibraryLat(pendingSiteLibraryDraft.lat);
    setNewLibraryLon(pendingSiteLibraryDraft.lon);
    const terrainElev = Number(
      sampleSrtmElevation(srtmTiles, pendingSiteLibraryDraft.lat, pendingSiteLibraryDraft.lon),
    );
    if (Number.isFinite(terrainElev)) {
      setNewLibraryGroundM(Math.round(terrainElev));
      setLibrarySearchStatus(
        `Draft from map click at ${pendingSiteLibraryDraft.lat.toFixed(5)}, ${pendingSiteLibraryDraft.lon.toFixed(5)} (terrain ${Math.round(terrainElev)} m)`,
      );
    } else {
      setLibrarySearchStatus(
        `Draft from map click at ${pendingSiteLibraryDraft.lat.toFixed(5)}, ${pendingSiteLibraryDraft.lon.toFixed(5)}.`,
      );
    }
    clearPendingSiteLibraryDraft();
  }, [pendingSiteLibraryDraft, srtmTiles, clearPendingSiteLibraryDraft]);

  const onModelChange = (next: PropagationModel) => {
    setPropagationModel(next);
  };

  const onCoverageModeChange = (mode: CoverageMode) => {
    setSelectedCoverageMode(mode);
  };

  const onUploadTiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    await ingestSrtmFiles(event.target.files);
    event.target.value = "";
  };

  const exportManifest = () => {
    const terrainSources = srtmTiles.reduce<Record<string, number>>((acc, tile) => {
      const key = tile.sourceLabel ?? "Unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

      const manifest = {
      exportedAt: new Date().toISOString(),
      scenarioId: selectedScenarioId,
      locale,
      propagationModel: model,
      selectedCoverageMode,
      selectedFrequencyPresetId,
      terrainDataset,
      terrainRecommendation,
      terrainFetchStatus,
      sites,
      links,
      systems: useAppStore.getState().systems,
      networks,
      selectedLinkId,
      selectedNetworkId,
      selectedSiteId,
      rxSensitivityTargetDbm,
      environmentLossDb,
      autoPropagationEnvironment,
      propagationEnvironment: effectivePropagationEnvironment,
      propagationEnvironmentReason,
      hasOnlineElevationSync: useAppStore.getState().hasOnlineElevationSync,
      terrainTileCount: srtmTiles.length,
      terrainSources,
      selectedAnalysis: analysis,
      linkBudget: {
        targetSensitivityDbm: rxSensitivityTargetDbm,
        adjustedRxDbm,
        marginDb: linkMarginDb,
        whatIfRows,
      },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJson(`linksim-manifest-${stamp}.json`, manifest);
  };

  const loadSimulationRef = (ref: string) => {
    setSelectedSimulationRef(ref);
    try {
      localStorage.setItem(LAST_SIMULATION_REF_KEY, ref);
    } catch {
      // ignore
    }
    setSimulationSaveStatus("");
    if (ref.startsWith("builtin:")) {
      selectScenario(ref.replace("builtin:", ""));
      return;
    }
    if (ref.startsWith("saved:")) {
      loadSimulationPreset(ref.replace("saved:", ""));
    }
  };
  useEffect(() => {
    if (startupSimulationApplied) return;
    const defaultRef = `builtin:${selectedScenarioId}`;
    if (selectedSimulationRef !== defaultRef) {
      if (selectedSimulationRef.startsWith("builtin:")) {
        selectScenario(selectedSimulationRef.replace("builtin:", ""));
      } else if (selectedSimulationRef.startsWith("saved:")) {
        loadSimulationPreset(selectedSimulationRef.replace("saved:", ""));
      }
    }
    setStartupSimulationApplied(true);
  }, [startupSimulationApplied, selectedSimulationRef, selectedScenarioId, selectScenario, loadSimulationPreset]);

  useEffect(() => {
    const origin = window.location.origin;
    const host = window.location.hostname;
    setStorageOriginWarning(
      host === "127.0.0.1"
        ? "You are on 127.0.0.1. Browser storage is origin-scoped; localhost and 127.0.0.1 do not share data."
        : "",
    );
    try {
      const booted = localStorage.getItem(STORAGE_BOOT_KEY);
      if (!booted) {
        localStorage.setItem(STORAGE_BOOT_KEY, JSON.stringify({ firstSeenIso: new Date().toISOString(), origin }));
        if (!hasLocalLibraryData) {
          setStorageStatus(
            "No local library data found yet in this browser origin. Export backups regularly to avoid surprises.",
          );
        }
      }
    } catch {
      // ignore
    }
  }, [hasLocalLibraryData]);

  useEffect(() => {
    refreshSnapshotInfo();
  }, [siteLibrary, simulationPresets]);

  const refreshSnapshotInfo = () => {
    setStorageSnapshotInfo({
      siteSnapshots: getSnapshotCount(SITE_LIBRARY_KEY),
      simulationSnapshots: getSnapshotCount(SIM_PRESETS_KEY),
    });
  };

  const exportLocalLibraries = () => {
    const payload: LibraryBackupPayload = {
      schemaVersion: 1,
      exportedAtIso: new Date().toISOString(),
      origin: window.location.origin,
      siteLibrary,
      simulationPresets,
    };
    const stamp = payload.exportedAtIso.replace(/[:.]/g, "-");
    downloadJson(`linksim-backup-${stamp}.json`, payload);
    const nextHealth = { ...storageHealth, lastExportIso: payload.exportedAtIso };
    setStorageHealth(nextHealth);
    writeStorageHealth(nextHealth);
    setStorageStatus(
      `Exported backup (${siteLibrary.length} site(s), ${simulationPresets.length} simulation(s)) for ${payload.origin}.`,
    );
  };

  const importLocalLibraries = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (storageImportMode === "replace") {
      const confirmed = window.confirm(
        "Replace mode will overwrite current local site/simulation libraries with imported data. Continue?",
      );
      if (!confirmed) {
        event.target.value = "";
        setStorageStatus("Import cancelled.");
        return;
      }
    }
    setStorageStatus("Importing backup...");
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as LibraryBackupPayload | Record<string, unknown>;
      const siteItems = Array.isArray((parsed as LibraryBackupPayload).siteLibrary)
        ? ((parsed as LibraryBackupPayload).siteLibrary as unknown[])
        : [];
      const simulationItems = Array.isArray((parsed as LibraryBackupPayload).simulationPresets)
        ? ((parsed as LibraryBackupPayload).simulationPresets as unknown[])
        : [];
      const result = importLibraryData(
        {
          siteLibrary: siteItems as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: simulationItems as Parameters<typeof importLibraryData>[0]["simulationPresets"],
        },
        storageImportMode,
      );
      refreshSnapshotInfo();
      const now = new Date().toISOString();
      const nextHealth = { ...storageHealth, lastImportIso: now };
      setStorageHealth(nextHealth);
      writeStorageHealth(nextHealth);
      setStorageStatus(
        `Import complete (${storageImportMode}): ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStorageStatus(`Import failed: ${message}`);
    } finally {
      event.target.value = "";
    }
  };

  const restoreLocalLibraries = () => {
    const confirmed = window.confirm(
      "Restore latest snapshot for local site/simulation libraries? This can overwrite recent unsaved local edits.",
    );
    if (!confirmed) {
      setStorageStatus("Restore cancelled.");
      return;
    }
    const result = restoreLibrariesFromSnapshots();
    refreshSnapshotInfo();
    if (!result.restored) {
      setStorageStatus("No snapshots available to restore.");
      return;
    }
    const now = new Date().toISOString();
    const nextHealth = { ...storageHealth, lastRestoreIso: now };
    setStorageHealth(nextHealth);
    writeStorageHealth(nextHealth);
    setStorageStatus(
      `Restored from snapshots: ${result.siteCount} site(s), ${result.simulationCount} simulation(s).`,
    );
  };

  const openAddLinkModal = () => {
    const fallbackFrom = selectedLink.fromSiteId || sites[0]?.id || "";
    const fallbackTo =
      selectedLink.toSiteId ||
      sites.find((site) => site.id !== fallbackFrom)?.id ||
      "";
    setLinkModal({
      mode: "add",
      linkId: null,
      name: "",
      fromSiteId: fallbackFrom,
      toSiteId: fallbackTo,
      txPowerDbm: selectedLink.txPowerDbm,
      txGainDbi: selectedLink.txGainDbi,
      rxGainDbi: selectedLink.rxGainDbi,
      cableLossDb: selectedLink.cableLossDb,
      status: "",
    });
  };

  const openEditLinkModal = () => {
    setLinkModal({
      mode: "edit",
      linkId: selectedLink.id,
      name: selectedLink.name ?? "",
      fromSiteId: selectedLink.fromSiteId,
      toSiteId: selectedLink.toSiteId,
      txPowerDbm: selectedLink.txPowerDbm,
      txGainDbi: selectedLink.txGainDbi,
      rxGainDbi: selectedLink.rxGainDbi,
      cableLossDb: selectedLink.cableLossDb,
      status: "",
    });
  };

  const saveLinkModal = () => {
    if (!linkModal) return;
    if (!linkModal.fromSiteId || !linkModal.toSiteId) {
      setLinkModal((current) => (current ? { ...current, status: "Select both From and To sites." } : current));
      return;
    }
    if (linkModal.fromSiteId === linkModal.toSiteId) {
      setLinkModal((current) => (current ? { ...current, status: "From and To must be different sites." } : current));
      return;
    }
    if (linkModal.mode === "add") {
      createLink(linkModal.fromSiteId, linkModal.toSiteId, linkModal.name);
      const createdId = useAppStore.getState().selectedLinkId;
      if (createdId) {
        updateLink(createdId, {
          name: linkModal.name.trim() || undefined,
          fromSiteId: linkModal.fromSiteId,
          toSiteId: linkModal.toSiteId,
          txPowerDbm: linkModal.txPowerDbm,
          txGainDbi: linkModal.txGainDbi,
          rxGainDbi: linkModal.rxGainDbi,
          cableLossDb: linkModal.cableLossDb,
        });
      }
      setLinkModal(null);
      return;
    }
    if (!linkModal.linkId) return;
    updateLink(linkModal.linkId, {
      name: linkModal.name.trim() || undefined,
      fromSiteId: linkModal.fromSiteId,
      toSiteId: linkModal.toSiteId,
      txPowerDbm: linkModal.txPowerDbm,
      txGainDbi: linkModal.txGainDbi,
      rxGainDbi: linkModal.rxGainDbi,
      cableLossDb: linkModal.cableLossDb,
    });
    setLinkModal(null);
  };
  const saveSimulationAsNew = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      if (selectedSimulationRef.startsWith("saved:")) {
        const presetId = selectedSimulationRef.replace("saved:", "");
        overwriteSimulationPreset(presetId);
        setSimulationSaveStatus("Saved changes to current simulation.");
        return;
      }
      setSimulationSaveStatus("Enter a simulation name to save a new simulation.");
      return;
    }
    const savedId = saveCurrentSimulationPreset(trimmed);
    if (savedId) {
      const ref = `saved:${savedId}`;
      setSelectedSimulationRef(ref);
      try {
        localStorage.setItem(LAST_SIMULATION_REF_KEY, ref);
      } catch {
        // ignore
      }
      setSimulationSaveStatus(`Saved simulation: ${trimmed}`);
    }
    setNewPresetName("");
  };
  const startSimulationRename = (presetId: string, name: string) => {
    setEditingSimulationId(presetId);
    setEditingSimulationName(name);
  };
  const saveSimulationRename = () => {
    if (!editingSimulationId) return;
    renameSimulationPreset(editingSimulationId, editingSimulationName);
    setEditingSimulationId(null);
    setEditingSimulationName("");
  };
  const displayLinkName = (linkId: string, linkName?: string) => {
    const trimmedName = linkName?.trim();
    if (trimmedName) return trimmedName;
    const link = links.find((candidate) => candidate.id === linkId);
    if (!link) return linkId;
    const from = sites.find((site) => site.id === link.fromSiteId)?.name ?? "Unknown";
    const to = sites.find((site) => site.id === link.toSiteId)?.name ?? "Unknown";
    return `${from} -> ${to}`;
  };
  const toggleLibrarySelection = (entryId: string) => {
    setSelectedLibraryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };
  const selectedLibraryCount = selectedLibraryIds.size;
  const startLibraryEdit = (entryId: string) => {
    const entry = siteLibrary.find((candidate) => candidate.id === entryId);
    if (!entry) return;
    setEditingLibraryId(entry.id);
    setEditingLibraryName(entry.name);
    setEditingLibraryLat(entry.position.lat);
    setEditingLibraryLon(entry.position.lon);
    setEditingLibraryGroundM(entry.groundElevationM);
    setEditingLibraryAntennaM(entry.antennaHeightM);
    setEditingLibraryStatus("");
  };
  const openLibraryForSelectedSite = () => {
    setShowSiteLibraryManager(true);
    const matchedEntry = siteLibrary.find(
      (entry) =>
        entry.name === selectedSite.name &&
        Math.abs(entry.position.lat - selectedSite.position.lat) < 0.000001 &&
        Math.abs(entry.position.lon - selectedSite.position.lon) < 0.000001,
    );
    if (matchedEntry) {
      startLibraryEdit(matchedEntry.id);
      return;
    }
    setEditingLibraryId(null);
    setShowAddLibraryForm(true);
    setNewLibraryName(selectedSite.name);
    setNewLibraryLat(selectedSite.position.lat);
    setNewLibraryLon(selectedSite.position.lon);
    setNewLibraryGroundM(selectedSite.groundElevationM);
    setNewLibraryAntennaM(selectedSite.antennaHeightM);
    setLibrarySearchStatus("Selected site is not in Site Library yet. Save to create a library entry.");
  };
  const saveLibraryEdit = () => {
    if (!editingLibraryId) return;
    updateSiteLibraryEntry(editingLibraryId, {
      name: editingLibraryName.trim() || "Unnamed Site",
      position: { lat: editingLibraryLat, lon: editingLibraryLon },
      groundElevationM: editingLibraryGroundM,
      antennaHeightM: editingLibraryAntennaM,
    });
    setEditingLibraryId(null);
  };
  const addLibraryEntryNow = () => {
    addSiteLibraryEntry(
      newLibraryName,
      newLibraryLat,
      newLibraryLon,
      newLibraryGroundM,
      newLibraryAntennaM,
    );
    setNewLibraryName("");
    setShowAddLibraryForm(false);
  };
  const fetchGroundFromLoadedTerrain = (lat: number, lon: number): number | null => {
    const elevation = Number(sampleSrtmElevation(srtmTiles, lat, lon));
    if (!Number.isFinite(elevation)) return null;
    return Math.round(elevation);
  };
  const fetchNewLibraryGroundFromTerrain = () => {
    const elevation = fetchGroundFromLoadedTerrain(newLibraryLat, newLibraryLon);
    if (elevation === null) {
      setLibrarySearchStatus("No loaded terrain value at these coordinates. Fetch terrain data for this area first.");
      return;
    }
    setNewLibraryGroundM(elevation);
    setLibrarySearchStatus(`Ground elevation set from loaded terrain: ${elevation} m`);
  };
  const fetchEditingLibraryGroundFromTerrain = () => {
    const elevation = fetchGroundFromLoadedTerrain(editingLibraryLat, editingLibraryLon);
    if (elevation === null) {
      setEditingLibraryStatus("No loaded terrain value at these coordinates. Fetch terrain data for this area first.");
      return;
    }
    setEditingLibraryGroundM(elevation);
    setEditingLibraryStatus(`Ground elevation set from loaded terrain: ${elevation} m`);
  };
  const runLibrarySearch = async () => {
    setLibrarySearchStatus("Searching...");
    try {
      const results = await searchLocations(librarySearchQuery);
      setLibrarySearchResults(results);
      setLibrarySearchStatus(results.length ? `Found ${results.length} result(s)` : "No results");
    } catch (error) {
      const message = getUiErrorMessage(error);
      setLibrarySearchStatus(`Search failed: ${message}`);
    }
  };
  const selectLibrarySearchResult = async (result: GeocodeResult) => {
    setLibrarySearchPickBusyId(result.id);
    setLibrarySearchStatus("Resolving elevation for selected result...");
    setNewLibraryName(result.label.split(",")[0] ?? "New Site");
    setNewLibraryLat(result.lat);
    setNewLibraryLon(result.lon);
    try {
      const [elevation] = await fetchElevations([{ lat: result.lat, lon: result.lon }]);
      if (Number.isFinite(elevation)) {
        setNewLibraryGroundM(Math.round(elevation));
        setLibrarySearchStatus(`Selected: ${result.label} (elevation ${Math.round(elevation)} m)`);
      } else {
        setLibrarySearchStatus(`Selected: ${result.label} (elevation unavailable)`);
      }
    } catch (error) {
      const message = getUiErrorMessage(error);
      setLibrarySearchStatus(`Selected coordinates, elevation lookup failed: ${message}`);
    } finally {
      setLibrarySearchPickBusyId(null);
    }
  };
  const loadMeshmapFeed = async () => {
    const sourceUrl = meshmapSourceUrl.trim() || getDefaultMeshmapFeedUrl();
    setMeshmapLoading(true);
    setMeshmapStatus(`Loading Meshtastic feed from ${sourceUrl} ...`);
    setMeshmapSelectedNodeId(null);
    try {
      savePreferredMeshmapSourceUrl(sourceUrl);
      const result = await fetchMeshmapNodes({ sourceUrl });
      setMeshmapNodes(result.nodes);
      setMeshmapCachedSummary(getCachedMeshmapSnapshotInfo());
      if (result.fromCache) {
        const ageMin = Math.max(1, Math.round((result.cacheAgeMs ?? 0) / 60_000));
        setMeshmapStatus(
          `Loaded ${result.nodes.length.toLocaleString()} node(s) from cached snapshot (${ageMin} min old).`,
        );
      } else {
        setMeshmapStatus(`Loaded ${result.nodes.length.toLocaleString()} node(s) from live feed.`);
      }
    } catch (error) {
      const message = getUiErrorMessage(error);
      setMeshmapStatus(`Meshtastic load failed: ${message}`);
    } finally {
      setMeshmapLoading(false);
    }
  };
  const onMeshmapMove = (event: ViewStateChangeEvent) => {
    setMeshmapView({
      longitude: event.viewState.longitude,
      latitude: event.viewState.latitude,
      zoom: event.viewState.zoom,
    });
  };
  const onMeshmapClick = (event: MapLayerMouseEvent) => {
    const nodeId = event.features?.[0]?.properties?.nodeId;
    if (typeof nodeId === "string" && nodeId.trim()) {
      setMeshmapSelectedNodeId(nodeId);
    }
  };
  const addSelectedMeshmapNodeToLibrary = async () => {
    if (!selectedMeshmapNode) return;
    const fallbackName = selectedMeshmapNode.longName ?? selectedMeshmapNode.shortName ?? selectedMeshmapNode.nodeId;
    setMeshmapStatus(`Resolving elevation for ${fallbackName}...`);
    let groundM = selectedMeshmapNode.altitudeM ?? 0;
    try {
      const [elevation] = await fetchElevations([
        { lat: selectedMeshmapNode.lat, lon: selectedMeshmapNode.lon },
      ]);
      if (Number.isFinite(elevation)) {
        groundM = Math.round(elevation);
      }
    } catch {
      // Keep fallback altitude.
    }
    addSiteLibraryEntry(
      fallbackName,
      selectedMeshmapNode.lat,
      selectedMeshmapNode.lon,
      groundM,
      2,
      {
        provider: "Meshtastic MQTT",
        sourceType: "mqtt-feed",
        nodeId: selectedMeshmapNode.nodeId,
        shortName: selectedMeshmapNode.shortName,
        longName: selectedMeshmapNode.longName,
        hwModel: selectedMeshmapNode.hwModel,
        lastSeenUnix: selectedMeshmapNode.lastSeenUnix,
        raw: {
          sourceUrl: meshmapSourceUrl.trim() || getDefaultMeshmapFeedUrl(),
          seenByTopics: selectedMeshmapNode.seenByTopics,
          role: selectedMeshmapNode.role,
          precisionBits: selectedMeshmapNode.precisionBits,
        },
      },
    );
    setMeshmapStatus(`Added ${fallbackName} to site library.`);
  };

  const openUserProfilePopup = async (userId: string | undefined | null) => {
    if (!userId) return;
    setProfilePopupBusy(true);
    setProfilePopupStatus("");
    try {
      const user = await fetchUserById(userId);
      setProfilePopupUser(user);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setProfilePopupStatus(`Failed loading user: ${message}`);
    } finally {
      setProfilePopupBusy(false);
    }
  };

  const openChangeLogPopup = async (
    kind: "site" | "simulation",
    resourceId: string | undefined,
    label: string,
  ) => {
    if (!resourceId) return;
    setChangeLogPopup({ kind, resourceId, label, changes: [], busy: true, status: "" });
    try {
      const changes = await fetchResourceChanges(kind, resourceId);
      setChangeLogPopup({ kind, resourceId, label, changes, busy: false, status: "" });
    } catch (error) {
      const message = getUiErrorMessage(error);
      setChangeLogPopup({
        kind,
        resourceId,
        label,
        changes: [],
        busy: false,
        status: `Failed loading change log: ${message}`,
      });
    }
  };

  const openResourceDetailsPopup = ({
    kind,
    resourceId,
    label,
    createdByUserId,
    createdByName,
    createdByAvatarUrl,
    lastEditedByUserId,
    lastEditedByName,
    lastEditedByAvatarUrl,
  }: {
    kind: "site" | "simulation";
    resourceId: string;
    label: string;
    createdByUserId: string | null;
    createdByName: string;
    createdByAvatarUrl: string;
    lastEditedByUserId: string | null;
    lastEditedByName: string;
    lastEditedByAvatarUrl: string;
  }) => {
    if (kind === "site") {
      const site = siteLibrary.find((entry) => entry.id === resourceId);
      setResourceAccessVisibility(normalizeAccessVisibility(site?.visibility));
      setResourceCollaboratorUserIds(
        (site?.sharedWith ?? [])
          .filter((grant) => grant.role === "editor" || grant.role === "admin")
          .map((grant) => grant.userId),
      );
    } else {
      const simulation = simulationPresets.find((entry) => entry.id === resourceId);
      setResourceAccessVisibility(normalizeAccessVisibility(simulation?.visibility));
      setResourceCollaboratorUserIds(
        (simulation?.sharedWith ?? [])
          .filter((grant) => grant.role === "editor" || grant.role === "admin")
          .map((grant) => grant.userId),
      );
    }
    setResourceCollaboratorQuery("");
    setResourceAccessStatus("");
    const resolvedCreatedAvatar =
      createdByAvatarUrl.trim() || (createdByUserId && createdByUserId === lastEditedByUserId ? lastEditedByAvatarUrl : "");
    const resolvedLastEditedAvatar =
      lastEditedByAvatarUrl.trim() ||
      (lastEditedByUserId && lastEditedByUserId === createdByUserId ? createdByAvatarUrl : "");
    const resolvedCreatedName =
      createdByName.trim() && createdByName !== "Unknown"
        ? createdByName
        : createdByUserId ?? "Unknown";
    const resolvedLastEditedName =
      lastEditedByName.trim() && lastEditedByName !== "Unknown"
        ? lastEditedByName
        : lastEditedByUserId ?? resolvedCreatedName;
    setResourceDetailsPopup({
      kind,
      resourceId,
      label,
      createdByUserId,
      createdByName: resolvedCreatedName,
      createdByAvatarUrl: resolvedCreatedAvatar,
      lastEditedByUserId,
      lastEditedByName: resolvedLastEditedName,
      lastEditedByAvatarUrl: resolvedLastEditedAvatar,
    });
  };

  const saveResourceAccessSettings = () => {
    if (!resourceDetailsPopup) return;
    const sharedWith = resourceCollaboratorUserIds.map((userId) => ({ userId, role: "editor" as const }));
    const currentEntry =
      resourceDetailsPopup.kind === "site"
        ? siteLibrary.find((entry) => entry.id === resourceDetailsPopup.resourceId)
        : simulationPresets.find((entry) => entry.id === resourceDetailsPopup.resourceId);
    const effectiveRole = (currentEntry as { effectiveRole?: string } | undefined)?.effectiveRole ?? "owner";
    const currentSharedUserIds = new Set(
      ((currentEntry as { sharedWith?: Array<{ userId: string }> } | undefined)?.sharedWith ?? []).map(
        (grant) => grant.userId,
      ),
    );
    const nextSharedUserIds = new Set(sharedWith.map((grant) => grant.userId));
    const removedCollaborators = [...currentSharedUserIds].filter((userId) => !nextSharedUserIds.has(userId));
    if (removedCollaborators.length > 0 && !["owner", "admin"].includes(effectiveRole)) {
      setResourceAccessStatus("Only owners/admins can remove existing collaborators.");
      return;
    }

    if (resourceDetailsPopup.kind === "site") {
      updateSiteLibraryEntry(resourceDetailsPopup.resourceId, {
        visibility: resourceAccessVisibility,
        sharedWith,
      });
    } else {
      updateSimulationPresetEntry(resourceDetailsPopup.resourceId, {
        visibility: resourceAccessVisibility,
        sharedWith,
      });
    }
    setResourceAccessStatus("Access settings saved.");
  };

  const addCollaborator = (userId: string) => {
    if (!userId.trim()) return;
    setResourceCollaboratorUserIds((current) => (current.includes(userId) ? current : [...current, userId]));
    setResourceCollaboratorQuery("");
    setResourceAccessStatus("");
  };

  const removeCollaborator = (userId: string) => {
    if (!resourceDetailsPopup) return;
    const currentEntry =
      resourceDetailsPopup.kind === "site"
        ? siteLibrary.find((entry) => entry.id === resourceDetailsPopup.resourceId)
        : simulationPresets.find((entry) => entry.id === resourceDetailsPopup.resourceId);
    const effectiveRole = (currentEntry as { effectiveRole?: string } | undefined)?.effectiveRole ?? "owner";
    const currentSharedUserIds = new Set(
      ((currentEntry as { sharedWith?: Array<{ userId: string }> } | undefined)?.sharedWith ?? []).map(
        (grant) => grant.userId,
      ),
    );
    if (currentSharedUserIds.has(userId) && !["owner", "admin"].includes(effectiveRole)) {
      setResourceAccessStatus("Only owners/admins can remove existing collaborators.");
      return;
    }
    setResourceCollaboratorUserIds((current) => current.filter((id) => id !== userId));
    setResourceAccessStatus("");
  };

  const changeProfileRole = async (nextRole: "admin" | "moderator" | "user" | "pending") => {
    if (!profilePopupUser) return;
    setProfilePopupBusy(true);
    setProfilePopupStatus("");
    try {
      const updated = await updateUserRole(profilePopupUser.id, nextRole);
      setProfilePopupUser(updated);
      setProfilePopupStatus(`Updated role for ${updated.username}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setProfilePopupStatus(`Role update failed: ${message}`);
    } finally {
      setProfilePopupBusy(false);
    }
  };

  return (
    <aside className="sidebar-panel">
      <UserAdminPanel />
      <header>
        <h1>{t(locale, "appTitle")}</h1>
        <p>{t(locale, "workspaceSubtitle")}</p>
      </header>
      <section className="panel-section section-scenario">
        <div className="section-heading">
          <h2>Scenario</h2>
          <InfoTip text="Built-in simulations are fixed. Saved simulations are your editable full-simulation states." />
        </div>
        <p className="field-help">
          Active: <strong>{activeSimulationLabel}</strong>
        </p>
        <div className="chip-group">
          <button
            className="inline-action"
            onClick={() => setShowSimulationLibraryManager(true)}
            type="button"
          >
            Open Simulation Library
          </button>
          <button className="inline-action" onClick={saveSimulationAsNew} type="button">
            Save Simulation
          </button>
        </div>
        {simulationSaveStatus ? <p className="field-help">{simulationSaveStatus}</p> : null}
        <label className="field-grid">
          <span>Simulation name</span>
          <input
            onChange={(event) => setNewPresetName(event.target.value)}
            placeholder="My simulation"
            type="text"
            value={newPresetName}
          />
        </label>
      </section>

      <section className="panel-section section-sites">
        <div className="section-heading">
          <h2>Sites</h2>
          <InfoTip text="Site add/edit is managed in Site Library. Here you only include or remove sites in this simulation." />
        </div>
        <p className="field-help">Use Site Library to add/edit sites, then add selected sites to this simulation.</p>
        <div className="chip-group">
          <button className="inline-action" onClick={() => setShowSiteLibraryManager(true)} type="button">
            Open Site Library
          </button>
          {newestSiteLibraryEntryId ? (
            <button className="inline-action" onClick={() => insertSiteFromLibrary(newestSiteLibraryEntryId)} type="button">
              Insert Newest
            </button>
          ) : null}
        </div>
        {!siteLibrary.length ? <p className="field-help">No saved library sites yet.</p> : null}
        <p className="field-help">Current sites in this simulation:</p>
        <div className="site-list">
          {sites.map((site) => (
            <button
              className={clsx("site-row", selectedSiteId === site.id && "is-selected")}
              key={site.id}
              onClick={() => setSelectedSiteId(site.id)}
              type="button"
            >
              <span>{site.name}</span>
              <span className="site-row-meta">
                {Math.round(site.groundElevationM)} m ASL
              </span>
            </button>
          ))}
        </div>
        <button className="inline-action" onClick={openLibraryForSelectedSite} type="button">
          Edit Selected Site
        </button>
        <button
          className="inline-action"
          disabled={sites.length <= 1}
          onClick={() => deleteSite(selectedSite.id)}
          type="button"
        >
          Remove Selected From Simulation
        </button>
      </section>

      <section className="panel-section section-radio">
        <details className="compact-details" open>
          <summary>Radio & Model (Advanced)</summary>
          <p className="field-help">
            Shared channel profile for all links in this simulation.
          </p>
          <div className="section-heading">
            <p className="field-help">Coverage mode</p>
            <InfoTip text="BestSite: computes strongest coverage from any site at each sample point. Polar: radial sampling around the selected From site. Cartesian: regular grid sampling over the current simulation area. Route: samples along the selected path corridor." />
          </div>
          <div className="chip-group">
            {(["BestSite", "Polar", "Cartesian", "Route"] as const).map((mode) => (
              <button
                className={clsx("chip-button", selectedCoverageMode === mode && "is-selected")}
                key={mode}
                onClick={() => onCoverageModeChange(mode)}
                type="button"
              >
                {mode}
              </button>
            ))}
          </div>
          {networks.length > 1 ? (
            <select
              className="locale-select"
              onChange={(event) => setSelectedNetworkId(event.target.value)}
              value={selectedNetworkId}
            >
              {networks.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.name} ({(network.frequencyOverrideMHz ?? network.frequencyMHz).toFixed(3)} MHz)
                </option>
              ))}
            </select>
          ) : (
            <p className="field-help">
              Active channel profile: <strong>{selectedNetwork.name}</strong>
            </p>
          )}
          <label className="field-grid">
            <span>Frequency Plan</span>
            <select
              className="locale-select"
              onChange={(event) => setSelectedFrequencyPresetId(event.target.value)}
              value={selectedFrequencyPresetId}
            >
              {FREQUENCY_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <button className="inline-action" onClick={() => applyFrequencyPresetToSelectedNetwork()} type="button">
            Apply Frequency Plan
          </button>
          <div className="section-heading">
            <p className="field-help">Propagation model</p>
            <InfoTip text="FSPL: free-space path loss only (optimistic, no terrain blocking). TwoRay: direct + ground-reflection model for flatter/open paths, still no terrain profile blocking. ITM: terrain-aware approximation using elevation diffraction penalty in this tool; generally the most realistic option here for hilly/mountain links." />
          </div>
          <div className="chip-group">
            {(["FSPL", "TwoRay", "ITM"] as const).map((candidate) => (
              <button
                className={clsx("chip-button", model === candidate && "is-selected")}
                key={candidate}
                onClick={() => onModelChange(candidate)}
                type="button"
              >
                {candidate}
              </button>
            ))}
          </div>
          <details className="compact-details">
            <summary>ITM Environment</summary>
          <p className="field-help">
            These parameters feed terrain-aware path loss. Auto mode derives defaults from current terrain/profile and
            you can override manually.
          </p>
          <label className="field-grid">
            <span>Auto environment defaults</span>
            <select
              className="locale-select"
              onChange={(event) => setAutoPropagationEnvironment(event.target.value === "auto")}
              value={autoPropagationEnvironment ? "auto" : "manual"}
            >
              <option value="auto">Auto (recommended)</option>
              <option value="manual">Manual override</option>
            </select>
          </label>
          <p className="field-help">{propagationEnvironmentReason}</p>
          <label className="field-grid">
            <span>Radio Climate</span>
            <select
              className="locale-select"
              disabled={autoPropagationEnvironment}
              onChange={(event) => applyClimateDefaults(event.target.value as RadioClimate)}
              value={effectivePropagationEnvironment.radioClimate}
            >
              {RADIO_CLIMATE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field-grid">
            <span>Polarization</span>
            <select
              className="locale-select"
              disabled={autoPropagationEnvironment}
              onChange={(event) =>
                setPropagationEnvironment({ polarization: event.target.value as "Vertical" | "Horizontal" })
              }
              value={effectivePropagationEnvironment.polarization}
            >
              <option value="Vertical">Vertical</option>
              <option value="Horizontal">Horizontal</option>
            </select>
          </label>
          <label className="field-grid">
            <span>Clutter Height (m)</span>
            <input
              disabled={autoPropagationEnvironment}
              min={0}
              onChange={(event) =>
                setPropagationEnvironment({ clutterHeightM: Math.max(0, parseNumber(event.target.value)) })
              }
              type="number"
              value={effectivePropagationEnvironment.clutterHeightM}
            />
          </label>
          <label className="field-grid">
            <span>Ground Dielectric (V/m)</span>
            <input
              disabled={autoPropagationEnvironment}
              min={1}
              onChange={(event) =>
                setPropagationEnvironment({ groundDielectric: Math.max(1, parseNumber(event.target.value)) })
              }
              step="0.1"
              type="number"
              value={effectivePropagationEnvironment.groundDielectric}
            />
          </label>
          <label className="field-grid">
            <span>Ground Conductivity (S/m)</span>
            <input
              disabled={autoPropagationEnvironment}
              min={0}
              onChange={(event) =>
                setPropagationEnvironment({ groundConductivity: Math.max(0, parseNumber(event.target.value)) })
              }
              step="0.001"
              type="number"
              value={effectivePropagationEnvironment.groundConductivity}
            />
          </label>
          <label className="field-grid">
            <span>Atmospheric Bending (N-units)</span>
            <input
              disabled={autoPropagationEnvironment}
              min={250}
              onChange={(event) =>
                setPropagationEnvironment({
                  atmosphericBendingNUnits: Math.max(250, Math.min(400, parseNumber(event.target.value))),
                })
              }
              step="1"
              type="number"
              value={effectivePropagationEnvironment.atmosphericBendingNUnits}
            />
          </label>
          </details>
        </details>
      </section>

      <section className="panel-section section-path">
        <div className="section-heading">
          <h2>Links</h2>
          <InfoTip text="Select a link for path analysis. Use Add/Edit/Delete to manage links in this simulation." />
        </div>
        <div className="link-list">
          {visibleLinks.map((link) => (
            <button
              className={clsx("link-item", selectedLinkId === link.id && "is-selected")}
              key={link.id}
              onClick={() => setSelectedLinkId(link.id)}
              type="button"
            >
              <span className="link-title">{displayLinkName(link.id, link.name)}</span>
              <span className="link-subtitle">{effectiveNetworkFrequencyMHz.toFixed(3)} MHz (from channel)</span>
            </button>
          ))}
        </div>
        <div className="chip-group">
          <button className="inline-action" disabled={sites.length < 2} onClick={openAddLinkModal} type="button">
            Add Link
          </button>
          <button className="inline-action" onClick={openEditLinkModal} type="button">
            Edit Link
          </button>
          <button
            className="inline-action"
            disabled={!links.length}
            onClick={() => deleteLink(selectedLink.id)}
            type="button"
          >
            Delete Selected Link
          </button>
        </div>
      </section>

      {linkModal ? (
        <ModalOverlay aria-label={linkModal.mode === "add" ? "Add Link" : "Edit Link"} onClose={() => setLinkModal(null)} tier="raised">
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>{linkModal.mode === "add" ? "Add Link" : "Edit Link"}</h2>
              <button className="inline-action" onClick={() => setLinkModal(null)} type="button">
                Close
              </button>
            </div>
            <label className="field-grid">
              <span>Link name</span>
              <input
                onChange={(event) =>
                  setLinkModal((current) => (current ? { ...current, name: event.target.value, status: "" } : current))
                }
                placeholder="Backhaul A"
                type="text"
                value={linkModal.name}
              />
            </label>
            <label className="field-grid endpoint-field">
              <span>From site</span>
              <select
                className="locale-select"
                onChange={(event) =>
                  setLinkModal((current) => {
                    if (!current) return current;
                    const nextFrom = event.target.value;
                    const nextTo =
                      current.toSiteId === nextFrom
                        ? sites.find((site) => site.id !== nextFrom)?.id ?? ""
                        : current.toSiteId;
                    return { ...current, fromSiteId: nextFrom, toSiteId: nextTo, status: "" };
                  })
                }
                value={linkModal.fromSiteId}
              >
                {sites.map((site) => (
                  <option key={`modal-from-${site.id}`} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-grid endpoint-field">
              <span>To site</span>
              <select
                className="locale-select"
                onChange={(event) =>
                  setLinkModal((current) => (current ? { ...current, toSiteId: event.target.value, status: "" } : current))
                }
                value={linkModal.toSiteId}
              >
                {sites
                  .filter((site) => site.id !== linkModal.fromSiteId)
                  .map((site) => (
                    <option key={`modal-to-${site.id}`} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </label>
            <details className="compact-details" open>
              <summary>Radio</summary>
              <label className="field-grid">
                <span>Tx power (dBm)</span>
                <input
                  onChange={(event) =>
                    setLinkModal((current) =>
                      current ? { ...current, txPowerDbm: parseNumber(event.target.value), status: "" } : current,
                    )
                  }
                  type="number"
                  value={linkModal.txPowerDbm}
                />
              </label>
              <label className="field-grid">
                <span>Tx gain (dBi)</span>
                <input
                  onChange={(event) =>
                    setLinkModal((current) =>
                      current ? { ...current, txGainDbi: parseNumber(event.target.value), status: "" } : current,
                    )
                  }
                  type="number"
                  value={linkModal.txGainDbi}
                />
              </label>
              <label className="field-grid">
                <span>Rx gain (dBi)</span>
                <input
                  onChange={(event) =>
                    setLinkModal((current) =>
                      current ? { ...current, rxGainDbi: parseNumber(event.target.value), status: "" } : current,
                    )
                  }
                  type="number"
                  value={linkModal.rxGainDbi}
                />
              </label>
              <label className="field-grid">
                <span>Cable loss (dB)</span>
                <input
                  onChange={(event) =>
                    setLinkModal((current) =>
                      current ? { ...current, cableLossDb: parseNumber(event.target.value), status: "" } : current,
                    )
                  }
                  type="number"
                  value={linkModal.cableLossDb}
                />
              </label>
            </details>
            <div className="chip-group">
              <button className="inline-action" onClick={saveLinkModal} type="button">
                {linkModal.mode === "add" ? "Create Link" : "Save Link"}
              </button>
            </div>
            {linkModal.status ? <p className="field-help">{linkModal.status}</p> : null}
          </div>
        </ModalOverlay>
      ) : null}

      <section className="panel-section section-data">
        <details className="compact-details">
          <summary>Terrain & Sources (Advanced)</summary>
          <p className="field-help">
            {srtmTiles.length} SRTM tile(s) loaded. Terrain is used in profile and obstruction/loss calculations.
          </p>
          <button
            className="inline-action"
            onClick={() => void recommendAndFetchTerrainForCurrentArea()}
            type="button"
          >
            Auto Fetch Terrain Data
          </button>
          <label className="field-grid">
            <span>ve2dbe source</span>
            <select
              className="locale-select"
              onChange={(event) => setTerrainDataset(event.target.value as "srtm1" | "srtm3" | "srtmthird")}
              value={terrainDataset}
            >
              <option value="srtm1">SRTM1</option>
              <option value="srtm3">SRTM3</option>
              <option value="srtmthird">SRTM Third</option>
            </select>
          </label>
          <button className="inline-action" onClick={() => void fetchTerrainForCurrentArea()} type="button">
            Fetch Current Area (Current Source)
          </button>
          <button
            className="inline-action"
            onClick={() => void recommendTerrainDatasetForCurrentArea()}
            type="button"
          >
            Recommend Source Only
          </button>
          <label className="upload-button">
            {t(locale, "loadHgt")}
            <input accept=".hgt,.zip,.hgt.zip" multiple onChange={onUploadTiles} type="file" />
          </label>
          <button className="inline-action" onClick={() => void syncSiteElevationsOnline()} type="button">
            {t(locale, "syncSiteElevations")}
          </button>
          <button className="inline-action" onClick={() => void clearTerrainCache()} type="button">
            Clear ve2dbe Cache
          </button>
          {terrainRecommendation ? <p className="field-help">{terrainRecommendation}</p> : null}
          {terrainFetchStatus ? <p className="field-help">{terrainFetchStatus}</p> : null}
          <div className="asset-list">
            <a href={REMOTE_SRTM_ENDPOINTS[terrainDataset]} rel="noreferrer" target="_blank">
              Open selected ve2dbe dataset source
            </a>
            <a href="https://www.ve2dbe.com/geodata/" rel="noreferrer" target="_blank">
              ve2dbe geodata selector
            </a>
          </div>
        </details>
      </section>

      <section className="panel-section section-results">
        <div className="section-heading">
          <h2>Results</h2>
          <InfoTip text="Computed link budget summary for the selected path and current channel/model settings." />
        </div>
        <div className="metrics">
          {metric("Network", `${selectedNetwork.name} (${selectedCoverageMode})`)}
          {metric(
            "LoRa",
            `${(selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz).toFixed(3)} MHz / BW ${selectedNetwork.bandwidthKhz} / SF ${selectedNetwork.spreadFactor} / CR ${selectedNetwork.codingRate}`,
          )}
          {metric("Distance", `${analysis.distanceKm.toFixed(2)} km`)}
          {metric("Model", analysis.model)}
          {metric("Path loss", `${analysis.pathLossDb.toFixed(1)} dB`)}
          {metric("FSPL", `${analysis.fsplDb.toFixed(1)} dB`)}
          {metric("EIRP", `${analysis.eirpDbm.toFixed(1)} dBm`)}
          {metric("RX estimate (raw)", `${analysis.rxLevelDbm.toFixed(1)} dBm`)}
          {metric("RX estimate (calibrated)", `${adjustedRxDbm.toFixed(1)} dBm`)}
          {metric("Earth bulge", `${analysis.midpointEarthBulgeM.toFixed(2)} m`)}
          {metric("F1 radius", `${analysis.firstFresnelRadiusM.toFixed(2)} m`)}
          {metric("Clearance", `${analysis.geometricClearanceM.toFixed(2)} m`)}
          {metric(
            "Fresnel clearance",
            `${analysis.estimatedFresnelClearancePercent.toFixed(0)}%`,
          )}
        </div>
        <label className="field-grid">
          <span>RX target (dBm)</span>
          <input
            onChange={(event) => setRxSensitivityTargetDbm(parseNumber(event.target.value))}
            type="number"
            value={rxSensitivityTargetDbm}
          />
        </label>
        <label className="field-grid">
          <span>Env loss (dB)</span>
          <input
            min={0}
            onChange={(event) => setEnvironmentLossDb(parseNumber(event.target.value))}
            type="number"
            value={environmentLossDb}
          />
        </label>
        {isLoraEstimateRelevant ? (
          <div className="section-heading">
            <button
              className="inline-action"
              onClick={() => setRxSensitivityTargetDbm(Math.round(loraSensitivitySuggestionDbm))}
              type="button"
            >
              Set RX Target To LoRa Estimate ({loraSensitivitySuggestionDbm.toFixed(1)} dBm)
            </button>
            <InfoTip text="Sets RX target to a LoRa sensitivity estimate from current BW and SF (noise floor + NF + SF SNR limit). This is a helper target, not a measured receiver spec." />
          </div>
        ) : (
          <p className="field-help">
            LoRa RX estimate helper is hidden for Radio Mobile presets. Switch to a Meshtastic/Local frequency plan
            to use it.
          </p>
        )}
        <div className="section-heading">
          <div className={clsx("margin-status", linkMarginDb >= 0 ? "is-pass" : "is-fail")}>
            Link margin: {linkMarginDb >= 0 ? "+" : ""}
            {linkMarginDb.toFixed(1)} dB ({linkMarginDb >= 0 ? "PASS" : "FAIL"})
          </div>
          <InfoTip text="Pass/Fail is based on calibrated RX estimate minus RX target. Terrain blocking affects this when ITM model is selected and terrain data is loaded." />
        </div>
        <div className="whatif-table">
          {whatIfRows.map((row) => (
            <div className="whatif-row" key={row.label}>
              <span>{row.label}</span>
              <span>{row.rxDbm === null ? "n/a" : `${row.rxDbm.toFixed(1)} dBm`}</span>
              <span>
                {row.marginDb === null ? "n/a" : `${row.marginDb >= 0 ? "+" : ""}${row.marginDb.toFixed(1)} dB`}
              </span>
            </div>
          ))}
        </div>
        <button className="inline-action" onClick={exportManifest} type="button">
          Export Simulation Manifest
        </button>
      </section>

      <section className="panel-section section-more">
        <details className="compact-details">
          <summary>More</summary>
          <div className="section-heading">
            <p className="field-help">Cloud Sync</p>
            <InfoTip text="Sync Site Library and Simulation Library through Cloudflare D1. Access is enforced by Cloudflare Access at the edge, and ownership/sharing metadata is persisted server-side." />
          </div>
          <AuthSyncPanel />
          <div className="section-heading">
            <p className="field-help">Local Storage Safety</p>
            <InfoTip text="Your site and simulation libraries are saved in this browser origin. Export backups regularly, and use Restore Snapshot if data looks missing after refresh." />
          </div>
          {storageOriginWarning ? <p className="field-help warning-text">{storageOriginWarning}</p> : null}
          <p className="field-help">{lastStorageActionLabel}</p>
          <p className="field-help">
            Snapshot history: {storageSnapshotInfo.siteSnapshots} site snapshot(s),{" "}
            {storageSnapshotInfo.simulationSnapshots} simulation snapshot(s).
          </p>
          <div className="chip-group">
            <button className="inline-action" onClick={exportLocalLibraries} type="button">
              Export Library Backup
            </button>
            <button className="inline-action" onClick={restoreLocalLibraries} type="button">
              Restore Latest Snapshot
            </button>
          </div>
          <label className="field-grid">
            <span>Import mode</span>
            <select
              className="locale-select"
              onChange={(event) => setStorageImportMode(event.target.value as "merge" | "replace")}
              value={storageImportMode}
            >
              <option value="merge">Merge with current data</option>
              <option value="replace">Replace current data</option>
            </select>
          </label>
          <label className="upload-button">
            Import Library Backup
            <input accept=".json,application/json" onChange={(event) => void importLocalLibraries(event)} type="file" />
          </label>
          {storageStatus ? <p className="field-help">{storageStatus}</p> : null}
          <label className="field-grid">
            <span>Language</span>
            <select
              className="locale-select"
              onChange={(event) => setLocale(event.target.value as (typeof SUPPORTED_LOCALES)[number])}
              value={locale}
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">References and external resources:</p>
          <div className="asset-list">
            <a href="https://github.com/wilhel1812/LinkSim/blob/main/docs/rf-models-and-sampling.md" rel="noreferrer" target="_blank">
              RF Models & Sampling Guide
            </a>
            {LEGACY_ASSETS.map((asset) => (
              <a href={asset.url} key={asset.url} rel="noreferrer" target="_blank">
                {asset.label}
              </a>
            ))}
          </div>
          <details className="compact-details">
            <summary>Credits & Attribution</summary>
            <p className="field-help subtle-note">
              Inspired by{" "}
              <a href={PRIMARY_ATTRIBUTION.projectUrl} rel="noreferrer" target="_blank">
                {PRIMARY_ATTRIBUTION.projectName}
              </a>{" "}
              by {PRIMARY_ATTRIBUTION.authorName}
            </p>
            <p className="field-help subtle-note">
              Basemap style: {theme === "dark" ? "Carto Dark Matter" : "Carto Positron"} (provider attribution applies).
            </p>
          </details>
        </details>
      </section>

      {profilePopupUser ? (
        <ModalOverlay aria-label="User Profile" onClose={() => setProfilePopupUser(null)} tier="raised">
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>User Profile</h2>
              <button className="inline-action" onClick={() => setProfilePopupUser(null)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">
              <strong>
                <UserBadge avatarUrl={profilePopupUser.avatarUrl} name={profilePopupUser.username} />
              </strong>{" "}
              ({profilePopupUser.id})
            </p>
            <p className="field-help">Email: {profilePopupUser.email ?? "Hidden by user"}</p>
            <p className="field-help">Bio: {profilePopupUser.bio || "-"}</p>
            <p className="field-help">
              Role:{" "}
              {profilePopupUser.role ??
                (profilePopupUser.isAdmin
                  ? "admin"
                  : profilePopupUser.isModerator
                    ? "moderator"
                    : profilePopupUser.isApproved
                      ? "user"
                      : "pending")}
            </p>
            <p className="field-help">
              Access:{" "}
              {profilePopupUser.accountState === "revoked"
                ? "Revoked"
                : profilePopupUser.isApproved
                  ? "Approved"
                  : "Pending"}{" "}
              | Created{" "}
              {new Date(profilePopupUser.createdAt).toLocaleString()}
            </p>
            <div className="chip-group">
              <label className="field-grid">
                <span>
                  Role{" "}
                  <InfoTip text="Admins can change roles for other users. Moderators can only move non-admin/non-moderator users between Pending and User. No one can change their own role." />
                </span>
                <select
                  className="locale-select"
                  disabled={profilePopupBusy}
                  onChange={(event) =>
                    void changeProfileRole(event.target.value as "admin" | "moderator" | "user" | "pending")
                  }
                  value={
                    profilePopupUser.role ??
                    (profilePopupUser.isAdmin
                      ? "admin"
                      : profilePopupUser.isModerator
                        ? "moderator"
                        : profilePopupUser.isApproved
                          ? "user"
                          : "pending")
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="user">User</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {!profilePopupUser.isApproved ? (
                <button
                  className="inline-action"
                  disabled={profilePopupBusy}
                  onClick={() => void changeProfileRole("user")}
                  type="button"
                >
                  Approve Access
                </button>
              ) : null}
            </div>
            {profilePopupStatus ? <p className="field-help">{profilePopupStatus}</p> : null}
          </div>
        </ModalOverlay>
      ) : null}

      {changeLogPopup ? (
        <ModalOverlay aria-label="Change Log" onClose={() => setChangeLogPopup(null)} tier="raised">
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Change Log · {changeLogPopup.label}</h2>
              <button className="inline-action" onClick={() => setChangeLogPopup(null)} type="button">
                Close
              </button>
            </div>
            {changeLogPopup.busy ? <p className="field-help">Loading changes...</p> : null}
            {changeLogPopup.status ? <p className="field-help">{changeLogPopup.status}</p> : null}
            <div className="library-manager-list">
              {changeLogPopup.changes.map((change) => (
                <div className="library-row" key={change.id}>
                  <p className="field-help">
                    {change.action.toUpperCase()} · {new Date(change.changedAt).toLocaleString()}
                  </p>
                  <button
                    className="inline-link-button"
                    onClick={() => void openUserProfilePopup(change.actorUserId)}
                    type="button"
                  >
                    <UserBadge avatarUrl={change.actorAvatarUrl} name={change.actorName ?? change.actorUserId} />
                  </button>
                  <p className="field-help">{formatChangeSummary(change.action, change.note)}</p>
                </div>
              ))}
              {!changeLogPopup.busy && !changeLogPopup.changes.length ? (
                <p className="field-help">No change entries yet.</p>
              ) : null}
            </div>
          </div>
        </ModalOverlay>
      ) : null}

      {resourceDetailsPopup ? (
        <ModalOverlay aria-label="Resource Collaborators" onClose={() => setResourceDetailsPopup(null)} tier="raised">
          <div className="library-manager-card user-profile-popup resource-details-card">
            <div className="library-manager-header">
              <h2>Collaborators · {resourceDetailsPopup.label}</h2>
              <button className="inline-action" onClick={() => setResourceDetailsPopup(null)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">Type: {resourceDetailsPopup.kind === "site" ? "Site" : "Simulation"}</p>
            <p className="field-help">ID: {resourceDetailsPopup.resourceId}</p>
            <div className="chip-group">
              <button
                className="inline-action"
                onClick={() => void openUserProfilePopup(resourceDetailsPopup.createdByUserId)}
                type="button"
              >
                Created by <UserBadge avatarUrl={resourceDetailsPopup.createdByAvatarUrl} name={resourceDetailsPopup.createdByName} />
              </button>
              <button
                className="inline-action"
                onClick={() => void openUserProfilePopup(resourceDetailsPopup.lastEditedByUserId)}
                type="button"
              >
                Last edited by{" "}
                <UserBadge avatarUrl={resourceDetailsPopup.lastEditedByAvatarUrl} name={resourceDetailsPopup.lastEditedByName} />
              </button>
              <button
                className="inline-action"
                onClick={() =>
                  void openChangeLogPopup(
                    resourceDetailsPopup.kind,
                    resourceDetailsPopup.resourceId,
                    resourceDetailsPopup.label,
                  )
                }
                type="button"
              >
                Open change log
              </button>
            </div>
            <details className="compact-details" open>
              <summary>Access</summary>
              <label className="field-grid">
                <span>
                  Access level{" "}
                  <InfoTip text="Private: owner/admin edit. Public: everyone can view; owner/mod/admin edit. Shared: everyone can view/edit; only owner/mod/admin can delete." />
                </span>
                <select
                  className="locale-select"
                  onChange={(event) =>
                    setResourceAccessVisibility(event.target.value as "private" | "public" | "shared")
                  }
                  value={resourceAccessVisibility}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                  <option value="shared">Shared</option>
                </select>
              </label>
              <div className="field-grid user-bio-field collaborator-picker-grid">
                <span>
                  Collaborators{" "}
                  <InfoTip text="Collaborators get edit rights on this resource. Editors can add collaborators but cannot remove existing collaborators. Owners/admins can remove." />
                </span>
                <div className="collaborator-picker">
                  <div className="chip-group collaborator-selected-list">
                    {selectedCollaboratorUsers.length ? (
                      selectedCollaboratorUsers.map((user) => (
                        <span className="site-quick-item" key={user.id}>
                          <UserBadge avatarUrl={user.avatarUrl} name={user.username} />
                          <button className="inline-action" onClick={() => removeCollaborator(user.id)} type="button">
                            Remove
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="field-help">No collaborators yet.</span>
                    )}
                  </div>
                  <input
                    onChange={(event) => setResourceCollaboratorQuery(event.target.value)}
                    placeholder="Search users by name or email"
                    type="text"
                    value={resourceCollaboratorQuery}
                  />
                  <div className="collaborator-candidate-list">
                    {resourceCollaboratorDirectoryBusy ? (
                      <p className="field-help">Loading users…</p>
                    ) : collaboratorCandidates.length ? (
                      collaboratorCandidates.map((user) => (
                        <button className="site-quick-item" key={user.id} onClick={() => addCollaborator(user.id)} type="button">
                          <UserBadge avatarUrl={user.avatarUrl} name={user.username} />
                          <span className="field-help">{user.email}</span>
                          <span className="inline-action">Add</span>
                        </button>
                      ))
                    ) : (
                      <p className="field-help">No matching users.</p>
                    )}
                  </div>
                  {resourceCollaboratorDirectoryStatus ? (
                    <p className="field-help">{resourceCollaboratorDirectoryStatus}</p>
                  ) : null}
                </div>
              </div>
              <p className="field-help">
                Collaborators are granted edit rights. Regular editors can add collaborators but cannot remove existing
                collaborators/owner.
              </p>
              <button className="inline-action" onClick={saveResourceAccessSettings} type="button">
                Save Access
              </button>
              {resourceAccessStatus ? <p className="field-help">{resourceAccessStatus}</p> : null}
            </details>
          </div>
        </ModalOverlay>
      ) : null}

      {showSimulationLibraryManager ? (
        <ModalOverlay aria-label="Simulation Library" onClose={() => setShowSimulationLibraryManager(false)}>
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Simulation Library</h2>
              <button className="inline-action" onClick={() => setShowSimulationLibraryManager(false)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">
              Manage built-in presets and saved simulations here. Site/node editing still happens in the main
              workspace.
            </p>
            <label className="field-grid">
              <span>Search</span>
              <input
                onChange={(event) => setSimulationLibraryQuery(event.target.value)}
                placeholder="Filter built-in + saved simulations"
                type="text"
                value={simulationLibraryQuery}
              />
            </label>
            <label className="field-grid">
              <span>Save as new simulation</span>
              <input
                onChange={(event) => setNewPresetName(event.target.value)}
                placeholder="My simulation"
                type="text"
                value={newPresetName}
              />
            </label>
            <div className="chip-group">
              <button className="inline-action" onClick={saveSimulationAsNew} type="button">
                Save Simulation
              </button>
            </div>
            {simulationSaveStatus ? <p className="field-help">{simulationSaveStatus}</p> : null}
            <div className="library-editor">
              <h3>Built-in simulations</h3>
              <div className="library-manager-list">
                {filteredBuiltinScenarios.map((scenario) => (
                  <div className="library-manager-row simulation-manager-row" key={scenario.id}>
                    <span className="library-row-label">
                      <strong>{scenario.name}</strong> {" · "}Built-in
                    </span>
                    <div className="library-row-actions">
                      <button
                        className="inline-action"
                        onClick={() => loadSimulationRef(`builtin:${scenario.id}`)}
                        type="button"
                      >
                        Load
                      </button>
                    </div>
                  </div>
                ))}
                {!filteredBuiltinScenarios.length ? <p className="field-help">No matching built-in simulations.</p> : null}
              </div>
            </div>
            <div className="library-editor">
              <h3>Saved simulations</h3>
            <div className="library-manager-list">
              {filteredSimulationPresets.map((preset) => (
                <div className="library-manager-row simulation-manager-row" key={preset.id}>
                  <span className="library-row-label">
                    <strong>{preset.name}</strong>
                    {" · "}
                    Updated {new Date(preset.updatedAt).toLocaleString()}
                  </span>
                  <div className="library-row-actions">
                    <button
                      className="inline-action"
                      onClick={() => {
                        loadSimulationPreset(preset.id);
                        setSelectedSimulationRef(`saved:${preset.id}`);
                      }}
                      type="button"
                    >
                      Load
                    </button>
                    <button
                      className="inline-action"
                      onClick={() =>
                        openResourceDetailsPopup({
                          kind: "simulation",
                          resourceId: preset.id,
                          label: preset.name,
                          createdByUserId: (preset as unknown as { createdByUserId?: string }).createdByUserId ?? null,
                          createdByName: (preset as unknown as { createdByName?: string }).createdByName ?? "Unknown",
                          createdByAvatarUrl:
                            (preset as unknown as { createdByAvatarUrl?: string }).createdByAvatarUrl ?? "",
                          lastEditedByUserId:
                            (preset as unknown as { lastEditedByUserId?: string }).lastEditedByUserId ?? null,
                          lastEditedByName:
                            (preset as unknown as { lastEditedByName?: string }).lastEditedByName ?? "Unknown",
                          lastEditedByAvatarUrl:
                            (preset as unknown as { lastEditedByAvatarUrl?: string }).lastEditedByAvatarUrl ?? "",
                        })
                      }
                      type="button"
                    >
                      Collaborators
                    </button>
                    <button
                      className="inline-action"
                      onClick={() => startSimulationRename(preset.id, preset.name)}
                      type="button"
                    >
                      Edit Name
                    </button>
                    <button className="inline-action" onClick={() => deleteSimulationPreset(preset.id)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!filteredSimulationPresets.length ? <p className="field-help">No matching saved simulations.</p> : null}
            </div>
            </div>
            {editingSimulationId ? (
              <div className="library-editor">
                <h3>Edit Simulation Name</h3>
                <label className="field-grid">
                  <span>Name</span>
                  <input
                    onChange={(event) => setEditingSimulationName(event.target.value)}
                    placeholder="Simulation name"
                    type="text"
                    value={editingSimulationName}
                  />
                </label>
                <div className="chip-group">
                  <button className="inline-action" onClick={saveSimulationRename} type="button">
                    Save
                  </button>
                  <button
                    className="inline-action"
                    onClick={() => {
                      setEditingSimulationId(null);
                      setEditingSimulationName("");
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </ModalOverlay>
      ) : null}
      {showSiteLibraryManager ? (
        <ModalOverlay aria-label="Site Library" onClose={() => setShowSiteLibraryManager(false)}>
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Site Library</h2>
              <button className="inline-action" onClick={() => setShowSiteLibraryManager(false)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">
              Built for large libraries. Select one or more entries to add into this simulation.
            </p>
            <label className="field-grid">
              <span>Search</span>
              <input
                onChange={(event) => setSiteLibraryQuery(event.target.value)}
                placeholder="Filter by name or coordinates"
                type="text"
                value={siteLibraryQuery}
              />
            </label>
            <div className="chip-group">
              <button
                className="inline-action"
                onClick={() => setShowAddLibraryForm((current) => !current)}
                type="button"
              >
                {showAddLibraryForm ? "Hide Add Form" : "Add Site"}
              </button>
              <button
                className="inline-action"
                onClick={() => setSelectedLibraryIds(new Set(filteredSiteLibrary.map((entry) => entry.id)))}
                type="button"
              >
                Select Filtered ({filteredSiteLibrary.length})
              </button>
              <button className="inline-action" onClick={() => setSelectedLibraryIds(new Set())} type="button">
                Clear Selection
              </button>
              <button
                className="inline-action"
                disabled={!selectedLibraryCount}
                onClick={() => {
                  insertSitesFromLibrary(Array.from(selectedLibraryIds));
                  setSelectedLibraryIds(new Set());
                }}
                type="button"
              >
                Add Selected To Simulation ({selectedLibraryCount})
              </button>
              <button
                className="inline-action"
                disabled={!selectedLibraryCount}
                onClick={() => {
                  deleteSiteLibraryEntries(Array.from(selectedLibraryIds));
                  setSelectedLibraryIds(new Set());
                }}
                type="button"
              >
                Delete Selected ({selectedLibraryCount})
              </button>
            </div>
            {showAddLibraryForm ? (
              <div className="library-editor">
                <h3>Add Site</h3>
                <label className="field-grid">
                  <span>Name</span>
                  <input
                    onChange={(event) => setNewLibraryName(event.target.value)}
                    placeholder="My site"
                    type="text"
                    value={newLibraryName}
                  />
                </label>
                <label className="field-grid">
                  <span>Latitude</span>
                  <input
                    onChange={(event) => setNewLibraryLat(parseNumber(event.target.value))}
                    step="0.000001"
                    type="number"
                    value={newLibraryLat}
                  />
                </label>
                <label className="field-grid">
                  <span>Longitude</span>
                  <input
                    onChange={(event) => setNewLibraryLon(parseNumber(event.target.value))}
                    step="0.000001"
                    type="number"
                    value={newLibraryLon}
                  />
                </label>
                <label className="field-grid">
                  <span>Ground elev (m)</span>
                  <div className="field-inline">
                    <input
                      onChange={(event) => setNewLibraryGroundM(parseNumber(event.target.value))}
                      type="number"
                      value={newLibraryGroundM}
                    />
                    <button className="inline-action field-inline-btn" onClick={fetchNewLibraryGroundFromTerrain} type="button">
                      Fetch
                    </button>
                  </div>
                </label>
                <label className="field-grid">
                  <span>Antenna (m)</span>
                  <input
                    onChange={(event) => setNewLibraryAntennaM(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryAntennaM}
                  />
                </label>
                <label className="field-grid">
                  <span>Map Search</span>
                  <input
                    onChange={(event) => setLibrarySearchQuery(event.target.value)}
                    placeholder="Address or place"
                    type="text"
                    value={librarySearchQuery}
                  />
                </label>
                <button className="inline-action" onClick={() => void runLibrarySearch()} type="button">
                  Search
                </button>
                {librarySearchStatus ? <p className="field-help">{librarySearchStatus}</p> : null}
                {librarySearchResults.length ? (
                  <div className="asset-list">
                    {librarySearchResults.map((result) => (
                      <button
                        className="inline-action"
                        disabled={librarySearchPickBusyId !== null}
                        key={result.id}
                        onClick={() => void selectLibrarySearchResult(result)}
                        type="button"
                      >
                        {librarySearchPickBusyId === result.id ? "Loading..." : `Use: ${result.label}`}
                      </button>
                    ))}
                  </div>
                ) : null}
                <details className="compact-details">
                  <summary>Browse Meshtastic MQTT Nodes</summary>
                  <p className="field-help">
                    Default source uses a same-origin proxy route (`/meshmap/nodes.json`) to avoid browser CORS
                    blocking. You can switch to your own relay endpoint later.
                  </p>
                  <label className="field-grid">
                    <span>Source URL</span>
                    <input
                      onChange={(event) => setMeshmapSourceUrl(event.target.value)}
                      placeholder="/meshmap/nodes.json"
                      type="text"
                      value={meshmapSourceUrl}
                    />
                  </label>
                  <div className="chip-group">
                    <button className="inline-action" disabled={meshmapLoading} onClick={() => void loadMeshmapFeed()} type="button">
                      {meshmapLoading ? "Loading..." : "Load Feed"}
                    </button>
                    <button
                      className="inline-action"
                      onClick={() => setShowMeshtasticBrowser((current) => !current)}
                      type="button"
                    >
                      {showMeshtasticBrowser ? "Hide Browser" : "Show Browser"}
                    </button>
                  </div>
                  {meshmapCachedSummary ? (
                    <p className="field-help">
                      Cached snapshot: {meshmapCachedSummary.nodeCount.toLocaleString()} node(s) from{" "}
                      {new Date(meshmapCachedSummary.savedAt).toLocaleString()} ({meshmapCachedSummary.sourceUrl})
                    </p>
                  ) : null}
                  {meshmapStatus ? <p className="field-help">{meshmapStatus}</p> : null}
                  {showMeshtasticBrowser ? (
                    <div className="meshmap-browser">
                      <div className="meshmap-browser-map">
                        <Map
                          initialViewState={meshmapView}
                          interactiveLayerIds={["meshmap-nodes-layer"]}
                          mapStyle={styleByTheme[theme]}
                          onClick={onMeshmapClick}
                          onMove={onMeshmapMove}
                        >
                          <Source data={meshmapNodesGeoJson} id="meshmap-nodes" type="geojson">
                            <Layer {...meshmapNodesLayer} />
                            <Layer {...meshmapLabelsLayer} />
                          </Source>
                        </Map>
                      </div>
                      <p className="field-help">
                        Nodes loaded: {meshmapNodes.length.toLocaleString()} total, {meshmapNodesInView.length.toLocaleString()} in view.
                      </p>
                      {selectedMeshmapNode ? (
                        <div className="meshmap-selected-card">
                          <p>
                            <strong>{selectedMeshmapNode.longName ?? selectedMeshmapNode.shortName ?? selectedMeshmapNode.nodeId}</strong>{" "}
                            ({selectedMeshmapNode.lat.toFixed(5)}, {selectedMeshmapNode.lon.toFixed(5)})
                          </p>
                          <p className="field-help">
                            Short: {selectedMeshmapNode.shortName ?? "n/a"} | Node ID: {selectedMeshmapNode.nodeId}
                            {selectedMeshmapNode.hwModel ? ` | HW: ${selectedMeshmapNode.hwModel}` : ""}
                            {selectedMeshmapNode.lastSeenUnix
                              ? ` | Last seen ${new Date(selectedMeshmapNode.lastSeenUnix * 1000).toLocaleString()}`
                              : ""}
                          </p>
                          <button className="inline-action" onClick={() => void addSelectedMeshmapNodeToLibrary()} type="button">
                            Add Selected MQTT Node To Library
                          </button>
                        </div>
                      ) : (
                        <p className="field-help">Click a blue node in the map to select it.</p>
                      )}
                    </div>
                  ) : null}
                </details>
                <div className="chip-group">
                  <button className="inline-action" onClick={addLibraryEntryNow} type="button">
                    Add To Library
                  </button>
                  <button className="inline-action" onClick={() => setShowAddLibraryForm(false)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div className="library-manager-list">
              {filteredSiteLibrary.map((entry) => (
                <div className="library-manager-row" key={entry.id}>
                  <input
                    checked={selectedLibraryIds.has(entry.id)}
                    onChange={() => toggleLibrarySelection(entry.id)}
                    type="checkbox"
                  />
                  <span className="library-row-label">
                    {entry.name} ({entry.position.lat.toFixed(5)}, {entry.position.lon.toFixed(5)})
                  </span>
                  <div className="library-row-actions">
                    <button className="inline-action" onClick={() => insertSiteFromLibrary(entry.id)} type="button">
                      Add
                    </button>
                    <button
                      className="inline-action"
                      onClick={() =>
                        openResourceDetailsPopup({
                          kind: "site",
                          resourceId: entry.id,
                          label: entry.name,
                          createdByUserId: (entry as unknown as { createdByUserId?: string }).createdByUserId ?? null,
                          createdByName: (entry as unknown as { createdByName?: string }).createdByName ?? "Unknown",
                          createdByAvatarUrl:
                            (entry as unknown as { createdByAvatarUrl?: string }).createdByAvatarUrl ?? "",
                          lastEditedByUserId:
                            (entry as unknown as { lastEditedByUserId?: string }).lastEditedByUserId ?? null,
                          lastEditedByName:
                            (entry as unknown as { lastEditedByName?: string }).lastEditedByName ?? "Unknown",
                          lastEditedByAvatarUrl:
                            (entry as unknown as { lastEditedByAvatarUrl?: string }).lastEditedByAvatarUrl ?? "",
                        })
                      }
                      type="button"
                    >
                      Collaborators
                    </button>
                    <button className="inline-action" onClick={() => startLibraryEdit(entry.id)} type="button">
                      Edit
                    </button>
                    <button className="inline-action" onClick={() => deleteSiteLibraryEntry(entry.id)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!filteredSiteLibrary.length ? <p className="field-help">No matching sites.</p> : null}
            </div>
            {editingLibraryId ? (
              <div className="library-editor">
                <h3>Edit Library Site</h3>
                <div className="library-editor-split">
                  <div className="library-editor-form">
                    <label className="field-grid">
                      <span>Name</span>
                      <input
                        onChange={(event) => setEditingLibraryName(event.target.value)}
                        type="text"
                        value={editingLibraryName}
                      />
                    </label>
                    <label className="field-grid">
                      <span>Latitude</span>
                      <input
                        onChange={(event) => setEditingLibraryLat(parseNumber(event.target.value))}
                        step="0.000001"
                        type="number"
                        value={editingLibraryLat}
                      />
                    </label>
                    <label className="field-grid">
                      <span>Longitude</span>
                      <input
                        onChange={(event) => setEditingLibraryLon(parseNumber(event.target.value))}
                        step="0.000001"
                        type="number"
                        value={editingLibraryLon}
                      />
                    </label>
                    <label className="field-grid">
                      <span>Ground elev (m)</span>
                      <div className="field-inline">
                        <input
                          onChange={(event) => setEditingLibraryGroundM(parseNumber(event.target.value))}
                          type="number"
                          value={editingLibraryGroundM}
                        />
                        <button
                          className="inline-action field-inline-btn"
                          onClick={fetchEditingLibraryGroundFromTerrain}
                          type="button"
                        >
                          Fetch
                        </button>
                      </div>
                    </label>
                    <label className="field-grid">
                      <span>Antenna (m)</span>
                      <input
                        onChange={(event) => setEditingLibraryAntennaM(parseNumber(event.target.value))}
                        type="number"
                        value={editingLibraryAntennaM}
                      />
                    </label>
                    {editingLibraryStatus ? <p className="field-help">{editingLibraryStatus}</p> : null}
                  </div>
                  <div className="library-editor-map">
                    <Map
                      initialViewState={{
                        longitude: editingLibraryLon,
                        latitude: editingLibraryLat,
                        zoom: 12,
                      }}
                      mapStyle={styleByTheme[theme]}
                      onClick={(event) => {
                        setEditingLibraryLat(event.lngLat.lat);
                        setEditingLibraryLon(event.lngLat.lng);
                      }}
                    >
                      <Marker
                        anchor="bottom"
                        draggable
                        latitude={editingLibraryLat}
                        longitude={editingLibraryLon}
                        onDragEnd={(event: MarkerDragEvent) => {
                          setEditingLibraryLat(event.lngLat.lat);
                          setEditingLibraryLon(event.lngLat.lng);
                        }}
                      >
                        <div className="site-pin library-edit-pin">
                          <span>{editingLibraryName.trim() || "Site"}</span>
                        </div>
                      </Marker>
                    </Map>
                  </div>
                </div>
                <div className="chip-group">
                  <button className="inline-action" onClick={saveLibraryEdit} type="button">
                    Save
                  </button>
                  <button className="inline-action" onClick={() => setEditingLibraryId(null)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </ModalOverlay>
      ) : null}
      <div className="sidebar-grow" />
    </aside>
  );
}
