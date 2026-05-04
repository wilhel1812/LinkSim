import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CircleMinus, Funnel, Handshake, HatGlasses, Pencil } from "lucide-react";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { t } from "../i18n/locales";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { buildLabelForChannel } from "../lib/buildInfo";
import { resolveBasemapSelection } from "../lib/basemaps";
import { parseDeepLinkFromLocation } from "../lib/deepLink";
import {
  fetchCollaboratorDirectory,
  fetchUserById,
  updateUserRole,
  type CollaboratorDirectoryUser,
  type CloudUser,
} from "../lib/cloudUser";
import { toAccessVisibility } from "../lib/uiFormatting";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  filterAndSortLibraryItems,
  type LibraryFilterRole,
  type LibraryFilterSource,
  type LibraryFilterState,
  type LibraryFilterVisibility,
} from "../lib/libraryFilters";
import {
  effectiveSelection,
  persistLibraryFilterState,
  readLibraryFilterState,
  selectionIsFiltered,
  selectionLabel,
  toggleValue,
} from "../lib/libraryFilterUi";
import { getUiErrorMessage } from "../lib/uiError";
import { formatDate } from "../lib/locale";
import { useAppStore } from "../store/appStore";
import type { Site } from "../types/radio";
import { siGithub } from "simple-icons";
import { InfoTip } from "./InfoTip";
import { ActionButton } from "./ActionButton";
import { AvatarBadge } from "./AvatarBadge";
import { InlineCloseIconButton } from "./InlineCloseIconButton";
import { ModalOverlay } from "./ModalOverlay";
import SimulationLibraryPanel from "./SimulationLibraryPanel";
import { Badge } from "./ui/Badge";
import { PanelToolbar } from "./ui/PanelToolbar";
import { UserAdminPanel } from "./UserAdminPanel";

const READ_ONLY_SIMULATION_SITE_HELP =
  "Read-only: you need edit permission to add or edit sites in this simulation.";

const UserBadge = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
  <span className="user-list-row">
    <AvatarBadge avatarUrl={avatarUrl} imageClassName="profile-avatar" name={name} />
    <span>{name}</span>
  </span>
);

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

type SidebarProps = {
  onOpenHelp?: () => void;
  onOpenSettings?: () => void;
  onSignInRequested?: () => void;
  hideLibraryBrowsing?: boolean;
  readOnly?: boolean;
  authBootstrapPending?: boolean;
  panelToggleControl?: ReactNode;
  panelClassName?: string;
  /** Override the computed simulation name shown in the Simulation section header. */
  simulationDisplayLabel?: string;
};

