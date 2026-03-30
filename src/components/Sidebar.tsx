import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CircleX, Copyright, Funnel, Handshake, HatGlasses, Map as MapIcon, RefreshCw } from "lucide-react";
import Map, {
  Layer,
  Marker,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MarkerDragEvent,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { t } from "../i18n/locales";
import { fetchElevations } from "../lib/elevationService";
import { FREQUENCY_PRESETS } from "../lib/frequencyPlans";
import { searchLocations, type GeocodeResult } from "../lib/geocode";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { buildLabelForChannel } from "../lib/buildInfo";
import { getBasemapProviderCapabilities, resolveBasemapSelection } from "../lib/basemaps";
import { parseDeepLinkFromLocation } from "../lib/deepLink";
import {
  fetchCollaboratorDirectory,
  fetchResourceChanges,
  revertResourceChangeCopy,
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
import { resolveLinkRadio, STANDARD_SITE_RADIO } from "../lib/linkRadio";
import { sampleSrtmElevation } from "../lib/srtm";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  filterAndSortLibraryItems,
  parsePersistedLibraryFilterState,
  serializeLibraryFilterState,
  type LibraryFilterRole,
  type LibraryFilterSource,
  type LibraryFilterState,
  type LibraryFilterVisibility,
} from "../lib/libraryFilters";
import { getUiErrorMessage } from "../lib/uiError";
import { formatDate, formatNumber } from "../lib/locale";
import { useAppStore } from "../store/appStore";
import type { CoverageMode, PropagationModel, RadioClimate } from "../types/radio";
import { siGithub } from "simple-icons";
import { InfoTip } from "./InfoTip";
import { ModalOverlay } from "./ModalOverlay";
import SimulationLibraryPanel from "./SimulationLibraryPanel";
import { UserAdminPanel } from "./UserAdminPanel";

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

const RADIO_CLIMATE_OPTIONS: RadioClimate[] = [
  "Equatorial",
  "Continental Subtropical",
  "Maritime Subtropical",
  "Desert",
  "Continental Temperate",
  "Maritime Temperate (Land)",
  "Maritime Temperate (Sea)",
];

const meshmapNodesLayer = (color: string, strokeColor: string): LayerProps => ({
  id: "meshmap-nodes-layer",
  type: "circle",
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 4, 12, 6],
    "circle-color": color,
    "circle-opacity": 0.82,
    "circle-stroke-width": 1,
    "circle-stroke-color": strokeColor,
  },
});

const meshmapLabelsLayer = (color: string, haloColor: string): LayerProps => ({
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
    "text-color": color,
    "text-halo-color": haloColor,
    "text-halo-width": 1.3,
  },
});

const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";
const SITE_LIBRARY_FILTERS_KEY = "rmw-site-library-filters-v1";

const hasDeepLinkSimulationInSearch = (search: string, pathname: string): boolean =>
  parseDeepLinkFromLocation({ search, pathname }).ok;

const ROLE_FILTER_OPTIONS: Array<{ key: LibraryFilterRole; label: string }> = [
  { key: "owned", label: "Owned" },
  { key: "collaborator", label: "Collaborator" },
  { key: "editable", label: "Editable" },
  { key: "viewOnly", label: "View-only" },
];

const VISIBILITY_FILTER_OPTIONS: Array<{ key: LibraryFilterVisibility; label: string }> = [
  { key: "private", label: "Private" },
  { key: "sharedPublic", label: "Shared/Public" },
];
const SITE_SOURCE_FILTER_OPTIONS: Array<{ key: LibraryFilterSource; label: string }> = [
  { key: "manual", label: "Manual" },
  { key: "mqtt", label: "MQTT" },
];
const ALL_ROLE_FILTERS = ROLE_FILTER_OPTIONS.map((option) => option.key);
const ALL_VISIBILITY_FILTERS = VISIBILITY_FILTER_OPTIONS.map((option) => option.key);
const ALL_SITE_SOURCE_FILTERS = SITE_SOURCE_FILTER_OPTIONS.map((option) => option.key);

type SiteFilterGroupKey = "role" | "visibility" | "source";

const readLibraryFilterState = (key: string): LibraryFilterState => {
  try {
    return parsePersistedLibraryFilterState(localStorage.getItem(key), DEFAULT_LIBRARY_FILTER_STATE);
  } catch {
    return DEFAULT_LIBRARY_FILTER_STATE;
  }
};

const persistLibraryFilterState = (key: string, state: LibraryFilterState): void => {
  try {
    localStorage.setItem(key, serializeLibraryFilterState(state));
  } catch {
    // Best effort only.
  }
};

const effectiveSelection = <T extends string>(selected: T[], allValues: T[]): T[] =>
  selected.length ? selected : allValues;

const selectionLabel = <T extends string>(selected: T[], allValues: T[]): string => {
  const effective = effectiveSelection(selected, allValues);
  return `${effective.length}/${allValues.length}`;
};

const selectionIsFiltered = <T extends string>(selected: T[], allValues: T[]): boolean => {
  const effective = effectiveSelection(selected, allValues);
  return effective.length !== allValues.length;
};

const formatChangeSummary = (action: string, note: string | null): string => {
  if (note && note.trim()) return note;
  if (action === "created") return "Created record.";
  if (action === "updated") return "Updated record.";
  return "Change recorded.";
};

const formatChangeDetailValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const isMeaningfulChangeField = (field: string): boolean => {
  const normalized = field.trim();
  if (!normalized) return false;
  const ignored = new Set([
    "content",
    "updatedAt",
    "updated_at",
    "lastEditedAt",
    "last_edited_at",
    "lastEditedByUserId",
    "last_edited_by_user_id",
    "lastEditedByName",
    "lastEditedByAvatarUrl",
    "createdAt",
    "created_at",
    "slugAliases",
    "slug_aliases",
  ]);
  return !ignored.has(normalized);
};

const formatMqttSourceMeta = (value: unknown): string[] => {
  if (!value || typeof value !== "object") return [];
  const meta = value as {
    sourceType?: unknown;
    sourceUrl?: unknown;
    nodeId?: unknown;
    longName?: unknown;
    shortName?: unknown;
    hwModel?: unknown;
    role?: unknown;
    importedAt?: unknown;
    syncedAt?: unknown;
  };
  if (meta.sourceType !== "mqtt-feed") return [];
  const asString = (input: unknown): string => (typeof input === "string" ? input.trim() : "");
  const lines = [
    asString(meta.longName) ? `Long name: ${asString(meta.longName)}` : "",
    asString(meta.shortName) ? `Short name: ${asString(meta.shortName)}` : "",
    asString(meta.nodeId) ? `Node ID: ${asString(meta.nodeId)}` : "",
    asString(meta.hwModel) ? `HW model: ${asString(meta.hwModel)}` : "",
    asString(meta.role) ? `Role: ${asString(meta.role)}` : "",
    asString(meta.sourceUrl) ? `Source URL: ${asString(meta.sourceUrl)}` : "",
    asString(meta.importedAt) ? `Imported: ${formatDate(asString(meta.importedAt))}` : "",
    asString(meta.syncedAt) ? `Synced: ${formatDate(asString(meta.syncedAt))}` : "",
  ].filter(Boolean);
  return lines;
};

type SidebarProps = {
  onOpenHelp?: () => void;
};