export function Sidebar({
  onOpenHelp,
  onOpenSettings,
  onSignInRequested,
  hideLibraryBrowsing = false,
  readOnly = false,
  authBootstrapPending = false,
  panelToggleControl,
  panelClassName,
  simulationDisplayLabel,
}: SidebarProps) {
  const { theme, colorTheme } = useThemeVariant();
  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const envBadgeLabel = runtimeEnvironment === "local" ? "LOCAL" : runtimeEnvironment === "staging" ? "STAGING" : "";
  const buildChannel = runtimeEnvironment === "production" ? "stable" : runtimeEnvironment === "staging" ? "beta" : "alpha";
  const buildLabel = buildLabelForChannel(buildChannel);
  const links = useAppStore((state) => state.links);
  const sites = useAppStore((state) => state.sites);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteIds = useAppStore((state) => state.selectedSiteIds);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const scenarioOptions = useAppStore((state) => state.scenarioOptions);
  const locale = useAppStore((state) => state.locale);
  const selectScenario = useAppStore((state) => state.selectScenario);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const selectSiteById = useAppStore((state) => state.selectSiteById);
  const basemapStyleId = useAppStore((state) => state.basemapStyleId);
  const pendingSiteLibraryDraft = useAppStore((state) => state.pendingSiteLibraryDraft);
  const clearPendingSiteLibraryDraft = useAppStore((state) => state.clearPendingSiteLibraryDraft);
  const pendingSiteLibraryOpenEntryId = useAppStore((state) => state.pendingSiteLibraryOpenEntryId);
  const clearOpenSiteLibraryEntryRequest = useAppStore((state) => state.clearOpenSiteLibraryEntryRequest);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const insertSitesFromLibrary = useAppStore((state) => state.insertSitesFromLibrary);
  const openMapEditor = useAppStore((state) => state.openMapEditor);
  const deleteSiteLibraryEntries = useAppStore((state) => state.deleteSiteLibraryEntries);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const deleteLink = useAppStore((state) => state.deleteLink);
  const saveCurrentSimulationPreset = useAppStore((state) => state.saveCurrentSimulationPreset);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const showNewSimulationRequest = useAppStore((state) => state.showNewSimulationRequest);
  const setShowNewSimulationRequest = useAppStore((state) => state.setShowNewSimulationRequest);
  const getDefaultFrequencyPresetIdForNewSimulation = useAppStore(
    (state) => state.getDefaultFrequencyPresetIdForNewSimulation,
  );
  const showSiteLibraryRequest = useAppStore((state) => state.showSiteLibraryRequest);
  const setShowSiteLibraryRequest = useAppStore((state) => state.setShowSiteLibraryRequest);
  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapStyleId, theme, colorTheme),
    [basemapStyleId, theme, colorTheme],
  );
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
  const [resourceCollaboratorDirectory, setResourceCollaboratorDirectory] = useState<CollaboratorDirectoryUser[]>([]);
  const currentUser = useAppStore((state) => state.currentUser);

  const [deleteConfirm, setDeleteConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const currentUserId = currentUser?.id ?? null;
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
    if (showNewSimulationRequest) {
      if (hideLibraryBrowsing) {
        setShowNewSimulationRequest(false);
        return;
      }
      openMapEditor({
        kind: "simulation",
        resourceId: null,
        isNew: true,
        label: "New Simulation",
        anchorRect: { top: 96, right: 320, bottom: 96, left: 320, width: 0, height: 0 },
        simulationSeed: {
          frequencyPresetId: getDefaultFrequencyPresetIdForNewSimulation(),
          autoPropagationEnvironment,
        },
      });
      setShowNewSimulationRequest(false);
    }
  }, [autoPropagationEnvironment, hideLibraryBrowsing, openMapEditor, showNewSimulationRequest, setShowNewSimulationRequest, getDefaultFrequencyPresetIdForNewSimulation]);
  useEffect(() => {
    if (showSiteLibraryRequest) {
      if (hideLibraryBrowsing) {
        setShowSiteLibraryRequest(false);
        return;
      }
      setShowSiteLibraryManager(true);
      setShowSiteLibraryRequest(false);
    }
  }, [hideLibraryBrowsing, showSiteLibraryRequest, setShowSiteLibraryRequest]);
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
  const openActiveSimulationDetails = (triggerEl?: Element | null) => {
    if (!selectedSimulationRef.startsWith("saved:")) return;
    const presetId = selectedSimulationRef.replace("saved:", "");
    const preset = simulationPresets.find((p) => p.id === presetId);
    if (!preset) return;
    openMapEditor({
      kind: "simulation",
      resourceId: preset.id,
      isNew: false,
      label: preset.name,
      anchorRect: triggerEl?.getBoundingClientRect() ?? { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 },
    });
  };
  const collaboratorDirectoryById = useMemo(
    () => new globalThis.Map(resourceCollaboratorDirectory.map((user) => [user.id, user])),
    [resourceCollaboratorDirectory],
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
    if (hideLibraryBrowsing) {
      setResourceCollaboratorDirectory([]);
      return;
    }
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
  }, [hideLibraryBrowsing]);
  useEffect(() => {
    if (!pendingSiteLibraryDraft) return;
    openMapEditor({
      kind: "site",
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: { top: 96, right: 320, bottom: 96, left: 320, width: 0, height: 0 },
      siteSeed: {
        lat: pendingSiteLibraryDraft.lat,
        lon: pendingSiteLibraryDraft.lon,
        name: pendingSiteLibraryDraft.suggestedName,
        sourceMeta: pendingSiteLibraryDraft.sourceMeta,
        insertIntoSimulation: true,
      },
    });
    clearPendingSiteLibraryDraft();
  }, [pendingSiteLibraryDraft, clearPendingSiteLibraryDraft, openMapEditor]);
  useEffect(() => {
    if (!pendingSiteLibraryOpenEntryId) return;
    const entry = siteLibrary.find((candidate) => candidate.id === pendingSiteLibraryOpenEntryId);
    if (entry) {
      openMapEditor({
        kind: "site",
        resourceId: entry.id,
        isNew: false,
        label: entry.name,
        anchorRect: { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 },
      });
    } else {
      setShowSiteLibraryManager(true);
    }
    clearOpenSiteLibraryEntryRequest();
  }, [pendingSiteLibraryOpenEntryId, siteLibrary, clearOpenSiteLibraryEntryRequest]);

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
  const ZERO_RECT = { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  const openLibraryForSite = (site: Site, triggerEl?: Element | null) => {
    const anchorRect = triggerEl?.getBoundingClientRect() ?? ZERO_RECT;
    const matchedEntry = siteLibrary.find(
      (entry) =>
        entry.name === site.name &&
        Math.abs(entry.position.lat - site.position.lat) < 0.000001 &&
        Math.abs(entry.position.lon - site.position.lon) < 0.000001,
    );
    if (matchedEntry) {
      openMapEditor({
        kind: "site",
        resourceId: matchedEntry.id,
        isNew: false,
        label: matchedEntry.name,
        anchorRect,
      });
      return;
    }
    // Site not in library yet — open new site popover pre-filled with this site's values
    openMapEditor({
      kind: "site",
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect,
      siteSeed: {
        lat: site.position.lat,
        lon: site.position.lon,
        name: site.name,
        insertIntoSimulation: true,
      },
    });
  };
  const openNewSiteForm = (triggerEl?: Element | null) => {
    openMapEditor({
      kind: "site",
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: triggerEl?.getBoundingClientRect() ?? { top: 96, right: 320, bottom: 96, left: 320, width: 0, height: 0 },
      siteSeed: { awaitMapClick: true },
    });
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
    <aside className={`sidebar-panel ${panelClassName ?? ""}`.trim()}>
      <UserAdminPanel authBootstrapPending={authBootstrapPending} extraActions={panelToggleControl} onOpenHelp={onOpenHelp} onOpenSettings={onOpenSettings} onSignInRequested={onSignInRequested} />
      <header>
        <div className="sidebar-title-row">
          <h1>{t(locale, "appTitle")}</h1>
          {envBadgeLabel ? <Badge variant={envBadgeLabel === 'LOCAL' ? 'local' : 'staging'}>{envBadgeLabel}</Badge> : null}
        </div>
      </header>
      <section className="panel-section section-scenario">
        <PanelToolbar
          title={<h2>Simulation: {simulationDisplayLabel ?? activeSimulationLabel}</h2>}
          actions={<InfoTip text="Open a simulation from the library or create a new one. A simulation is a workspace where you can add sites and tweak settings. They can be private or shared." />}
        />
        <div className="chip-group simulation-buttons">
          {!hideLibraryBrowsing ? (
            <>
              <ActionButton
                onClick={() => setShowSimulationLibraryManager(true)}
                type="button"
              >
                Library
              </ActionButton>
              <ActionButton
                onClick={(event) => {
                  openMapEditor({
                    kind: "simulation",
                    resourceId: null,
                    isNew: true,
                    label: "New Simulation",
                    anchorRect: event.currentTarget.getBoundingClientRect(),
                    simulationSeed: {
                      frequencyPresetId: getDefaultFrequencyPresetIdForNewSimulation(),
                      autoPropagationEnvironment,
                    },
                  });
                }}
                type="button"
              >
                New
              </ActionButton>
              <ActionButton onClick={saveSimulationAsNew} type="button">
                Duplicate
              </ActionButton>
              {selectedSimulationRef.startsWith("saved:") ? (
                <ActionButton onClick={(e) => openActiveSimulationDetails(e.currentTarget)} type="button">
                  Edit
                </ActionButton>
              ) : null}
            </>
          ) : (
            <span className="field-help">Sign in to browse the simulation library.</span>
          )}
        </div>
        {simulationSaveStatus ? <p className="field-help">{simulationSaveStatus}</p> : null}
      </section>

      <section className="panel-section section-sites">
        <PanelToolbar
          title={<h2>Sites</h2>}
          actions={<InfoTip text="Add a site from the site library or create a new site. You can also create or add sites from the map. A site can be private or shared." />}
        />
        {!siteLibrary.length ? <p className="field-help">No saved library sites yet.</p> : null}
        <div className="site-list">
          {sites.map((site) => (
            <div className={clsx("site-row", selectedSiteIds.includes(site.id) && "is-selected")} key={site.id}>
              <button
                className="site-row-select"
                onClick={(event) => selectSiteById(site.id, event.metaKey || event.ctrlKey)}
                type="button"
              >
                {site.name}
              </button>
              {!readOnly && (
                <div className="row-actions">
                  <ActionButton
                    aria-label="Edit site"
                    size="icon"
                    title="Edit site"
                    onClick={(e) => openLibraryForSite(site, e.currentTarget)}
                  >
                    <Pencil aria-hidden="true" strokeWidth={1.8} />
                  </ActionButton>
                  <ActionButton
                    aria-label="Remove site"
                    disabled={sites.length <= 1}
                    size="icon"
                    title="Remove site"
                    onClick={() =>
                      requestDeleteConfirm(
                        "Remove Site",
                        `Remove ${site.name} from the current simulation?`,
                        () => deleteSite(site.id),
                        "Remove",
                      )
                    }
                  >
                    <CircleMinus aria-hidden="true" strokeWidth={1.8} />
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="chip-group">
          {!hideLibraryBrowsing ? (
            <>
              {!readOnly ? (
                <ActionButton onClick={(event) => openNewSiteForm(event.currentTarget)} type="button">
                  New
                </ActionButton>
              ) : null}
              <ActionButton onClick={() => setShowSiteLibraryManager(true)} type="button">
                Library
              </ActionButton>
              {newestSiteLibraryEntryId && !readOnly ? (
                <ActionButton onClick={() => insertSiteFromLibrary(newestSiteLibraryEntryId)} type="button">
                  Insert newest
                </ActionButton>
              ) : null}
            </>
          ) : null}
        </div>
        {!hideLibraryBrowsing && readOnly ? <p className="field-help">{READ_ONLY_SIMULATION_SITE_HELP}</p> : null}
      </section>

      <section className="panel-section section-path">
        <PanelToolbar
          title={<h2>Links</h2>}
          actions={<InfoTip text={`Select multiple sites by ${isMac ? "Cmd" : "Ctrl"}+Clicking to instantly view a link. When a link is active on the map, you can save it permanently to this simulation by pressing "Save" in the inspector.`} />}
        />
        <div className="link-list">
          {visibleLinks.map((link) => (
            <div className={clsx("link-item", selectedLinkId === link.id && "is-selected")} key={link.id}>
              <button
                className="link-item-select"
                onClick={() => setSelectedLinkId(link.id)}
                type="button"
              >
                <span className="link-title">{displayLinkName(link.id, link.name)}</span>
              </button>
              {!readOnly && (
                <div className="row-actions">
                  <ActionButton
                    aria-label="Edit link"
                    size="icon"
                    title="Edit link"
                    onClick={(e) => {
                      openMapEditor({
                        kind: "link",
                        resourceId: link.id,
                        isNew: false,
                        label: link.name ?? displayLinkName(link.id),
                        anchorRect: e.currentTarget.getBoundingClientRect(),
                      });
                    }}
                  >
                    <Pencil aria-hidden="true" strokeWidth={1.8} />
                  </ActionButton>
                  <ActionButton
                    aria-label="Remove link"
                    size="icon"
                    title="Remove link"
                    onClick={() =>
                      requestDeleteConfirm(
                        "Delete Link",
                        `Delete link "${displayLinkName(link.id, link.name)}"?`,
                        () => deleteLink(link.id),
                      )
                    }
                  >
                    <CircleMinus aria-hidden="true" strokeWidth={1.8} />
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="chip-group">
          {!readOnly ? (
            <ActionButton
              disabled={sites.length < 2}
              onClick={(e) => {
                openMapEditor({
                  kind: "link",
                  resourceId: null,
                  isNew: true,
                  label: "New Link",
                  anchorRect: e.currentTarget.getBoundingClientRect(),
                });
              }}
              type="button"
            >
              New
            </ActionButton>
          ) : null}
        </div>
      </section>

      <div className="sidebar-grow" />
      <footer className="sidebar-footer">
        <div className="sidebar-footer-links">
          <span>©</span>
          <a href={resolvedBasemap.attributionUrl} rel="noreferrer" target="_blank">
            {resolvedBasemap.attribution.replace(/©/g, "").trim()}
          </a>
          <span>©</span>
          <a href="https://github.com/maplibre/maplibre-gl-js" rel="noreferrer" target="_blank">
            MapLibre
          </a>
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
              <InlineCloseIconButton onClick={() => setProfilePopupUser(null)} />
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
                <ActionButton
                  disabled={profilePopupBusy}
                  onClick={() => void changeProfileRole("user")}
                  type="button"
                >
                  Approve Access
                </ActionButton>
              ) : null}
            </div>
            {profilePopupStatus ? <p className="field-help">{profilePopupStatus}</p> : null}
          </div>
        </ModalOverlay>
      ) : null}

      {showSimulationLibraryManager && !hideLibraryBrowsing ? (
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
            onOpenDetails={(params) => {
              setShowSimulationLibraryManager(false);
              openMapEditor({
                kind: params.kind,
                resourceId: params.resourceId,
                isNew: false,
                label: params.label,
                anchorRect: params.anchorRect,
              });
            }}
            onCreateSimulation={(triggerEl) => {
              setShowSimulationLibraryManager(false);
              openMapEditor({
                kind: "simulation",
                resourceId: null,
                isNew: true,
                label: "New Simulation",
                anchorRect: triggerEl?.getBoundingClientRect() ?? { top: 96, right: 320, bottom: 96, left: 320, width: 0, height: 0 },
                simulationSeed: {
                  frequencyPresetId: getDefaultFrequencyPresetIdForNewSimulation(),
                  autoPropagationEnvironment,
                },
              });
            }}
          />
        </ModalOverlay>
      ) : null}

      {showSiteLibraryManager && !hideLibraryBrowsing ? (
        <ModalOverlay
          aria-label="Site Library"
          onClose={() => {
            setShowSiteLibraryManager(false);
            closeSiteFilterEditors();
          }}
        >
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Site Library</h2>
              <InlineCloseIconButton
                onClick={() => {
                  setShowSiteLibraryManager(false);
                  closeSiteFilterEditors();
                }}
              />
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
                <ActionButton
                  className={clsx("library-filter-trigger", {
                    "library-filter-trigger-active": selectionIsFiltered(siteLibraryFilters.roleFilters, ALL_ROLE_FILTERS),
                  })}
                  onClick={openSiteRoleEditor}
                  type="button"
                >
                  Ownership {selectionLabel(siteLibraryFilters.roleFilters, ALL_ROLE_FILTERS)}
                  <span className="library-filter-trigger-chevron" aria-hidden="true">
                    <Funnel aria-hidden="true" strokeWidth={1.8} />
                  </span>
                </ActionButton>
                {openSiteFilterGroup === "role" ? (
                  <div className="library-filter-popover">
                    <div className="library-filter-popover-actions">
                      <ActionButton onClick={() => commitSiteRoleFilters(ALL_ROLE_FILTERS)} type="button">
                        All
                      </ActionButton>
                      <ActionButton onClick={() => setSiteRoleDraft([])} type="button">
                        None
                      </ActionButton>
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
                <ActionButton
                  className={clsx("library-filter-trigger", {
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
                </ActionButton>
                {openSiteFilterGroup === "visibility" ? (
                  <div className="library-filter-popover">
                    <div className="library-filter-popover-actions">
                      <ActionButton
                        onClick={() => commitSiteVisibilityFilters(ALL_VISIBILITY_FILTERS)}
                        type="button"
                      >
                        All
                      </ActionButton>
                      <ActionButton onClick={() => setSiteVisibilityDraft([])} type="button">
                        None
                      </ActionButton>
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
                <ActionButton
                  className={clsx("library-filter-trigger", {
                    "library-filter-trigger-active": selectionIsFiltered(siteLibraryFilters.sourceFilters, ALL_SITE_SOURCE_FILTERS),
                  })}
                  onClick={openSiteSourceEditor}
                  type="button"
                >
                  Source {selectionLabel(siteLibraryFilters.sourceFilters, ALL_SITE_SOURCE_FILTERS)}
                  <span className="library-filter-trigger-chevron" aria-hidden="true">
                    <Funnel aria-hidden="true" strokeWidth={1.8} />
                  </span>
                </ActionButton>
                {openSiteFilterGroup === "source" ? (
                  <div className="library-filter-popover">
                    <div className="library-filter-popover-actions">
                      <ActionButton
                        onClick={() => commitSiteSourceFilters(ALL_SITE_SOURCE_FILTERS)}
                        type="button"
                      >
                        All
                      </ActionButton>
                      <ActionButton onClick={() => setSiteSourceDraft([])} type="button">
                        None
                      </ActionButton>
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

              <ActionButton
                onClick={() => {
                  setSiteLibraryFilters(DEFAULT_LIBRARY_FILTER_STATE);
                  closeSiteFilterEditors();
                }}
                type="button"
              >
                Clear Filters
              </ActionButton>
            </div>
            <div className="chip-group">
              <ActionButton
                onClick={(event) => {
                  setShowSiteLibraryManager(false);
                  openMapEditor({
                    kind: "site",
                    resourceId: null,
                    isNew: true,
                    label: "New Site",
                    anchorRect: event.currentTarget.getBoundingClientRect(),
                    siteSeed: { awaitMapClick: true },
                  });
                }}
                type="button"
              >
                New
              </ActionButton>
              <ActionButton
                onClick={() => setSelectedLibraryIds(new Set(filteredSiteLibrary.map((entry) => entry.id)))}
                type="button"
              >
                Select Filtered ({filteredSiteLibrary.length})
              </ActionButton>
              <ActionButton onClick={() => setSelectedLibraryIds(new Set())} type="button">
                Clear Selection
              </ActionButton>
              <ActionButton
                disabled={!selectedLibraryCount}
                onClick={() => {
                  insertSitesFromLibrary(Array.from(selectedLibraryIds));
                  setSelectedLibraryIds(new Set());
                }}
                type="button"
              >
                Add Selected To Simulation ({selectedLibraryCount})
              </ActionButton>
              <ActionButton
                disabled={!selectedLibraryCount}
                onClick={() => {
                  const deletedIds = Array.from(selectedLibraryIds);
                  const affectedSims = simulationPresets.filter((p) =>
                    p.snapshot.sites.some((s) => s.libraryEntryId && selectedLibraryIds.has(s.libraryEntryId)),
                  );
                  let msg = `Delete ${selectedLibraryCount} selected site(s) from the library? This cannot be undone.`;
                  if (affectedSims.length > 0) {
                    const names = affectedSims.map((p) => `"${p.name}"`).join(", ");
                    msg += ` Referenced in ${affectedSims.length} simulation(s): ${names}. Sites will be detached but simulation data will not be lost.`;
                  }
                  requestDeleteConfirm(
                    "Delete Sites",
                    msg,
                    () => {
                      deleteSiteLibraryEntries(deletedIds);
                      setSelectedLibraryIds(new Set());
                    },
                  );
                }}
                type="button"
                variant="danger"
              >
                Delete Selected ({selectedLibraryCount})
              </ActionButton>
            </div>
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
                    {(() => { const v = toAccessVisibility((entry as { visibility?: unknown }).visibility); return <Badge variant={v as "private" | "public" | "shared"}>{v}</Badge>; })()}
                    {(entry as { sourceMeta?: { sourceType?: string } }).sourceMeta?.sourceType === "mqtt-feed" ? (
                      <Badge variant="mqtt">MQTT</Badge>
                    ) : null}
                    <button
                      className="row-avatar owner-avatar"
                      onClick={() => void openUserProfilePopup((entry as { ownerUserId?: string }).ownerUserId)}
                      title={`Owner: ${owner.name}`}
                      type="button"
                    >
                      <AvatarBadge
                        avatarUrl={owner.avatarUrl}
                        fallbackRawText
                        imageClassName="row-avatar-image"
                        name={owner.name}
                      />
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
                            <AvatarBadge
                              avatarUrl={avatarUrl}
                              fallbackRawText
                              imageClassName="row-avatar-image"
                              name={name}
                            />
                          </button>
                        );
                      }))}
                  </span>
                      </>
                    );
                  })()}
                  <div className="library-row-actions">
                    {readOnly ? (
                      <span className="field-help">{READ_ONLY_SIMULATION_SITE_HELP}</span>
                    ) : (
                      <ActionButton onClick={() => insertSiteFromLibrary(entry.id)} type="button">
                        Add to simulation
                      </ActionButton>
                    )}
                    <ActionButton
                      onClick={(e) => {
                        setShowSiteLibraryManager(false);
                        openMapEditor({
                          kind: "site",
                          resourceId: entry.id,
                          isNew: false,
                          label: entry.name,
                          anchorRect: e.currentTarget.getBoundingClientRect(),
                        });
                      }}
                      type="button"
                    >
                      Open
                    </ActionButton>
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
              <InlineCloseIconButton onClick={() => setDeleteConfirm(null)} />
            </div>
            <p className="field-help">{deleteConfirm.message}</p>
            <div className="chip-group">
              <ActionButton onClick={() => setDeleteConfirm(null)} type="button">
                Cancel
              </ActionButton>
              <ActionButton
                onClick={() => {
                  const action = deleteConfirm.onConfirm;
                  setDeleteConfirm(null);
                  action();
                }}
                type="button"
                variant="danger"
              >
                {deleteConfirm.confirmLabel}
              </ActionButton>
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </aside>
  );
}