export function Sidebar({ onOpenHelp }: SidebarProps) {
  const { theme, colorTheme, variant } = useThemeVariant();
  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const envBadgeLabel = runtimeEnvironment === "local" ? "LOCAL" : runtimeEnvironment === "staging" ? "STAGING" : "";
  const buildChannel = runtimeEnvironment === "production" ? "stable" : runtimeEnvironment === "staging" ? "beta" : "alpha";
  const buildLabel = buildLabelForChannel(buildChannel);
  const links = useAppStore((state) => state.links);
  const sites = useAppStore((state) => state.sites);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const selectedSiteIds = useAppStore((state) => state.selectedSiteIds);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const selectedCoverageMode = useAppStore((state) => state.selectedCoverageMode);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const propagationEnvironmentReason = useAppStore((state) => state.propagationEnvironmentReason);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const scenarioOptions = useAppStore((state) => state.scenarioOptions);
  const locale = useAppStore((state) => state.locale);
  const networks = useAppStore((state) => state.networks);
  const selectScenario = useAppStore((state) => state.selectScenario);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const selectSiteById = useAppStore((state) => state.selectSiteById);
  const setSelectedNetworkId = useAppStore((state) => state.setSelectedNetworkId);
  const setSelectedCoverageMode = useAppStore((state) => state.setSelectedCoverageMode);
  const setSelectedFrequencyPresetId = useAppStore((state) => state.setSelectedFrequencyPresetId);
  const basemapProvider = useAppStore((state) => state.basemapProvider);
  const basemapStylePreset = useAppStore((state) => state.basemapStylePreset);
  const setBasemapProvider = useAppStore((state) => state.setBasemapProvider);
  const setBasemapStylePreset = useAppStore((state) => state.setBasemapStylePreset);
  const setAutoPropagationEnvironment = useAppStore((state) => state.setAutoPropagationEnvironment);
  const setPropagationEnvironment = useAppStore((state) => state.setPropagationEnvironment);
  const applyClimateDefaults = useAppStore((state) => state.applyClimateDefaults);
  const pendingSiteLibraryDraft = useAppStore((state) => state.pendingSiteLibraryDraft);
  const clearPendingSiteLibraryDraft = useAppStore((state) => state.clearPendingSiteLibraryDraft);
  const pendingSiteLibraryOpenEntryId = useAppStore((state) => state.pendingSiteLibraryOpenEntryId);
  const clearOpenSiteLibraryEntryRequest = useAppStore((state) => state.clearOpenSiteLibraryEntryRequest);
  const applyFrequencyPresetToSelectedNetwork = useAppStore(
    (state) => state.applyFrequencyPresetToSelectedNetwork,
  );
  const setPropagationModel = useAppStore((state) => state.setPropagationModel);
  const updateLink = useAppStore((state) => state.updateLink);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const insertSitesFromLibrary = useAppStore((state) => state.insertSitesFromLibrary);
  const updateSiteLibraryEntry = useAppStore((state) => state.updateSiteLibraryEntry);
  const deleteSiteLibraryEntries = useAppStore((state) => state.deleteSiteLibraryEntries);
  const deleteSimulationPreset = useAppStore((state) => state.deleteSimulationPreset);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const createLink = useAppStore((state) => state.createLink);
  const deleteLink = useAppStore((state) => state.deleteLink);
  const addSiteLibraryEntry = useAppStore((state) => state.addSiteLibraryEntry);
  const saveCurrentSimulationPreset = useAppStore((state) => state.saveCurrentSimulationPreset);
  const createBlankSimulationPreset = useAppStore((state) => state.createBlankSimulationPreset);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const updateSimulationPresetEntry = useAppStore((state) => state.updateSimulationPresetEntry);
  const getSelectedLink = useAppStore((state) => state.getSelectedLink);
  const getSelectedSite = useAppStore((state) => state.getSelectedSite);
  const getSelectedNetwork = useAppStore((state) => state.getSelectedNetwork);
  const model = useAppStore((state) => state.propagationModel);
  const showSimulationLibraryRequest = useAppStore((state) => state.showSimulationLibraryRequest);
  const setShowSimulationLibraryRequest = useAppStore((state) => state.setShowSimulationLibraryRequest);
  const showNewSimulationRequest = useAppStore((state) => state.showNewSimulationRequest);
  const setShowNewSimulationRequest = useAppStore((state) => state.setShowNewSimulationRequest);
  const showSiteLibraryRequest = useAppStore((state) => state.showSiteLibraryRequest);
  const setShowSiteLibraryRequest = useAppStore((state) => state.setShowSiteLibraryRequest);
  const selectedLink = useMemo(
    () => getSelectedLink(),
    [getSelectedLink, links, selectedLinkId, sites, networks, selectedNetworkId],
  );
  const selectedSite = useMemo(() => getSelectedSite(), [getSelectedSite, sites, selectedSiteId]);
  const selectedNetwork = useMemo(
    () => getSelectedNetwork(),
    [getSelectedNetwork, networks, selectedNetworkId],
  );
  const selectedLinkRaw = links.find((link) => link.id === selectedLink.id) ?? null;
  const fromSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const toSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const sourceSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapProvider, basemapStylePreset, theme, colorTheme),
    [basemapProvider, basemapStylePreset, theme, colorTheme],
  );
  const providerCapabilities = useMemo(() => getBasemapProviderCapabilities(), []);
  const globalProviders = useMemo(
    () => providerCapabilities.filter((entry) => entry.group === "global"),
    [providerCapabilities],
  );
  const regionalProviders = useMemo(
    () => providerCapabilities.filter((entry) => entry.group === "regional"),
    [providerCapabilities],
  );
  const activeProviderConfig =
    providerCapabilities.find((entry) => entry.provider === resolvedBasemap.provider) ?? providerCapabilities[0];
  const resolvedPresetOptions = activeProviderConfig?.presets ?? [];
  const styleSelectValue =
    resolvedPresetOptions.length <= 1
      ? resolvedPresetOptions[0]?.id ?? basemapStylePreset
      : basemapStylePreset;
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
  const [showNewSimulationModal, setShowNewSimulationModal] = useState(false);
  const [newSimulationName, setNewSimulationName] = useState("");
  const [newSimulationDescription, setNewSimulationDescription] = useState("");
  const [newSimulationNameError, setNewSimulationNameError] = useState("");
  const [newSimulationVisibility, setNewSimulationVisibility] = useState<"private" | "shared">("private");
  const [showSimulationLibraryManager, setShowSimulationLibraryManager] = useState(false);
  const [linkModal, setLinkModal] = useState<{
    mode: "add" | "edit";
    linkId: string | null;
    name: string;
    fromSiteId: string;
    toSiteId: string;
    overrideRadio: boolean;
    txPowerDbm: number;
    txGainDbi: number;
    rxGainDbi: number;
    cableLossDb: number;
    status: string;
  } | null>(null);
  const [showSiteLibraryManager, setShowSiteLibraryManager] = useState(false);
  const [siteLibraryFilters, setSiteLibraryFilters] = useState<LibraryFilterState>(() =>
    readLibraryFilterState(SITE_LIBRARY_FILTERS_KEY),
  );
  const [openSiteFilterGroup, setOpenSiteFilterGroup] = useState<SiteFilterGroupKey | null>(null);
  const [siteRoleDraft, setSiteRoleDraft] = useState<LibraryFilterRole[] | null>(null);
  const [siteVisibilityDraft, setSiteVisibilityDraft] = useState<LibraryFilterVisibility[] | null>(null);
  const [siteSourceDraft, setSiteSourceDraft] = useState<LibraryFilterSource[] | null>(null);
  const siteFilterToolbarRef = useRef<HTMLDivElement | null>(null);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [showAddLibraryForm, setShowAddLibraryForm] = useState(false);
  const [pendingDraftAutoInsert, setPendingDraftAutoInsert] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryDescription, setNewLibraryDescription] = useState("");
  const [newLibraryNameError, setNewLibraryNameError] = useState("");
  const [newLibrarySourceMeta, setNewLibrarySourceMeta] = useState<unknown>(undefined);
  const [newLibraryLat, setNewLibraryLat] = useState(60.0);
  const [newLibraryLon, setNewLibraryLon] = useState(10.0);
  const [newLibraryGroundM, setNewLibraryGroundM] = useState(0);
  const [newLibraryAntennaM, setNewLibraryAntennaM] = useState(2);
  const [newLibraryTxPowerDbm, setNewLibraryTxPowerDbm] = useState(STANDARD_SITE_RADIO.txPowerDbm);
  const [newLibraryTxGainDbi, setNewLibraryTxGainDbi] = useState(STANDARD_SITE_RADIO.txGainDbi);
  const [newLibraryRxGainDbi, setNewLibraryRxGainDbi] = useState(STANDARD_SITE_RADIO.rxGainDbi);
  const [newLibraryCableLossDb, setNewLibraryCableLossDb] = useState(STANDARD_SITE_RADIO.cableLossDb);
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
  const hasDeepLinkSimulation = useMemo(
    () => hasDeepLinkSimulationInSearch(window.location.search, window.location.pathname),
    [],
  );
  const [selectedSimulationRef, setSelectedSimulationRef] = useState<string>(() => {
    if (hasDeepLinkSimulationInSearch(window.location.search, window.location.pathname)) {
      return "";
    }
    try {
      const stored = localStorage.getItem(LAST_SIMULATION_REF_KEY);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    } catch {
      // ignore
    }
    if (selectedScenarioId && simulationPresets.some((preset) => preset.id === selectedScenarioId)) {
      return `saved:${selectedScenarioId}`;
    }
    return "";
  });
  const persistSelectedSimulationRef = (ref: string) => {
    const normalizedRef = ref.trim();
    if (normalizedRef === selectedSimulationRef) return;
    setSelectedSimulationRef(normalizedRef);
    try {
      if (normalizedRef) {
        localStorage.setItem(LAST_SIMULATION_REF_KEY, normalizedRef);
      } else {
        localStorage.removeItem(LAST_SIMULATION_REF_KEY);
      }
    } catch {
      // ignore
    }
  };
  const [startupSimulationApplied, setStartupSimulationApplied] = useState(false);
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
  const [resourceNameDraft, setResourceNameDraft] = useState("");
  const [resourceDescriptionDraft, setResourceDescriptionDraft] = useState("");
  const [resourceLatDraft, setResourceLatDraft] = useState(0);
  const [resourceLonDraft, setResourceLonDraft] = useState(0);
  const [resourceGroundDraft, setResourceGroundDraft] = useState(0);
  const [resourceAntennaDraft, setResourceAntennaDraft] = useState(2);
  const [resourceTxPowerDraft, setResourceTxPowerDraft] = useState(STANDARD_SITE_RADIO.txPowerDbm);
  const [resourceTxGainDraft, setResourceTxGainDraft] = useState(STANDARD_SITE_RADIO.txGainDbi);
  const [resourceRxGainDraft, setResourceRxGainDraft] = useState(STANDARD_SITE_RADIO.rxGainDbi);
  const [resourceCableLossDraft, setResourceCableLossDraft] = useState(STANDARD_SITE_RADIO.cableLossDb);
  const [resourceCollaboratorUserIds, setResourceCollaboratorUserIds] = useState<string[]>([]);
  const [resourceCollaboratorQuery, setResourceCollaboratorQuery] = useState("");
  const [resourceCollaboratorDirectory, setResourceCollaboratorDirectory] = useState<CollaboratorDirectoryUser[]>([]);
  const [resourceCollaboratorDirectoryBusy, setResourceCollaboratorDirectoryBusy] = useState(false);
  const [resourceCollaboratorDirectoryStatus, setResourceCollaboratorDirectoryStatus] = useState("");
  const [resourceAccessStatus, setResourceAccessStatus] = useState("");
  const currentUser = useAppStore((state) => state.currentUser);
  const [pendingSimulationVisibilityPrompt, setPendingSimulationVisibilityPrompt] = useState<{
    simulationId: string;
    targetVisibility: "public" | "shared";
    referencedPrivateSiteIds: string[];
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const currentUserId = currentUser?.id ?? null;
  const toggleValue = <T extends string>(values: T[], key: T): T[] =>
    values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
  const commitSiteRoleFilters = (roleFilters: LibraryFilterRole[]) => {
    if (!roleFilters.length) return;
    setSiteLibraryFilters((state) => ({ ...state, roleFilters }));
    setOpenSiteFilterGroup(null);
  };
  const commitSiteVisibilityFilters = (visibilityFilters: LibraryFilterVisibility[]) => {
    if (!visibilityFilters.length) return;
    setSiteLibraryFilters((state) => ({ ...state, visibilityFilters }));
    setOpenSiteFilterGroup(null);
  };
  const commitSiteSourceFilters = (sourceFilters: LibraryFilterSource[]) => {
    if (!sourceFilters.length) return;
    setSiteLibraryFilters((state) => ({ ...state, sourceFilters }));
    setOpenSiteFilterGroup(null);
  };
  const openSiteRoleEditor = () => {
    setSiteRoleDraft(effectiveSelection(siteLibraryFilters.roleFilters, ALL_ROLE_FILTERS));
    setOpenSiteFilterGroup((current) => (current === "role" ? null : "role"));
  };
  const openSiteVisibilityEditor = () => {
    setSiteVisibilityDraft(effectiveSelection(siteLibraryFilters.visibilityFilters, ALL_VISIBILITY_FILTERS));
    setOpenSiteFilterGroup((current) => (current === "visibility" ? null : "visibility"));
  };
  const openSiteSourceEditor = () => {
    setSiteSourceDraft(effectiveSelection(siteLibraryFilters.sourceFilters, ALL_SITE_SOURCE_FILTERS));
    setOpenSiteFilterGroup((current) => (current === "source" ? null : "source"));
  };
  const closeSiteFilterEditors = () => {
    setOpenSiteFilterGroup(null);
    setSiteRoleDraft(null);
    setSiteVisibilityDraft(null);
    setSiteSourceDraft(null);
  };
  const filteredSiteLibrary = useMemo(() => {
    return filterAndSortLibraryItems(
      siteLibrary,
      siteLibraryFilters,
      currentUserId,
      (entry) => `${entry.name} ${entry.position.lat.toFixed(5)} ${entry.position.lon.toFixed(5)}`,
      (entry, source) =>
        source === "mqtt"
          ? entry.sourceMeta?.sourceType === "mqtt-feed"
          : entry.sourceMeta?.sourceType !== "mqtt-feed",
    );
  }, [siteLibrary, siteLibraryFilters, currentUserId]);
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
  useEffect(() => {
    if (showSimulationLibraryRequest) {
      setShowSimulationLibraryManager(true);
      setShowSimulationLibraryRequest(false);
    }
  }, [showSimulationLibraryRequest, setShowSimulationLibraryRequest]);
  useEffect(() => {
    if (showNewSimulationRequest) {
      setNewSimulationName("");
      setNewSimulationDescription("");
      setNewSimulationNameError("");
      setShowNewSimulationModal(true);
      setShowNewSimulationRequest(false);
    }
  }, [showNewSimulationRequest, setShowNewSimulationRequest]);
  useEffect(() => {
    if (showSiteLibraryRequest) {
      setShowSiteLibraryManager(true);
      setShowSiteLibraryRequest(false);
    }
  }, [showSiteLibraryRequest, setShowSiteLibraryRequest]);
  useEffect(() => {
    persistLibraryFilterState(SITE_LIBRARY_FILTERS_KEY, siteLibraryFilters);
  }, [siteLibraryFilters]);
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (openSiteFilterGroup && siteFilterToolbarRef.current && !siteFilterToolbarRef.current.contains(target)) {
        closeSiteFilterEditors();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeSiteFilterEditors();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openSiteFilterGroup]);
  const activeSimulationLabel = useMemo(() => {
    if (selectedSimulationRef.startsWith("saved:")) {
      const presetId = selectedSimulationRef.replace("saved:", "");
      const preset = simulationPresets.find((candidate) => candidate.id === presetId);
      return preset ? `${preset.name}` : "Saved simulation";
    }
    if (!selectedSimulationRef.trim()) {
      return "no simulation selected";
    }
    const simulationId = selectedSimulationRef.replace("builtin:", "");
    const simulation = scenarioOptions.find((candidate) => candidate.id === simulationId);
    return simulation ? `${simulation.name}` : "no simulation selected";
  }, [selectedSimulationRef, simulationPresets, scenarioOptions]);
  const activeSimulationVisibility = useMemo<"private" | "public" | "shared">(() => {
    if (!selectedSimulationRef.startsWith("saved:")) return "shared";
    const presetId = selectedSimulationRef.replace("saved:", "");
    const preset = simulationPresets.find((candidate) => candidate.id === presetId);
    return normalizeAccessVisibility(preset?.visibility);
  }, [selectedSimulationRef, simulationPresets]);
  const openActiveSimulationDetails = () => {
    if (!selectedSimulationRef.startsWith("saved:")) return;
    const presetId = selectedSimulationRef.replace("saved:", "");
    const preset = simulationPresets.find((p) => p.id === presetId);
    if (!preset) return;
    openResourceDetailsPopup({
      kind: "simulation",
      resourceId: preset.id,
      label: preset.name,
      createdByUserId: (preset as unknown as { createdByUserId?: string }).createdByUserId ?? null,
      createdByName: (preset as unknown as { createdByName?: string }).createdByName ?? "Unknown",
      createdByAvatarUrl: (preset as unknown as { createdByAvatarUrl?: string }).createdByAvatarUrl ?? "",
      lastEditedByUserId: (preset as unknown as { lastEditedByUserId?: string }).lastEditedByUserId ?? null,
      lastEditedByName: (preset as unknown as { lastEditedByName?: string }).lastEditedByName ?? "Unknown",
      lastEditedByAvatarUrl: (preset as unknown as { lastEditedByAvatarUrl?: string }).lastEditedByAvatarUrl ?? "",
    });
  };
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
  const resolveOwnerDisplay = (
    ownerUserId: string | undefined,
    fallbackName: string | undefined,
    fallbackAvatarUrl: string | undefined,
  ): { name: string; avatarUrl: string } => {
    const ownerFromDirectory = ownerUserId ? collaboratorDirectoryById.get(ownerUserId) : undefined;
    const name =
      ownerFromDirectory?.username ||
      (fallbackName && fallbackName.trim() && fallbackName.trim() !== "Unknown" ? fallbackName : "") ||
      ownerUserId ||
      "Unknown";
    const avatarUrl = ownerFromDirectory?.avatarUrl || fallbackAvatarUrl || "";
    return { name, avatarUrl };
  };
  const currentResourceOwnerId = useMemo(() => {
    if (!resourceDetailsPopup) return "";
    if (resourceDetailsPopup.kind === "site") {
      return (
        siteLibrary.find((entry) => entry.id === resourceDetailsPopup.resourceId)?.ownerUserId ?? ""
      );
    }
    return (
      simulationPresets.find((entry) => entry.id === resourceDetailsPopup.resourceId)?.ownerUserId ?? ""
    );
  }, [resourceDetailsPopup, siteLibrary, simulationPresets]);
  const currentResourceSiteEntry = useMemo(() => {
    if (!resourceDetailsPopup || resourceDetailsPopup.kind !== "site") return null;
    return siteLibrary.find((entry) => entry.id === resourceDetailsPopup.resourceId) ?? null;
  }, [resourceDetailsPopup, siteLibrary]);
  const currentResourceMqttMetaLines = useMemo(
    () => formatMqttSourceMeta((currentResourceSiteEntry as { sourceMeta?: unknown } | null)?.sourceMeta),
    [currentResourceSiteEntry],
  );
  const canWriteResource = (kind: "site" | "simulation", resourceId: string): boolean => {
    const entry =
      kind === "site"
        ? siteLibrary.find((candidate) => candidate.id === resourceId)
        : simulationPresets.find((candidate) => candidate.id === resourceId);
    if (!entry) return false;
    const role = (entry as { effectiveRole?: unknown }).effectiveRole;
    return role === "owner" || role === "admin" || role === "editor";
  };
  const resourceCanWrite = useMemo(() => {
    if (!resourceDetailsPopup) return false;
    return canWriteResource(resourceDetailsPopup.kind, resourceDetailsPopup.resourceId);
  }, [resourceDetailsPopup, siteLibrary, simulationPresets]);
  const collaboratorCandidates = useMemo(() => {
    const q = resourceCollaboratorQuery.trim().toLowerCase();
    const selectedIds = new Set(resourceCollaboratorUserIds);
    const filtered = resourceCollaboratorDirectory.filter((user) => {
      if (currentResourceOwnerId && user.id === currentResourceOwnerId) return false;
      if (selectedIds.has(user.id)) return false;
      if (!q) return true;
      const hay = `${user.username} ${user.email}`.toLowerCase();
      return hay.includes(q);
    });
    return filtered.slice(0, 30);
  }, [currentResourceOwnerId, resourceCollaboratorDirectory, resourceCollaboratorUserIds, resourceCollaboratorQuery]);
  useEffect(() => {
    if (selectedSimulationRef.startsWith("saved:")) {
      const presetId = selectedSimulationRef.replace("saved:", "");
      const exists = simulationPresets.some((preset) => preset.id === presetId);
      if (!exists) {
        persistSelectedSimulationRef("");
      }
      return;
    }
    if (selectedSimulationRef.startsWith("builtin:")) {
      const scenarioId = selectedSimulationRef.replace("builtin:", "");
      const exists = scenarioOptions.some((scenario) => scenario.id === scenarioId);
      if (!exists) {
        persistSelectedSimulationRef("");
      }
    }
  }, [selectedSimulationRef, simulationPresets, scenarioOptions]);
  useEffect(() => {
    if (!selectedScenarioId) return;
    const savedMatch = simulationPresets.some((preset) => preset.id === selectedScenarioId);
    if (savedMatch) {
      persistSelectedSimulationRef(`saved:${selectedScenarioId}`);
      return;
    }
    const scenarioMatch = scenarioOptions.some((scenario) => scenario.id === selectedScenarioId);
    if (scenarioMatch) {
      persistSelectedSimulationRef(`builtin:${selectedScenarioId}`);
    }
  }, [selectedScenarioId, simulationPresets, scenarioOptions]);
  useEffect(() => {
    if (!visibleLinks.length) return;
    if (!selectedLinkId) return;
    const stillVisible = visibleLinks.some((link) => link.id === selectedLinkId);
    if (stillVisible) return;
    setSelectedLinkId(visibleLinks[0].id);
  }, [selectedLinkId, setSelectedLinkId, visibleLinks]);
  useEffect(() => {
    let canceled = false;
    const loadDirectory = () => {
      if (canceled) return;
      void fetchCollaboratorDirectory()
        .then((users) => {
          if (canceled) return;
          setResourceCollaboratorDirectory(users);
        })
        .catch(() => {
          // Best effort for row avatar labels; detailed errors are shown in edit modal fetches.
        });
    };
    if (typeof requestIdleCallback === "function") {
      const idleId = requestIdleCallback(() => loadDirectory(), { timeout: 2000 });
      return () => {
        canceled = true;
        cancelIdleCallback(idleId);
      };
    }
    const timerId = window.setTimeout(loadDirectory, 500);
    return () => {
      canceled = true;
      window.clearTimeout(timerId);
    };
  }, []);
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
    setNewLibraryNameError("");
    setNewLibrarySourceMeta(pendingSiteLibraryDraft.sourceMeta);
    setPendingDraftAutoInsert(true);
    setNewLibraryName(pendingSiteLibraryDraft.suggestedName ?? "");
    setNewLibraryDescription("");
    setNewLibraryLat(pendingSiteLibraryDraft.lat);
    setNewLibraryLon(pendingSiteLibraryDraft.lon);
    const terrainElev = Number(
      sampleSrtmElevation(srtmTiles, pendingSiteLibraryDraft.lat, pendingSiteLibraryDraft.lon),
    );
    if (Number.isFinite(terrainElev)) {
      setNewLibraryGroundM(Math.round(terrainElev));
      setLibrarySearchStatus(
        `Draft opened at ${pendingSiteLibraryDraft.lat.toFixed(5)}, ${pendingSiteLibraryDraft.lon.toFixed(5)} (terrain ${Math.round(terrainElev)} m).`,
      );
    } else {
      setLibrarySearchStatus(
        `Draft opened at ${pendingSiteLibraryDraft.lat.toFixed(5)}, ${pendingSiteLibraryDraft.lon.toFixed(5)}.`,
      );
    }
    clearPendingSiteLibraryDraft();
  }, [pendingSiteLibraryDraft, srtmTiles, clearPendingSiteLibraryDraft]);
  useEffect(() => {
    if (!pendingSiteLibraryOpenEntryId) return;
    const entry = siteLibrary.find((candidate) => candidate.id === pendingSiteLibraryOpenEntryId);
    setShowSiteLibraryManager(true);
    if (entry) {
      openResourceDetailsPopup({
        kind: "site",
        resourceId: entry.id,
        label: entry.name,
        createdByUserId: (entry as unknown as { createdByUserId?: string }).createdByUserId ?? null,
        createdByName: (entry as unknown as { createdByName?: string }).createdByName ?? "Unknown",
        createdByAvatarUrl: (entry as unknown as { createdByAvatarUrl?: string }).createdByAvatarUrl ?? "",
        lastEditedByUserId: (entry as unknown as { lastEditedByUserId?: string }).lastEditedByUserId ?? null,
        lastEditedByName: (entry as unknown as { lastEditedByName?: string }).lastEditedByName ?? "Unknown",
        lastEditedByAvatarUrl: (entry as unknown as { lastEditedByAvatarUrl?: string }).lastEditedByAvatarUrl ?? "",
      });
    }
    clearOpenSiteLibraryEntryRequest();
  }, [pendingSiteLibraryOpenEntryId, siteLibrary, clearOpenSiteLibraryEntryRequest]);

  const onModelChange = (next: PropagationModel) => {
    setPropagationModel(next);
  };

  const onCoverageModeChange = (mode: CoverageMode) => {
    setSelectedCoverageMode(mode);
  };

  useEffect(() => {
    if (startupSimulationApplied) return;
    if (hasDeepLinkSimulation) {
      setStartupSimulationApplied(true);
      return;
    }
    if (!selectedSimulationRef.trim()) {
      setStartupSimulationApplied(true);
      return;
    }
    if (selectedSimulationRef.startsWith("builtin:")) {
      const scenarioId = selectedSimulationRef.replace("builtin:", "");
      if (scenarioOptions.some((scenario) => scenario.id === scenarioId)) {
        selectScenario(scenarioId);
      }
    } else if (selectedSimulationRef.startsWith("saved:")) {
      const presetId = selectedSimulationRef.replace("saved:", "");
      if (simulationPresets.some((preset) => preset.id === presetId)) {
        loadSimulationPreset(presetId);
      }
    }
    setStartupSimulationApplied(true);
  }, [
    hasDeepLinkSimulation,
    startupSimulationApplied,
    selectedSimulationRef,
    scenarioOptions,
    simulationPresets,
    selectScenario,
    loadSimulationPreset,
  ]);

  const requestDeleteConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel = "Delete",
  ) => {
    setDeleteConfirm({ title, message, confirmLabel, onConfirm });
  };

  const openAddLinkModal = () => {
    const hasFromInSites = sites.some((site) => site.id === selectedLink.fromSiteId);
    const hasToInSites = sites.some((site) => site.id === selectedLink.toSiteId);
    const fallbackFrom = hasFromInSites ? selectedLink.fromSiteId : sites[0]?.id || "";
    const fallbackTo = hasToInSites
      ? selectedLink.toSiteId
      : sites.find((site) => site.id !== fallbackFrom)?.id || "";
    const fallbackFromSite = sites.find((site) => site.id === fallbackFrom) ?? selectedSite;
    const fallbackToSite = sites.find((site) => site.id === fallbackTo) ?? fallbackFromSite;
    const baseRadio = resolveLinkRadio(selectedLink, fallbackFromSite, fallbackToSite);
    setLinkModal({
      mode: "add",
      linkId: null,
      name: "",
      fromSiteId: fallbackFrom,
      toSiteId: fallbackTo,
      overrideRadio: false,
      txPowerDbm: baseRadio.txPowerDbm,
      txGainDbi: baseRadio.txGainDbi,
      rxGainDbi: baseRadio.rxGainDbi,
      cableLossDb: baseRadio.cableLossDb,
      status: "",
    });
  };

  const openEditLinkModal = () => {
    const fromSite = sites.find((site) => site.id === selectedLink.fromSiteId) ?? null;
    const toSite = sites.find((site) => site.id === selectedLink.toSiteId) ?? null;
    const baseRadio = resolveLinkRadio(selectedLink, fromSite, toSite);
    const hasOverrides = Boolean(
      selectedLinkRaw &&
        (typeof selectedLinkRaw.txPowerDbm === "number" ||
          typeof selectedLinkRaw.txGainDbi === "number" ||
          typeof selectedLinkRaw.rxGainDbi === "number" ||
          typeof selectedLinkRaw.cableLossDb === "number"),
    );
    setLinkModal({
      mode: "edit",
      linkId: selectedLink.id,
      name: selectedLink.name ?? "",
      fromSiteId: selectedLink.fromSiteId,
      toSiteId: selectedLink.toSiteId,
      overrideRadio: hasOverrides,
      txPowerDbm: baseRadio.txPowerDbm,
      txGainDbi: baseRadio.txGainDbi,
      rxGainDbi: baseRadio.rxGainDbi,
      cableLossDb: baseRadio.cableLossDb,
      status: "",
    });
  };

  const saveLinkModal = () => {
    if (!linkModal) return;
    const fromExists = sites.some((site) => site.id === linkModal.fromSiteId);
    const toExists = sites.some((site) => site.id === linkModal.toSiteId);
    if (!fromExists || !toExists) {
      setLinkModal((current) =>
        current ? { ...current, status: "From/To must be valid current simulation sites." } : current,
      );
      return;
    }
    if (!linkModal.fromSiteId || !linkModal.toSiteId) {
      setLinkModal((current) => (current ? { ...current, status: "Select both From and To sites." } : current));
      return;
    }
    if (linkModal.fromSiteId === linkModal.toSiteId) {
      setLinkModal((current) => (current ? { ...current, status: "From and To must be different sites." } : current));
      return;
    }
    if (linkModal.mode === "add") {
      const beforeCount = links.length;
      createLink(linkModal.fromSiteId, linkModal.toSiteId, linkModal.name);
      const afterState = useAppStore.getState();
      const createdId = afterState.selectedLinkId;
      if (afterState.links.length <= beforeCount) {
        setLinkModal((current) =>
          current ? { ...current, status: "Failed to create link. Verify site selection and try again." } : current,
        );
        return;
      }
      if (createdId) {
        updateLink(createdId, {
          name: linkModal.name.trim() || undefined,
          fromSiteId: linkModal.fromSiteId,
          toSiteId: linkModal.toSiteId,
          txPowerDbm: linkModal.overrideRadio ? linkModal.txPowerDbm : undefined,
          txGainDbi: linkModal.overrideRadio ? linkModal.txGainDbi : undefined,
          rxGainDbi: linkModal.overrideRadio ? linkModal.rxGainDbi : undefined,
          cableLossDb: linkModal.overrideRadio ? linkModal.cableLossDb : undefined,
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
      txPowerDbm: linkModal.overrideRadio ? linkModal.txPowerDbm : undefined,
      txGainDbi: linkModal.overrideRadio ? linkModal.txGainDbi : undefined,
      rxGainDbi: linkModal.overrideRadio ? linkModal.rxGainDbi : undefined,
      cableLossDb: linkModal.overrideRadio ? linkModal.cableLossDb : undefined,
    });
    setLinkModal(null);
  };
  const saveSimulationAsNew = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      setSimulationSaveStatus("");
      return;
    }
    const savedId = saveCurrentSimulationPreset(trimmed);
    if (savedId) {
      const ref = `saved:${savedId}`;
      persistSelectedSimulationRef(ref);
      setSimulationSaveStatus(`Saved copy: ${trimmed}`);
    }
    setNewPresetName("");
  };
  const createBlankSimulation = () => {
    if (!currentUser?.id) {
      setSimulationSaveStatus("Cannot create simulation until current user profile is loaded.");
      return;
    }
    const trimmed = newSimulationName.trim();
    if (!trimmed) {
      setNewSimulationNameError("A name is required.");
      setSimulationSaveStatus("");
      return;
    }
    setNewSimulationNameError("");
    const createdId = createBlankSimulationPreset(trimmed, {
      description: newSimulationDescription.trim() || undefined,
      visibility: newSimulationVisibility,
      ownerUserId: currentUser.id,
      createdByUserId: currentUser.id,
      createdByName: currentUser.username,
      createdByAvatarUrl: currentUser.avatarUrl ?? "",
      lastEditedByUserId: currentUser.id,
      lastEditedByName: currentUser.username,
      lastEditedByAvatarUrl: currentUser.avatarUrl ?? "",
    });
    if (!createdId) {
      setSimulationSaveStatus("Failed creating simulation.");
      return;
    }
    loadSimulationPreset(createdId);
    persistSelectedSimulationRef(`saved:${createdId}`);
    setSimulationSaveStatus(`Created simulation: ${trimmed}`);
    setNewSimulationName("");
    setNewSimulationDescription("");
    setShowNewSimulationModal(false);
  };
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const displayLinkName = (linkId: string, linkName?: string) => {
    const trimmedName = linkName?.trim();
    if (trimmedName) return trimmedName;
    const link = links.find((candidate) => candidate.id === linkId);
    if (!link) return linkId;
    const from = sites.find((site) => site.id === link.fromSiteId)?.name ?? "Unknown";
    const to = sites.find((site) => site.id === link.toSiteId)?.name ?? "Unknown";
    return `${from} ↔ ${to}`;
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
  const openLibraryForSelectedSite = () => {
    setShowSiteLibraryManager(true);
    const matchedEntry = siteLibrary.find(
      (entry) =>
        entry.name === selectedSite.name &&
        Math.abs(entry.position.lat - selectedSite.position.lat) < 0.000001 &&
        Math.abs(entry.position.lon - selectedSite.position.lon) < 0.000001,
    );
    if (matchedEntry) {
      openResourceDetailsPopup({
        kind: "site",
        resourceId: matchedEntry.id,
        label: matchedEntry.name,
        createdByUserId: (matchedEntry as unknown as { createdByUserId?: string }).createdByUserId ?? null,
        createdByName: (matchedEntry as unknown as { createdByName?: string }).createdByName ?? "Unknown",
        createdByAvatarUrl:
          (matchedEntry as unknown as { createdByAvatarUrl?: string }).createdByAvatarUrl ?? "",
        lastEditedByUserId:
          (matchedEntry as unknown as { lastEditedByUserId?: string }).lastEditedByUserId ?? null,
        lastEditedByName:
          (matchedEntry as unknown as { lastEditedByName?: string }).lastEditedByName ?? "Unknown",
        lastEditedByAvatarUrl:
          (matchedEntry as unknown as { lastEditedByAvatarUrl?: string }).lastEditedByAvatarUrl ?? "",
      });
      return;
    }
    setShowAddLibraryForm(true);
    setNewLibraryName("");
    setNewLibraryDescription("");
    setNewLibrarySourceMeta(undefined);
    setNewLibraryLat(selectedSite.position.lat);
    setNewLibraryLon(selectedSite.position.lon);
    setNewLibraryGroundM(selectedSite.groundElevationM);
    setNewLibraryAntennaM(selectedSite.antennaHeightM);
    setNewLibraryTxPowerDbm(selectedSite.txPowerDbm);
    setNewLibraryTxGainDbi(selectedSite.txGainDbi);
    setNewLibraryRxGainDbi(selectedSite.rxGainDbi);
    setNewLibraryCableLossDb(selectedSite.cableLossDb);
    setLibrarySearchStatus("Selected site is not in Site Library yet. Save to create a library entry.");
  };
  const addLibraryEntryNow = () => {
    if (!currentUser?.id) {
      setLibrarySearchStatus("Please log in to add sites to your library.");
      return;
    }
    if (!newLibraryName.trim()) {
      setNewLibraryNameError("A name is required.");
      setLibrarySearchStatus("");
      return;
    }
    setNewLibraryNameError("");
    const createdId = addSiteLibraryEntry(
      newLibraryName,
      newLibraryLat,
      newLibraryLon,
      newLibraryGroundM,
      newLibraryAntennaM,
      newLibraryTxPowerDbm,
      newLibraryTxGainDbi,
      newLibraryRxGainDbi,
      newLibraryCableLossDb,
      (newLibrarySourceMeta as Parameters<typeof addSiteLibraryEntry>[9]) ?? undefined,
      pendingDraftAutoInsert ? activeSimulationVisibility : "private",
      newLibraryDescription,
    );
    if (!createdId) {
      setNewLibraryNameError("A name is required.");
      setLibrarySearchStatus("");
      return;
    }
    if (pendingDraftAutoInsert && createdId) {
      insertSiteFromLibrary(createdId);
      setPendingDraftAutoInsert(false);
    }
    setNewLibraryNameError("");
    setNewLibraryName("");
    setNewLibraryDescription("");
    setNewLibrarySourceMeta(undefined);
    setNewLibraryTxPowerDbm(STANDARD_SITE_RADIO.txPowerDbm);
    setNewLibraryTxGainDbi(STANDARD_SITE_RADIO.txGainDbi);
    setNewLibraryRxGainDbi(STANDARD_SITE_RADIO.rxGainDbi);
    setNewLibraryCableLossDb(STANDARD_SITE_RADIO.cableLossDb);
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
  const runLibrarySearch = async () => {
    if (librarySearchQuery.trim().length < 3) {
      setLibrarySearchResults([]);
      setLibrarySearchStatus("Enter at least 3 characters to search.");
      return;
    }
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
    setNewLibraryName("");
    setNewLibraryDescription("");
    setNewLibrarySourceMeta(undefined);
    setNewLibraryLat(result.lat);
    setNewLibraryLon(result.lon);
    updateMapViewport({
      center: { lat: result.lat, lon: result.lon },
      zoom: 12,
    });
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
      const result = await fetchMeshmapNodes({ sourceUrl, cacheTtlMs: 30 * 60 * 1000 });
      setMeshmapNodes(result.nodes);
      setMeshmapCachedSummary(getCachedMeshmapSnapshotInfo());
      if (result.fromCache) {
        const ageMin = Math.max(1, Math.round((result.cacheAgeMs ?? 0) / 60_000));
        setMeshmapStatus(
          result.networkError
            ? `Live fetch failed — showing ${formatNumber(result.nodes.length)} cached node(s) from ${ageMin} min ago.`
            : `Loaded ${formatNumber(result.nodes.length)} node(s) from cached snapshot (${ageMin} min old).`,
        );
      } else {
        setMeshmapStatus(`Loaded ${formatNumber(result.nodes.length)} node(s) from live feed.`);
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
    if (!currentUser?.id) {
      setMeshmapStatus("Please log in to add mesh nodes to your library.");
      return;
    }
    addSiteLibraryEntry(
      fallbackName,
      selectedMeshmapNode.lat,
      selectedMeshmapNode.lon,
      groundM,
      2,
      STANDARD_SITE_RADIO.txPowerDbm,
      STANDARD_SITE_RADIO.txGainDbi,
      STANDARD_SITE_RADIO.rxGainDbi,
      STANDARD_SITE_RADIO.cableLossDb,
      {
        sourceType: "mqtt-feed",
        sourceUrl: meshmapSourceUrl.trim() || getDefaultMeshmapFeedUrl(),
        nodeId: selectedMeshmapNode.nodeId,
        shortName: selectedMeshmapNode.shortName,
        longName: selectedMeshmapNode.longName,
        hwModel: selectedMeshmapNode.hwModel,
        role: selectedMeshmapNode.role,
      },
      pendingDraftAutoInsert ? activeSimulationVisibility : "private",
      undefined,
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

  const revertChangeAsCopy = async (kind: "site" | "simulation", resourceId: string, changeId: number) => {
    try {
      await revertResourceChangeCopy(kind, resourceId, changeId);
      setChangeLogPopup((current) =>
        current
          ? {
              ...current,
              status: `Reverted from change #${changeId} as a new copy revision.`,
            }
          : current,
      );
      const refreshed = await fetchResourceChanges(kind, resourceId);
      setChangeLogPopup((current) =>
        current
          ? {
              ...current,
              changes: refreshed,
              busy: false,
            }
          : current,
      );
    } catch (error) {
      const message = getUiErrorMessage(error);
      setChangeLogPopup((current) =>
        current
          ? {
              ...current,
              status: `Revert failed: ${message}`,
            }
          : current,
      );
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
    setResourceNameDraft(label);
    if (kind === "site") {
      const site = siteLibrary.find((entry) => entry.id === resourceId);
      setResourceDescriptionDraft(site?.description ?? "");
      setResourceLatDraft(site?.position.lat ?? 0);
      setResourceLonDraft(site?.position.lon ?? 0);
      setResourceGroundDraft(site?.groundElevationM ?? 0);
      setResourceAntennaDraft(site?.antennaHeightM ?? 2);
      setResourceTxPowerDraft(site?.txPowerDbm ?? STANDARD_SITE_RADIO.txPowerDbm);
      setResourceTxGainDraft(site?.txGainDbi ?? STANDARD_SITE_RADIO.txGainDbi);
      setResourceRxGainDraft(site?.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi);
      setResourceCableLossDraft(site?.cableLossDb ?? STANDARD_SITE_RADIO.cableLossDb);
      setResourceAccessVisibility(normalizeAccessVisibility(site?.visibility));
      setResourceCollaboratorUserIds(
        (site?.sharedWith ?? [])
          .filter((grant) => grant.role === "editor" || grant.role === "admin")
          .filter((grant) => grant.userId !== site?.ownerUserId)
          .map((grant) => grant.userId),
      );
    } else {
      const simulation = simulationPresets.find((entry) => entry.id === resourceId);
      setResourceDescriptionDraft(simulation?.description ?? "");
      setResourceLatDraft(0);
      setResourceLonDraft(0);
      setResourceGroundDraft(0);
      setResourceAntennaDraft(2);
      setResourceTxPowerDraft(STANDARD_SITE_RADIO.txPowerDbm);
      setResourceTxGainDraft(STANDARD_SITE_RADIO.txGainDbi);
      setResourceRxGainDraft(STANDARD_SITE_RADIO.rxGainDbi);
      setResourceCableLossDraft(STANDARD_SITE_RADIO.cableLossDb);
      setResourceAccessVisibility(normalizeAccessVisibility(simulation?.visibility));
      setResourceCollaboratorUserIds(
        (simulation?.sharedWith ?? [])
          .filter((grant) => grant.role === "editor" || grant.role === "admin")
          .filter((grant) => grant.userId !== simulation?.ownerUserId)
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

  const persistResourceAccessSettings = (
    overrides?: Partial<{
      name: string;
      description: string;
      lat: number;
      lon: number;
      groundM: number;
      antennaM: number;
      txPowerDbm: number;
      txGainDbi: number;
      rxGainDbi: number;
      cableLossDb: number;
      visibility: "private" | "public" | "shared";
      collaboratorUserIds: string[];
    }>,
  ): boolean => {
    if (!resourceDetailsPopup) return false;
    if (!resourceCanWrite) {
      setResourceAccessStatus("Read-only: you do not have edit permission for this resource.");
      return false;
    }
    const nextVisibility = overrides?.visibility ?? resourceAccessVisibility;
    const nextName = overrides?.name ?? resourceNameDraft;
    const nextDescription = overrides?.description ?? resourceDescriptionDraft;
    const nextLat = overrides?.lat ?? resourceLatDraft;
    const nextLon = overrides?.lon ?? resourceLonDraft;
    const nextGroundM = overrides?.groundM ?? resourceGroundDraft;
    const nextAntennaM = overrides?.antennaM ?? resourceAntennaDraft;
    const nextTxPowerDbm = overrides?.txPowerDbm ?? resourceTxPowerDraft;
    const nextTxGainDbi = overrides?.txGainDbi ?? resourceTxGainDraft;
    const nextRxGainDbi = overrides?.rxGainDbi ?? resourceRxGainDraft;
    const nextCableLossDb = overrides?.cableLossDb ?? resourceCableLossDraft;
    const nextCollaboratorUserIds = overrides?.collaboratorUserIds ?? resourceCollaboratorUserIds;
    const normalizedVisibility = nextVisibility === "public" ? "shared" : nextVisibility;
    const normalizedName = nextName.trim();
    if (!normalizedName) {
      setResourceAccessStatus("Name is required.");
      return false;
    }
    const sharedWith = nextCollaboratorUserIds
      .filter((userId) => userId !== currentResourceOwnerId)
      .map((userId) => ({ userId, role: "editor" as const }));
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
      return false;
    }

    try {
      if (resourceDetailsPopup.kind === "site") {
        updateSiteLibraryEntry(resourceDetailsPopup.resourceId, {
          name: normalizedName,
          description: nextDescription.trim() || undefined,
          position: { lat: nextLat, lon: nextLon },
          groundElevationM: nextGroundM,
          antennaHeightM: nextAntennaM,
          txPowerDbm: nextTxPowerDbm,
          txGainDbi: nextTxGainDbi,
          rxGainDbi: nextRxGainDbi,
          cableLossDb: nextCableLossDb,
          visibility: normalizedVisibility,
          sharedWith,
        });
      } else {
        const simulationEntry = simulationPresets.find((entry) => entry.id === resourceDetailsPopup.resourceId);
        const referencedPrivateSiteIds =
          normalizedVisibility === "private"
            ? []
            : siteLibrary
                .filter((entry) => {
                  if ((entry.visibility ?? "private") !== "private") return false;
                  const referencedIds = new Set(
                    (simulationEntry?.snapshot.sites ?? [])
                      .map((site) => site.libraryEntryId)
                      .filter((value): value is string => typeof value === "string" && value.length > 0),
                  );
                  return referencedIds.has(entry.id);
                })
                .map((entry) => entry.id);
        if (referencedPrivateSiteIds.length > 0 && normalizedVisibility === "shared") {
          setPendingSimulationVisibilityPrompt({
            simulationId: resourceDetailsPopup.resourceId,
            targetVisibility: normalizedVisibility,
            referencedPrivateSiteIds,
          });
          return false;
        }
        updateSimulationPresetEntry(resourceDetailsPopup.resourceId, {
          name: normalizedName,
          description: nextDescription.trim() || undefined,
          visibility: normalizedVisibility,
          sharedWith,
        });
      }
      setResourceDetailsPopup((current) => (current ? { ...current, label: normalizedName } : current));
      setResourceAccessStatus("Saved");
      return true;
    } catch (error) {
      setResourceAccessStatus(`Save failed: ${getUiErrorMessage(error)}`);
      return false;
    }
  };

  const applyPendingSimulationVisibilityChange = () => {
    const pending = pendingSimulationVisibilityPrompt;
    if (!pending) return;
    for (const siteId of pending.referencedPrivateSiteIds) {
      updateSiteLibraryEntry(siteId, { visibility: pending.targetVisibility });
    }
    const sharedWith = resourceCollaboratorUserIds
      .filter((userId) => userId !== currentResourceOwnerId)
      .map((userId) => ({ userId, role: "editor" as const }));
    updateSimulationPresetEntry(pending.simulationId, {
      visibility: pending.targetVisibility,
      sharedWith,
    });
    setPendingSimulationVisibilityPrompt(null);
    setResourceAccessStatus("Saved");
  };

  const addCollaborator = (userId: string) => {
    if (!resourceCanWrite) {
      setResourceAccessStatus("Read-only: you do not have edit permission for this resource.");
      return;
    }
    if (!userId.trim()) return;
    if (currentResourceOwnerId && userId === currentResourceOwnerId) {
      setResourceAccessStatus("Owner is implicit and cannot be added as collaborator.");
      return;
    }
    const nextCollaborators = resourceCollaboratorUserIds.includes(userId)
      ? resourceCollaboratorUserIds
      : [...resourceCollaboratorUserIds, userId];
    setResourceCollaboratorUserIds(nextCollaborators);
    void persistResourceAccessSettings({ collaboratorUserIds: nextCollaborators });
    setResourceCollaboratorQuery("");
  };

  const removeCollaborator = (userId: string) => {
    if (!resourceCanWrite) {
      setResourceAccessStatus("Read-only: you do not have edit permission for this resource.");
      return;
    }
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
    const nextCollaborators = resourceCollaboratorUserIds.filter((id) => id !== userId);
    setResourceCollaboratorUserIds(nextCollaborators);
    void persistResourceAccessSettings({ collaboratorUserIds: nextCollaborators });
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
      <UserAdminPanel onOpenHelp={onOpenHelp} />
      <header>
        <div className="sidebar-title-row">
          <h1>{t(locale, "appTitle")}</h1>
          {envBadgeLabel ? <span className="sidebar-env-badge">{envBadgeLabel}</span> : null}
        </div>
      </header>
      <section className="panel-section section-scenario">
        <div className="section-heading">
          <h2>Simulation: {activeSimulationLabel}</h2>
          <InfoTip text="Open a simulation from the library or create a new one. A simulation is a workspace where you can add sites and tweak settings. They can be private or shared." />
        </div>
        <div className="chip-group simulation-buttons">
          <button
            className="inline-action"
            onClick={() => setShowSimulationLibraryManager(true)}
            type="button"
          >
            Library
          </button>
          <button
            className="inline-action"
            onClick={() => {
              setNewSimulationName("");
              setNewSimulationDescription("");
              setNewSimulationNameError("");
              setShowNewSimulationModal(true);
            }}
            type="button"
          >
            New
          </button>
          <button className="inline-action" onClick={saveSimulationAsNew} type="button">
            Duplicate
          </button>
          {selectedSimulationRef.startsWith("saved:") ? (
            <button className="inline-action" onClick={openActiveSimulationDetails} type="button">
              Edit
            </button>
          ) : null}
        </div>
        {simulationSaveStatus ? <p className="field-help">{simulationSaveStatus}</p> : null}
      </section>

      <section className="panel-section section-sites">
        <div className="section-heading">
          <h2>Sites</h2>
          <InfoTip text="Add a site from the site library or create a new site. You can also create or add sites from the map. A site can be private or shared." />
        </div>
        {!siteLibrary.length ? <p className="field-help">No saved library sites yet.</p> : null}
        <div className="site-list">
          {sites.map((site) => (
            <button
              className={clsx("site-row", selectedSiteIds.includes(site.id) && "is-selected")}
              key={site.id}
              onClick={(event) => selectSiteById(site.id, event.metaKey || event.ctrlKey)}
              type="button"
            >
              <span>{site.name}</span>
              <span className="site-row-meta">
                {Math.round(site.groundElevationM)} m ASL
              </span>
            </button>
          ))}
        </div>
        <div className="chip-group">
          <button className="inline-action" onClick={() => setShowSiteLibraryManager(true)} type="button">
            Library
          </button>
          {newestSiteLibraryEntryId ? (
            <button className="inline-action" onClick={() => insertSiteFromLibrary(newestSiteLibraryEntryId)} type="button">
              Insert newest
            </button>
          ) : null}
          <button className="inline-action" onClick={openLibraryForSelectedSite} type="button">
            Edit
          </button>
          <button
            className="inline-action danger"
            disabled={sites.length <= 1}
            onClick={() =>
              requestDeleteConfirm(
                "Remove Site",
                `Remove ${selectedSite.name} from the current simulation?`,
                () => deleteSite(selectedSite.id),
                "Remove",
              )
            }
            type="button"
          >
            Remove
          </button>
        </div>
      </section>

      <section className="panel-section section-radio">
        <details className="compact-details">
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
          <InfoTip text={`Select multiple sites by ${isMac ? "Cmd" : "Ctrl"}+Clicking to instantly view a link. When a link is active on the map, you can save it permanently to this simulation by pressing "Save" in the inspector.`} />
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
            </button>
          ))}
        </div>
        <div className="chip-group">
          <button className="inline-action" disabled={sites.length < 2} onClick={openAddLinkModal} type="button">
            New
          </button>
          <button className="inline-action" onClick={openEditLinkModal} type="button">
            Edit
          </button>
          <button
            className="inline-action danger"
            disabled={!links.length}
            onClick={() =>
              requestDeleteConfirm(
                "Delete Link",
                `Delete selected link "${displayLinkName(selectedLink.id, selectedLink.name)}"?`,
                () => deleteLink(selectedLink.id),
              )
            }
            type="button"
          >
            Remove
          </button>
        </div>
      </section>

      {linkModal ? (
        <ModalOverlay aria-label={linkModal.mode === "add" ? "Add Link" : "Edit Link"} onClose={() => setLinkModal(null)} tier="raised">
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>{linkModal.mode === "add" ? "Add Link" : "Edit Link"}</h2>
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={() => setLinkModal(null)} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
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
            <details className="compact-details">
              <summary>Link Radio Overrides</summary>
              <label className="field-grid">
                <span>Use site radio defaults</span>
                <input
                  checked={!linkModal.overrideRadio}
                  onChange={(event) =>
                    setLinkModal((current) =>
                      current ? { ...current, overrideRadio: !event.target.checked, status: "" } : current,
                    )
                  }
                  type="checkbox"
                />
              </label>
              {!linkModal.overrideRadio ? (
                <p className="field-help">
                  This link uses the selected From/To site radio settings.
                </p>
              ) : null}
              {linkModal.overrideRadio ? (
                <>
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
                </>
              ) : null}
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

      <div className="sidebar-grow" />
      <footer className="sidebar-footer">
        <div className="sidebar-footer-attribution">
          <MapIcon aria-hidden="true" size={11} strokeWidth={1.8} />
          <Copyright aria-hidden="true" size={9} strokeWidth={2.5} />
          <span>{resolvedBasemap.attribution.replace(/©/g, "")}</span>
          <Copyright aria-hidden="true" size={9} strokeWidth={2.5} />
          <span>MapLibre</span>
        </div>
        <div className="sidebar-footer-links">
          <a href="https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/TERMS.md" rel="noreferrer" target="_blank">
            <Handshake aria-hidden="true" size={13} strokeWidth={1.8} />
            Terms
          </a>
          <a href="https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/PRIVACY.md" rel="noreferrer" target="_blank">
            <HatGlasses aria-hidden="true" size={13} strokeWidth={1.8} />
            Privacy
          </a>
          <a href="https://github.com/wilhel1812/LinkSim" rel="noreferrer" target="_blank">
            <svg
              aria-hidden="true"
              height="13"
              role="img"
              viewBox="0 0 24 24"
              width="13"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d={siGithub.path} fill="currentColor" />
            </svg>
            GitHub
          </a>
        </div>
        <div className="sidebar-footer-version">
          Build: {buildLabel} (
          {runtimeEnvironment === "production" ? "live-prod" : runtimeEnvironment === "local" ? "local" : "live-test"})
        </div>
      </footer>

      {profilePopupUser ? (
        <ModalOverlay aria-label="User Profile" onClose={() => setProfilePopupUser(null)} tier="raised">
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>User Profile</h2>
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={() => setProfilePopupUser(null)} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
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
              {formatDate(profilePopupUser.createdAt)}
            </p>
            <div className="chip-group">
              <label className="field-grid">
                  <span>
                    Role{" "}
                  <InfoTip text="Admins can change roles for other users. Moderators can only approve pending users to User, or move existing users back to Pending. No one can change their own role." />
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
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={() => setChangeLogPopup(null)} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            {changeLogPopup.busy ? <p className="field-help">Loading changes...</p> : null}
            {changeLogPopup.status ? <p className="field-help">{changeLogPopup.status}</p> : null}
            <div className="library-manager-list">
              {changeLogPopup.changes.map((change) => (
                <div className="library-row" key={change.id}>
                  <p className="field-help">
                    {change.action.toUpperCase()} · {formatDate(change.changedAt)}
                  </p>
                  <button
                    className="inline-link-button"
                    onClick={() => void openUserProfilePopup(change.actorUserId)}
                    type="button"
                  >
                    <UserBadge avatarUrl={change.actorAvatarUrl} name={change.actorName ?? change.actorUserId} />
                  </button>
                  <p className="field-help">{formatChangeSummary(change.action, change.note)}</p>
                  {change.details && typeof change.details === "object" ? (
                    (() => {
                      const changedFields = (
                        Array.isArray((change.details as { changedFields?: unknown }).changedFields)
                          ? ((change.details as { changedFields?: string[] }).changedFields ?? [])
                          : []
                      )
                        .map((field) => String(field))
                        .filter(isMeaningfulChangeField);
                      const diffEntries = Object.entries(
                        ((change.details as { diff?: Record<string, { before: unknown; after: unknown }> }).diff ??
                          {}) as Record<string, { before: unknown; after: unknown }>,
                      ).filter(([field]) => isMeaningfulChangeField(field));
                      if (!changedFields.length && !diffEntries.length) return null;
                      return (
                        <div className="field-help">
                          {diffEntries.map(([field, values]) => (
                            <p key={`${change.id}-${field}`}>
                              {field}: {formatChangeDetailValue(values.before)} {"->"} {formatChangeDetailValue(values.after)}
                            </p>
                          ))}
                        </div>
                      );
                    })()
                  ) : null}
                  {canWriteResource(changeLogPopup.kind, changeLogPopup.resourceId) ? (
                    <div className="chip-group">
                      <button
                        className="inline-action"
                        onClick={() =>
                          void revertChangeAsCopy(changeLogPopup.kind, changeLogPopup.resourceId, change.id)
                        }
                        type="button"
                      >
                        Revert
                      </button>
                    </div>
                  ) : null}
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
        <ModalOverlay aria-label="Resource Edit" onClose={() => setResourceDetailsPopup(null)} tier="raised">
          <div className="library-manager-card user-profile-popup resource-details-card">
            <div className="library-manager-header">
              <h2>Edit · {resourceDetailsPopup.label}</h2>
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={() => setResourceDetailsPopup(null)} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            <p className="field-help">Type: {resourceDetailsPopup.kind === "site" ? "Site" : "Simulation"}</p>
            <p className="field-help">ID: {resourceDetailsPopup.resourceId}</p>
            {!resourceCanWrite ? (
              <p className="field-help warning-text">Read-only: you can view this resource but cannot edit it.</p>
            ) : null}
            <fieldset className="resource-edit-fieldset" disabled={!resourceCanWrite}>
            {resourceDetailsPopup.kind !== "site" ? (
              <>
                <label className="field-grid">
                  <span>Name</span>
                  <input
                    onChange={(event) => setResourceNameDraft(event.target.value)}
                    onBlur={() => {
                      void persistResourceAccessSettings();
                    }}
                    type="text"
                    value={resourceNameDraft}
                  />
                </label>
                <label className="field-grid">
                  <span>Description</span>
                  <textarea
                    onChange={(event) => setResourceDescriptionDraft(event.target.value)}
                    onBlur={() => {
                      void persistResourceAccessSettings();
                    }}
                    placeholder="Optional simulation notes"
                    rows={3}
                    value={resourceDescriptionDraft}
                  />
                </label>
              </>
            ) : null}
            {resourceDetailsPopup.kind === "site" ? (
              <div className="library-editor-split">
                <div className="library-editor-form resource-site-editor-form">
                  <label className="field-grid">
                    <span>Name</span>
                    <input
                      onChange={(event) => setResourceNameDraft(event.target.value)}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      type="text"
                      value={resourceNameDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Description</span>
                    <textarea
                      onChange={(event) => setResourceDescriptionDraft(event.target.value)}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      placeholder="Optional site notes (equipment, placement, access notes)"
                      rows={3}
                      value={resourceDescriptionDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Latitude</span>
                    <input
                      onChange={(event) => setResourceLatDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      step="0.000001"
                      type="number"
                      value={resourceLatDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Longitude</span>
                    <input
                      onChange={(event) => setResourceLonDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      step="0.000001"
                      type="number"
                      value={resourceLonDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Ground elev (m)</span>
                    <div className="field-inline">
                      <input
                        onChange={(event) => setResourceGroundDraft(parseNumber(event.target.value))}
                        onBlur={() => {
                          void persistResourceAccessSettings();
                        }}
                        type="number"
                        value={resourceGroundDraft}
                      />
                      <button
                        className="inline-action field-inline-btn"
                        onClick={() => {
                          const elevation = fetchGroundFromLoadedTerrain(resourceLatDraft, resourceLonDraft);
                          if (elevation === null) {
                            setResourceAccessStatus(
                              "No loaded terrain value at these coordinates. Fetch terrain data for this area first.",
                            );
                            return;
                          }
                          setResourceGroundDraft(elevation);
                          void persistResourceAccessSettings({ groundM: elevation });
                          setResourceAccessStatus(`Saved (terrain elevation ${elevation} m)`);
                        }}
                        type="button"
                      >
                        Fetch
                      </button>
                    </div>
                  </label>
                  <label className="field-grid">
                    <span>Antenna (m)</span>
                    <input
                      onChange={(event) => setResourceAntennaDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      type="number"
                      value={resourceAntennaDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Tx power (dBm)</span>
                    <input
                      onChange={(event) => setResourceTxPowerDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      type="number"
                      value={resourceTxPowerDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Tx gain (dBi)</span>
                    <input
                      onChange={(event) => setResourceTxGainDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      type="number"
                      value={resourceTxGainDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Rx gain (dBi)</span>
                    <input
                      onChange={(event) => setResourceRxGainDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      type="number"
                      value={resourceRxGainDraft}
                    />
                  </label>
                  <label className="field-grid">
                    <span>Cable loss (dB)</span>
                    <input
                      onChange={(event) => setResourceCableLossDraft(parseNumber(event.target.value))}
                      onBlur={() => {
                        void persistResourceAccessSettings();
                      }}
                      type="number"
                      value={resourceCableLossDraft}
                    />
                  </label>
                </div>
                <div className="library-editor-map">
                  <div className="library-editor-map-controls">
                    <label className="map-provider-field">
                      <span>Map Provider</span>
                      <select
                        className="locale-select"
                        onChange={(event) => {
                          const nextProvider = event.target.value as typeof basemapProvider;
                          const nextProviderConfig =
                            providerCapabilities.find((entry) => entry.provider === nextProvider) ??
                            providerCapabilities[0];
                          setBasemapProvider(nextProvider);
                          setBasemapStylePreset(
                            nextProviderConfig.presets.find((preset) => preset.id === "normal-themed")?.id ??
                              nextProviderConfig.presets.find((preset) => preset.id === "normal")?.id ??
                              nextProviderConfig.presets[0]?.id ??
                              "normal",
                          );
                        }}
                        value={basemapProvider}
                      >
                        <optgroup label="Global">
                          {globalProviders.map((provider) => (
                            <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                              {provider.label}
                              {!provider.available ? " (unavailable)" : ""}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Regional">
                          {regionalProviders.map((provider) => (
                            <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                              {provider.label}
                              {!provider.available ? " (unavailable)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                    <label className="map-provider-field">
                      <span>Map Style</span>
                      <select
                        className="locale-select"
                        disabled={resolvedPresetOptions.length <= 1}
                        onChange={(event) => setBasemapStylePreset(event.target.value)}
                        value={styleSelectValue}
                      >
                        {resolvedPresetOptions.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Map
                    initialViewState={{
                      longitude: resourceLonDraft,
                      latitude: resourceLatDraft,
                      zoom: 12,
                    }}
                    mapStyle={resolvedBasemap.style}
                    onClick={(event) => {
                      if (!resourceCanWrite) return;
                      const nextLat = event.lngLat.lat;
                      const nextLon = event.lngLat.lng;
                      setResourceLatDraft(nextLat);
                      setResourceLonDraft(nextLon);
                      void persistResourceAccessSettings({ lat: nextLat, lon: nextLon });
                    }}
                  >
                    <Marker
                      anchor="bottom"
                      draggable={resourceCanWrite}
                      latitude={resourceLatDraft}
                      longitude={resourceLonDraft}
                      onDragEnd={(event: MarkerDragEvent) => {
                        if (!resourceCanWrite) return;
                        const nextLat = event.lngLat.lat;
                        const nextLon = event.lngLat.lng;
                        setResourceLatDraft(nextLat);
                        setResourceLonDraft(nextLon);
                        void persistResourceAccessSettings({ lat: nextLat, lon: nextLon });
                      }}
                    >
                      <div className="site-pin library-edit-pin">
                        <span>{resourceNameDraft.trim() || "Site"}</span>
                      </div>
                    </Marker>
                  </Map>
                </div>
              </div>
            ) : null}
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
            {resourceDetailsPopup.kind === "site" && currentResourceMqttMetaLines.length ? (
              <details className="compact-details">
                <summary>MQTT Metadata</summary>
                <div className="field-help">
                  {currentResourceMqttMetaLines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </details>
            ) : null}
            <details className="compact-details">
              <summary>Access</summary>
              <label className="field-grid">
                <span>
                  Access level{" "}
                  <InfoTip text="Private: visible to owner/admin. Shared: readable by everyone. Editing is limited to owner, admins, and explicit collaborators." />
                </span>
                <select
                  className="locale-select"
                    onChange={(event) =>
                    {
                      const next = event.target.value as "private" | "public" | "shared";
                      setResourceAccessVisibility(next);
                      void persistResourceAccessSettings({ visibility: next });
                    }
                  }
                  value={resourceAccessVisibility}
                >
                  <option value="private">Private</option>
                  <option value="shared">Shared</option>
                </select>
              </label>
              <p className="field-help warning-text">
                Access levels are not a confidential storage guarantee. Never place passwords, tokens, private keys, or
                other secrets in resource content.
              </p>
              <div className="field-grid user-bio-field collaborator-picker-grid">
                <span>
                  Collaborators{" "}
                  <InfoTip text="Collaborators grant edit rights. Editors can add collaborators but cannot remove existing collaborators. Owners/admins can remove." />
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
                collaborators/owner. Owners/admins can remove collaborators.
              </p>
              {resourceAccessStatus ? <p className="field-help">{resourceAccessStatus}</p> : <p className="field-help">Saved automatically.</p>}
            </details>
            </fieldset>
            {resourceCanWrite ? (
              <div className="chip-group">
                <button
                  className="inline-action danger"
                  onClick={() =>
                    requestDeleteConfirm(
                      resourceDetailsPopup.kind === "site" ? "Delete Site" : "Delete Simulation",
                      resourceDetailsPopup.kind === "site"
                        ? `Delete "${resourceDetailsPopup.label}" from the site library?`
                        : `Delete simulation "${resourceDetailsPopup.label}"?`,
                      () => {
                        if (resourceDetailsPopup.kind === "site") {
                          deleteSiteLibraryEntries([resourceDetailsPopup.resourceId]);
                        } else {
                          deleteSimulationPreset(resourceDetailsPopup.resourceId);
                          if (selectedSimulationRef === `saved:${resourceDetailsPopup.resourceId}`) {
                            persistSelectedSimulationRef("");
                          }
                        }
                        setResourceDetailsPopup(null);
                      },
                    )
                  }
                  type="button"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </ModalOverlay>
      ) : null}
      {showNewSimulationModal ? (
        <ModalOverlay
          aria-label="New Simulation"
          onClose={() => {
            setShowNewSimulationModal(false);
            setNewSimulationNameError("");
          }}
          tier="raised"
        >
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>New Simulation</h2>
                <button
                  aria-label="Close"
                  className="inline-action inline-action-icon"
                  onClick={() => {
                    setShowNewSimulationModal(false);
                    setNewSimulationNameError("");
                  }}
                  title="Close"
                  type="button"
                >
                  <CircleX aria-hidden="true" strokeWidth={1.8} />
                </button>
            </div>
            <label className="field-grid">
              <span>Name</span>
              <input
                className={newSimulationNameError ? "input-error" : ""}
                onChange={(event) => {
                  setNewSimulationName(event.target.value);
                  if (newSimulationNameError) setNewSimulationNameError("");
                }}
                placeholder="My simulation"
                type="text"
                value={newSimulationName}
              />
            </label>
            {newSimulationNameError ? <p className="field-help field-help-error">{newSimulationNameError}</p> : null}
            <label className="field-grid">
              <span>Description</span>
              <textarea
                onChange={(event) => setNewSimulationDescription(event.target.value)}
                placeholder="Optional simulation notes"
                rows={3}
                value={newSimulationDescription}
              />
            </label>
            <label className="field-grid">
              <span>
                Access level{" "}
                <InfoTip text="Private: visible to owner/admin. Public/Shared: readable by everyone. Editing is limited to owner, admins, and explicit collaborators." />
              </span>
              <select
                className="locale-select"
                onChange={(event) => setNewSimulationVisibility(event.target.value as "private" | "shared")}
                value={newSimulationVisibility}
              >
                <option value="private">Private</option>
                <option value="shared">Shared</option>
              </select>
            </label>
            <div className="chip-group">
              <button className="inline-action" onClick={createBlankSimulation} type="button">
                Create
              </button>
            </div>
          </div>
        </ModalOverlay>
      ) : null}

      {showSimulationLibraryManager ? (
        <ModalOverlay
          aria-label="Simulation Library"
          onClose={() => setShowSimulationLibraryManager(false)}
        >
          <SimulationLibraryPanel
            onClose={() => setShowSimulationLibraryManager(false)}
            onLoadSimulation={(presetId) => {
              loadSimulationPreset(presetId);
              persistSelectedSimulationRef(`saved:${presetId}`);
            }}
            onOpenDetails={openResourceDetailsPopup}
          />
        </ModalOverlay>
      ) : null}

      {pendingSimulationVisibilityPrompt ? (
        <ModalOverlay
          aria-label="Confirm Simulation Visibility Change"
          onClose={() => setPendingSimulationVisibilityPrompt(null)}
          tier="raised"
        >
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>Visibility Change Confirmation</h2>
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={() => setPendingSimulationVisibilityPrompt(null)} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            <p className="field-help">
              You are setting this simulation to{" "}
              <strong>{pendingSimulationVisibilityPrompt.targetVisibility}</strong>, but it references{" "}
              <strong>{pendingSimulationVisibilityPrompt.referencedPrivateSiteIds.length}</strong> private site(s).
            </p>
            <p className="field-help">
              Do you want to change those referenced sites to{" "}
              <strong>{pendingSimulationVisibilityPrompt.targetVisibility}</strong> as well?
            </p>
            <div className="chip-group">
              <button className="inline-action" onClick={applyPendingSimulationVisibilityChange} type="button">
                Change
              </button>
              <button className="inline-action" onClick={() => setPendingSimulationVisibilityPrompt(null)} type="button">
                Cancel
              </button>
            </div>
          </div>
        </ModalOverlay>
      ) : null}
      {showSiteLibraryManager ? (
        <ModalOverlay
          aria-label="Site Library"
          onClose={() => {
            setShowSiteLibraryManager(false);
            setPendingDraftAutoInsert(false);
            closeSiteFilterEditors();
          }}
        >
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Site Library</h2>
              <button
                aria-label="Close"
                className="inline-action inline-action-icon"
                onClick={() => {
                  setShowSiteLibraryManager(false);
                  setPendingDraftAutoInsert(false);
                  closeSiteFilterEditors();
                }}
                title="Close"
                type="button"
              >
                <CircleX aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            <p className="field-help">
              Built for large libraries. Select one or more entries to add into this simulation.
            </p>
            <label className="field-grid">
              <span>Search</span>
              <input
                onChange={(event) => setSiteLibraryFilters((state) => ({ ...state, searchQuery: event.target.value }))}
                placeholder="Filter by name or coordinates"
                type="text"
                value={siteLibraryFilters.searchQuery}
              />
            </label>
            <div className="library-filter-toolbar" ref={siteFilterToolbarRef}>
              <span className="library-filter-row-label">Filters:</span>
              <div className="library-filter-menu">
                <button
                  className={clsx("inline-action", "library-filter-trigger", {
                    "library-filter-trigger-active": selectionIsFiltered(siteLibraryFilters.roleFilters, ALL_ROLE_FILTERS),
                  })}
                  onClick={openSiteRoleEditor}
                  type="button"
                >
                  Ownership {selectionLabel(siteLibraryFilters.roleFilters, ALL_ROLE_FILTERS)}
                  <span className="library-filter-trigger-chevron" aria-hidden="true">
                    <Funnel aria-hidden="true" strokeWidth={1.8} />
                  </span>
                </button>
                {openSiteFilterGroup === "role" ? (
                  <div className="library-filter-popover">
                    <div className="library-filter-popover-actions">
                      <button className="inline-action" onClick={() => commitSiteRoleFilters(ALL_ROLE_FILTERS)} type="button">
                        All
                      </button>
                      <button className="inline-action" onClick={() => setSiteRoleDraft([])} type="button">
                        None
                      </button>
                    </div>
                    <div className="library-filter-popover-options">
                      {ROLE_FILTER_OPTIONS.map((option) => {
                        const draft = siteRoleDraft ?? effectiveSelection(siteLibraryFilters.roleFilters, ALL_ROLE_FILTERS);
                        const checked = draft.includes(option.key);
                        return (
                          <label className="checkbox-field library-filter-option" key={`site-role-${option.key}`}>
                            <input
                              checked={checked}
                              onChange={() => {
                                const next = toggleValue(draft, option.key);
                                setSiteRoleDraft(next);
                                if (next.length) commitSiteRoleFilters(next);
                              }}
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="library-filter-menu">
                <button
                  className={clsx("inline-action", "library-filter-trigger", {
                    "library-filter-trigger-active": selectionIsFiltered(
                      siteLibraryFilters.visibilityFilters,
                      ALL_VISIBILITY_FILTERS,
                    ),
                  })}
                  onClick={openSiteVisibilityEditor}
                  type="button"
                >
                  Access level {selectionLabel(siteLibraryFilters.visibilityFilters, ALL_VISIBILITY_FILTERS)}
                  <span className="library-filter-trigger-chevron" aria-hidden="true">
                    <Funnel aria-hidden="true" strokeWidth={1.8} />
                  </span>
                </button>
                {openSiteFilterGroup === "visibility" ? (
                  <div className="library-filter-popover">
                    <div className="library-filter-popover-actions">
                      <button
                        className="inline-action"
                        onClick={() => commitSiteVisibilityFilters(ALL_VISIBILITY_FILTERS)}
                        type="button"
                      >
                        All
                      </button>
                      <button className="inline-action" onClick={() => setSiteVisibilityDraft([])} type="button">
                        None
                      </button>
                    </div>
                    <div className="library-filter-popover-options">
                      {VISIBILITY_FILTER_OPTIONS.map((option) => {
                        const draft =
                          siteVisibilityDraft ?? effectiveSelection(siteLibraryFilters.visibilityFilters, ALL_VISIBILITY_FILTERS);
                        const checked = draft.includes(option.key);
                        return (
                          <label className="checkbox-field library-filter-option" key={`site-visibility-${option.key}`}>
                            <input
                              checked={checked}
                              onChange={() => {
                                const next = toggleValue(draft, option.key);
                                setSiteVisibilityDraft(next);
                                if (next.length) commitSiteVisibilityFilters(next);
                              }}
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="library-filter-menu">
                <button
                  className={clsx("inline-action", "library-filter-trigger", {
                    "library-filter-trigger-active": selectionIsFiltered(siteLibraryFilters.sourceFilters, ALL_SITE_SOURCE_FILTERS),
                  })}
                  onClick={openSiteSourceEditor}
                  type="button"
                >
                  Source {selectionLabel(siteLibraryFilters.sourceFilters, ALL_SITE_SOURCE_FILTERS)}
                  <span className="library-filter-trigger-chevron" aria-hidden="true">
                    <Funnel aria-hidden="true" strokeWidth={1.8} />
                  </span>
                </button>
                {openSiteFilterGroup === "source" ? (
                  <div className="library-filter-popover">
                    <div className="library-filter-popover-actions">
                      <button
                        className="inline-action"
                        onClick={() => commitSiteSourceFilters(ALL_SITE_SOURCE_FILTERS)}
                        type="button"
                      >
                        All
                      </button>
                      <button className="inline-action" onClick={() => setSiteSourceDraft([])} type="button">
                        None
                      </button>
                    </div>
                    <div className="library-filter-popover-options">
                      {SITE_SOURCE_FILTER_OPTIONS.map((option) => {
                        const draft = siteSourceDraft ?? effectiveSelection(siteLibraryFilters.sourceFilters, ALL_SITE_SOURCE_FILTERS);
                        const checked = draft.includes(option.key);
                        return (
                          <label className="checkbox-field library-filter-option" key={`site-source-${option.key}`}>
                            <input
                              checked={checked}
                              onChange={() => {
                                const next = toggleValue(draft, option.key);
                                setSiteSourceDraft(next);
                                if (next.length) commitSiteSourceFilters(next);
                              }}
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                className="inline-action"
                onClick={() => {
                  setSiteLibraryFilters(DEFAULT_LIBRARY_FILTER_STATE);
                  closeSiteFilterEditors();
                }}
                type="button"
              >
                Clear Filters
              </button>
            </div>
            <div className="chip-group">
              <button
                className="inline-action"
                onClick={() => {
                  setShowAddLibraryForm((current) => !current);
                  if (showAddLibraryForm) {
                    setPendingDraftAutoInsert(false);
                    setNewLibraryDescription("");
                  }
                }}
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
                className="inline-action danger"
                disabled={!selectedLibraryCount}
                onClick={() =>
                  requestDeleteConfirm(
                    "Delete Sites",
                    `Delete ${selectedLibraryCount} selected site(s) from the library? This cannot be undone.`,
                    () => {
                      deleteSiteLibraryEntries(Array.from(selectedLibraryIds));
                      setSelectedLibraryIds(new Set());
                    },
                  )
                }
                type="button"
              >
                Delete Selected ({selectedLibraryCount})
              </button>
            </div>
            {showAddLibraryForm ? (
              <div className="library-editor">
                <h3>Add Site</h3>
                <div className="library-editor-split">
                  <div className="library-editor-form resource-site-editor-form">
                <label className="field-grid">
                  <span>Name</span>
                  <input
                    className={newLibraryNameError ? "input-error" : ""}
                    onChange={(event) => {
                      setNewLibraryName(event.target.value);
                      if (newLibraryNameError) setNewLibraryNameError("");
                    }}
                    placeholder="My site"
                    type="text"
                    value={newLibraryName}
                  />
                </label>
                {newLibraryNameError ? <p className="field-help field-help-error">{newLibraryNameError}</p> : null}
                <label className="field-grid">
                  <span>Description</span>
                  <textarea
                    onChange={(event) => setNewLibraryDescription(event.target.value)}
                    placeholder="Optional site notes"
                    rows={3}
                    value={newLibraryDescription}
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
                  <span>Tx power (dBm)</span>
                  <input
                    onChange={(event) => setNewLibraryTxPowerDbm(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryTxPowerDbm}
                  />
                </label>
                <label className="field-grid">
                  <span>Tx gain (dBi)</span>
                  <input
                    onChange={(event) => setNewLibraryTxGainDbi(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryTxGainDbi}
                  />
                </label>
                <label className="field-grid">
                  <span>Rx gain (dBi)</span>
                  <input
                    onChange={(event) => setNewLibraryRxGainDbi(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryRxGainDbi}
                  />
                </label>
                <label className="field-grid">
                  <span>Cable loss (dB)</span>
                  <input
                    onChange={(event) => setNewLibraryCableLossDb(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryCableLossDb}
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
                  {meshmapLoading ? (
                    <div className="map-progress-track" style={{ marginTop: 8 }}>
                      <div className="map-progress-fill map-progress-fill-indeterminate" />
                    </div>
                  ) : null}
                  {meshmapCachedSummary ? (
                    <p className="field-help">
                      Cached snapshot: {formatNumber(meshmapCachedSummary.nodeCount)} node(s) from{" "}
                      {formatDate(meshmapCachedSummary.savedAt)} ({meshmapCachedSummary.sourceUrl})
                    </p>
                  ) : null}
                  {meshmapStatus ? (
                    <p className="field-help">
                      {meshmapStatus}
                      {meshmapStatus.includes("failed") ? (
                        <button
                          aria-label="Retry loading Meshtastic feed"
                          className="inline-action"
                          onClick={() => void loadMeshmapFeed()}
                          style={{ marginLeft: 8 }}
                          type="button"
                        >
                          <RefreshCw aria-hidden="true" size={12} strokeWidth={2} />
                          <span>Retry</span>
                        </button>
                      ) : null}
                    </p>
                  ) : null}
                  {showMeshtasticBrowser ? (
                    <div className="meshmap-browser">
                      <div className="meshmap-browser-map">
                        <Map
                          initialViewState={meshmapView}
                          interactiveLayerIds={["meshmap-nodes-layer"]}
                          mapStyle={resolvedBasemap.style}
                          onClick={onMeshmapClick}
                          onMove={onMeshmapMove}
                        >
                          <Source data={meshmapNodesGeoJson} id="meshmap-nodes" type="geojson">
                            <Layer
                              {...meshmapNodesLayer(
                                variant.map.meshNodeColor,
                                variant.map.meshStrokeColor,
                              )}
                            />
                            <Layer
                              {...meshmapLabelsLayer(
                                variant.map.meshLabelColor,
                                variant.map.meshHaloColor,
                              )}
                            />
                          </Source>
                        </Map>
                      </div>
                      <p className="field-help">
                        Nodes loaded: {formatNumber(meshmapNodes.length)} total, {formatNumber(meshmapNodesInView.length)} in view.
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
                          </p>
                          <button className="inline-action" onClick={() => void addSelectedMeshmapNodeToLibrary()} type="button">
                            Add Selected MQTT Node To Library
                          </button>
                        </div>
                      ) : (
                        <p className="field-help">Click a node in the map to select it.</p>
                      )}
                    </div>
                  ) : null}
                </details>
                  </div>
                  <div className="library-editor-map">
                    <div className="library-editor-map-controls">
                      <label className="map-provider-field">
                        <span>Map Provider</span>
                        <select
                          className="locale-select"
                          onChange={(event) => {
                            const nextProvider = event.target.value as typeof basemapProvider;
                            const nextProviderConfig =
                              providerCapabilities.find((entry) => entry.provider === nextProvider) ??
                              providerCapabilities[0];
                            setBasemapProvider(nextProvider);
                            setBasemapStylePreset(
                              nextProviderConfig.presets.find((preset) => preset.id === "normal-themed")?.id ??
                                nextProviderConfig.presets.find((preset) => preset.id === "normal")?.id ??
                                nextProviderConfig.presets[0]?.id ??
                                "normal",
                            );
                          }}
                          value={basemapProvider}
                        >
                          <optgroup label="Global">
                            {globalProviders.map((provider) => (
                              <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                                {provider.label}
                                {!provider.available ? " (unavailable)" : ""}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Regional">
                            {regionalProviders.map((provider) => (
                              <option disabled={!provider.available} key={provider.provider} value={provider.provider}>
                                {provider.label}
                                {!provider.available ? " (unavailable)" : ""}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                      <label className="map-provider-field">
                        <span>Map Style</span>
                        <select
                          className="locale-select"
                          disabled={resolvedPresetOptions.length <= 1}
                          onChange={(event) => setBasemapStylePreset(event.target.value)}
                          value={styleSelectValue}
                        >
                          {resolvedPresetOptions.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Map
                      initialViewState={{
                        longitude: newLibraryLon,
                        latitude: newLibraryLat,
                        zoom: 12,
                      }}
                      mapStyle={resolvedBasemap.style}
                      onClick={(event) => {
                        const nextLat = event.lngLat.lat;
                        const nextLon = event.lngLat.lng;
                        setNewLibraryLat(nextLat);
                        setNewLibraryLon(nextLon);
                        const elevation = fetchGroundFromLoadedTerrain(nextLat, nextLon);
                        if (elevation !== null) setNewLibraryGroundM(elevation);
                      }}
                    >
                      <Marker
                        anchor="bottom"
                        draggable
                        latitude={newLibraryLat}
                        longitude={newLibraryLon}
                        onDragEnd={(event: MarkerDragEvent) => {
                          const nextLat = event.lngLat.lat;
                          const nextLon = event.lngLat.lng;
                          setNewLibraryLat(nextLat);
                          setNewLibraryLon(nextLon);
                          const elevation = fetchGroundFromLoadedTerrain(nextLat, nextLon);
                          if (elevation !== null) setNewLibraryGroundM(elevation);
                        }}
                      >
                        <div className="site-pin library-edit-pin">
                          <span>{newLibraryName.trim() || "Site"}</span>
                        </div>
                      </Marker>
                    </Map>
                  </div>
                </div>
                <div className="chip-group">
                  <button className="inline-action" onClick={addLibraryEntryNow} type="button">
                    Add To Library
                  </button>
                  <button
                    className="inline-action"
                    onClick={() => {
                      setShowAddLibraryForm(false);
                      setNewLibraryNameError("");
                      setNewLibraryDescription("");
                      setNewLibrarySourceMeta(undefined);
                      setPendingDraftAutoInsert(false);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div className="library-manager-list">
              {filteredSiteLibrary.map((entry) => (
                <div className="library-manager-row" key={entry.id}>
                  {(() => {
                    const owner = resolveOwnerDisplay(
                      (entry as { ownerUserId?: string }).ownerUserId,
                      (entry as { createdByName?: string }).createdByName,
                      (entry as { createdByAvatarUrl?: string }).createdByAvatarUrl,
                    );
                    return (
                      <>
                  <input
                    checked={selectedLibraryIds.has(entry.id)}
                    onChange={() => toggleLibrarySelection(entry.id)}
                    type="checkbox"
                  />
                  <span className="library-row-label">
                    {entry.name} ({entry.position.lat.toFixed(5)}, {entry.position.lon.toFixed(5)})
                  </span>
                  <span className="library-row-meta">
                    <span className="access-badge">{normalizeAccessVisibility((entry as { visibility?: unknown }).visibility)}</span>
                    {(entry as { sourceMeta?: { sourceType?: string } }).sourceMeta?.sourceType === "mqtt-feed" ? (
                      <span className="access-badge mqtt-source-badge">MQTT</span>
                    ) : null}
                    <button
                      className="row-avatar owner-avatar"
                      onClick={() => void openUserProfilePopup((entry as { ownerUserId?: string }).ownerUserId)}
                      title={`Owner: ${owner.name}`}
                      type="button"
                    >
                      {owner.avatarUrl ? (
                        <img
                          alt={owner.name}
                          className="row-avatar-image"
                          src={owner.avatarUrl}
                        />
                      ) : (
                        initialsForUser(owner.name)
                      )}
                    </button>
                    {((entry.sharedWith ?? [])
                      .filter((grant) => grant.userId !== (entry as { ownerUserId?: string }).ownerUserId)
                      .slice(0, 3)
                      .map((grant) => {
                        const user = collaboratorDirectoryById.get(grant.userId);
                        const name = user?.username ?? grant.userId;
                        const avatarUrl = user?.avatarUrl ?? "";
                        return (
                          <button
                            className="row-avatar"
                            key={grant.userId}
                            onClick={() => void openUserProfilePopup(grant.userId)}
                            title={name}
                            type="button"
                          >
                            {avatarUrl ? (
                              <img alt={name} className="row-avatar-image" src={avatarUrl} />
                            ) : (
                              initialsForUser(name)
                            )}
                          </button>
                        );
                      }))}
                  </span>
                      </>
                    );
                  })()}
                  <div className="library-row-actions">
                    <button className="inline-action" onClick={() => insertSiteFromLibrary(entry.id)} type="button">
                      Add to simulation
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
                      Open
                    </button>
                  </div>
                </div>
              ))}
              {!filteredSiteLibrary.length ? <p className="field-help">No matching sites.</p> : null}
            </div>
          </div>
        </ModalOverlay>
      ) : null}
      {deleteConfirm ? (
        <ModalOverlay aria-label="Confirm Delete" onClose={() => setDeleteConfirm(null)} tier="raised">
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>{deleteConfirm.title}</h2>
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={() => setDeleteConfirm(null)} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            <p className="field-help">{deleteConfirm.message}</p>
            <div className="chip-group">
              <button className="inline-action" onClick={() => setDeleteConfirm(null)} type="button">
                Cancel
              </button>
              <button
                className="inline-action danger"
                onClick={() => {
                  const action = deleteConfirm.onConfirm;
                  setDeleteConfirm(null);
                  action();
                }}
                type="button"
              >
                {deleteConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </aside>
  );
}
