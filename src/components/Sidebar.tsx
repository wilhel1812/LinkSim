import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert, CircleMinus, Handshake, HatGlasses, Info, Pencil } from "lucide-react";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { t } from "../i18n/locales";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { buildLabelForChannel } from "../lib/buildInfo";
import { getBasemapAttributionCredits, resolveBasemapSelection, type RenderedBasemapAttribution } from "../lib/basemaps";
import { parseDeepLinkFromLocation } from "../lib/deepLink";
import { toAccessVisibility } from "../lib/uiFormatting";
import { useAppStore } from "../store/appStore";
import type { Site } from "../types/radio";
import { siDiscord, siGithub, siMatrix } from "simple-icons";
import { InfoTip } from "./InfoTip";
import { ActionButton } from "./ActionButton";
import { ConfirmActionModal } from "./ConfirmActionModal";
import { Badge } from "./ui/Badge";
import { PanelToolbar } from "./ui/PanelToolbar";
import { UserAdminPanel } from "./UserAdminPanel";
import { BasemapAttributionLinks } from "./BasemapAttributionLinks";

const READ_ONLY_SIMULATION_SITE_HELP =
  "Read-only: you need edit permission to add or edit sites in this simulation.";
const READ_ONLY_VIEW_DETAILS_HELP =
  "Read-only: you can view this item, but need edit permission to change it.";
const PRIVATE_SITE_DISCLOSURE_NOTICE =
  "This Simulation is Shared and includes Private Sites. Those Sites are visible to anyone who can access this Simulation.";
const PRIVATE_SITE_DISCLOSURE_TOOLTIP =
  "This Site is Private in the Library, but is visible to anyone who can access this Shared Simulation.";

const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";
const hasDeepLinkSimulationInSearch = (search: string, pathname: string): boolean =>
  parseDeepLinkFromLocation({ search, pathname }).ok;

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
  renderedBasemapAttribution?: RenderedBasemapAttribution | null;
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
  renderedBasemapAttribution,
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
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const simulationDefaultsOverrideEnabled = useAppStore((state) => state.simulationDefaultsOverrideEnabled);
  const simulationDefaultsOverride = useAppStore((state) => state.simulationDefaultsOverride);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const scenarioOptions = useAppStore((state) => state.scenarioOptions);
  const locale = useAppStore((state) => state.locale);
  const selectScenario = useAppStore((state) => state.selectScenario);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const selectSiteById = useAppStore((state) => state.selectSiteById);
  const basemapStyleId = useAppStore((state) => state.basemapStyleId);
  const currentUser = useAppStore((state) => state.currentUser);
  const pendingSiteLibraryDraft = useAppStore((state) => state.pendingSiteLibraryDraft);
  const clearPendingSiteLibraryDraft = useAppStore((state) => state.clearPendingSiteLibraryDraft);
  const pendingSiteLibraryOpenEntryId = useAppStore((state) => state.pendingSiteLibraryOpenEntryId);
  const clearOpenSiteLibraryEntryRequest = useAppStore((state) => state.clearOpenSiteLibraryEntryRequest);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const openMapEditor = useAppStore((state) => state.openMapEditor);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const deleteLink = useAppStore((state) => state.deleteLink);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const showNewSimulationRequest = useAppStore((state) => state.showNewSimulationRequest);
  const setShowNewSimulationRequest = useAppStore((state) => state.setShowNewSimulationRequest);
  const getDefaultFrequencyPresetIdForNewSimulation = useAppStore(
    (state) => state.getDefaultFrequencyPresetIdForNewSimulation,
  );
  const openLibrary = useAppStore((state) => state.openLibrary);
  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapStyleId, theme, colorTheme, currentUser?.basemapPreferences?.customSources ?? []),
    [basemapStyleId, colorTheme, currentUser?.basemapPreferences?.customSources, theme],
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
  const [deleteConfirm, setDeleteConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
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
  const privateReferencedLibrarySiteIds = useMemo(() => {
    if (readOnly || !selectedScenarioId) return new Set<string>();
    const activeSimulation = simulationPresets.find((simulation) => simulation.id === selectedScenarioId);
    if (!activeSimulation || toAccessVisibility(activeSimulation.visibility) !== "shared") return new Set<string>();
    const privateLibraryIds = new Set(
      siteLibrary
        .filter((entry) => toAccessVisibility(entry.visibility) === "private")
        .map((entry) => entry.id),
    );
    return new Set(
      activeSimulation.snapshot.sites
        .map((site) => site.libraryEntryId)
        .filter((id): id is string => Boolean(id && privateLibraryIds.has(id))),
    );
  }, [readOnly, selectedScenarioId, simulationPresets, siteLibrary]);
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
      readOnly,
    });
  };
  const openSimulationCopyEditor = (triggerEl?: Element | null) => {
    const activeSavedPreset = selectedScenarioId ? simulationPresets.find((preset) => preset.id === selectedScenarioId) : null;
    const baseName = activeSavedPreset?.name ?? simulationDisplayLabel ?? activeSimulationLabel;
    const suggestedName = baseName && baseName !== "no simulation selected" ? `${baseName} Copy` : "Copy of current simulation";
    openMapEditor({
      kind: "simulation",
      resourceId: null,
      isNew: true,
      label: "Save a copy",
      anchorRect: triggerEl?.getBoundingClientRect() ?? { top: 96, right: 320, bottom: 96, left: 320, width: 0, height: 0 },
      simulationSeed: {
        copyCurrentSimulation: true,
        name: suggestedName,
        description: activeSavedPreset?.description,
        frequencyPresetId: selectedFrequencyPresetId,
        autoPropagationEnvironment,
        simulationDefaultsOverrideEnabled,
        simulationDefaultsOverride: simulationDefaultsOverrideEnabled ? simulationDefaultsOverride : null,
      },
    });
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
      openLibrary("sites");
    }
    clearOpenSiteLibraryEntryRequest();
  }, [pendingSiteLibraryOpenEntryId, siteLibrary, clearOpenSiteLibraryEntryRequest, openLibrary]);

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
                onClick={() => openLibrary("simulations")}
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
              <ActionButton onClick={(event) => openSimulationCopyEditor(event.currentTarget)} type="button">
                Save a copy
              </ActionButton>
              {selectedSimulationRef.startsWith("saved:") ? (
                <ActionButton onClick={(e) => openActiveSimulationDetails(e.currentTarget)} type="button">
                  {readOnly ? "View details" : "Edit"}
                </ActionButton>
              ) : null}
            </>
          ) : (
            <span className="field-help">Sign in to browse the simulation library.</span>
          )}
        </div>
        {privateReferencedLibrarySiteIds.size ? (
          <div className="app-notification-item app-notification-item-warning app-notification-item-static" role="status">
            <span className="app-notification-glyph" aria-hidden="true">
              <CircleAlert size={14} strokeWidth={2} />
            </span>
            <div className="app-notification-copy">
              <span>{PRIVATE_SITE_DISCLOSURE_NOTICE}</span>
            </div>
          </div>
        ) : null}
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
              {site.libraryEntryId && privateReferencedLibrarySiteIds.has(site.libraryEntryId) ? (
                <InfoTip text={PRIVATE_SITE_DISCLOSURE_TOOLTIP} />
              ) : null}
              <div className="row-actions">
                {readOnly ? (
                  <ActionButton
                    aria-label={`View site details: ${site.name}. ${READ_ONLY_VIEW_DETAILS_HELP}`}
                    size="icon"
                    title={READ_ONLY_VIEW_DETAILS_HELP}
                    onClick={(e) => {
                      openMapEditor({
                        kind: "site",
                        resourceId: site.id,
                        isNew: false,
                        label: site.name,
                        anchorRect: e.currentTarget.getBoundingClientRect(),
                        readOnly: true,
                      });
                    }}
                  >
                    <Info aria-hidden="true" strokeWidth={1.8} />
                  </ActionButton>
                ) : (
                  <>
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
                  </>
                )}
              </div>
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
              <ActionButton onClick={() => openLibrary("sites")} type="button">
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
              <div className="row-actions">
                {readOnly ? (
                  <ActionButton
                    aria-label={`View link details: ${displayLinkName(link.id, link.name)}. ${READ_ONLY_VIEW_DETAILS_HELP}`}
                    size="icon"
                    title={READ_ONLY_VIEW_DETAILS_HELP}
                    onClick={(e) => {
                      openMapEditor({
                        kind: "link",
                        resourceId: link.id,
                        isNew: false,
                        label: link.name ?? displayLinkName(link.id),
                        anchorRect: e.currentTarget.getBoundingClientRect(),
                        readOnly: true,
                      });
                    }}
                  >
                    <Info aria-hidden="true" strokeWidth={1.8} />
                  </ActionButton>
                ) : (
                  <>
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
                  </>
                )}
              </div>
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
          <BasemapAttributionLinks credits={renderedBasemapAttribution?.credits ?? getBasemapAttributionCredits(resolvedBasemap)} />
        </div>
        <div className="sidebar-footer-links sidebar-footer-icon-links">
          <a
            aria-label="Terms"
            href="https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/TERMS.md"
            rel="noreferrer"
            target="_blank"
            title="Terms"
          >
            <Handshake aria-hidden="true" size={13} strokeWidth={1.8} />
          </a>
          <a
            aria-label="Privacy"
            href="https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/PRIVACY.md"
            rel="noreferrer"
            target="_blank"
            title="Privacy"
          >
            <HatGlasses aria-hidden="true" size={13} strokeWidth={1.8} />
          </a>
          <a
            aria-label="GitHub"
            href="https://github.com/wilhel1812/LinkSim"
            rel="noreferrer"
            target="_blank"
            title="GitHub"
          >
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
          </a>
          <a
            aria-label="Matrix"
            href="https://matrix.to/#/#linksim:matrix.org"
            rel="noreferrer"
            target="_blank"
            title="Matrix"
          >
            <svg
              aria-hidden="true"
              height="13"
              role="img"
              viewBox="0 0 24 24"
              width="13"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d={siMatrix.path} fill="currentColor" />
            </svg>
          </a>
          <a
            aria-label="Discord"
            href="https://discord.gg/Sg2FN7EJW"
            rel="noreferrer"
            target="_blank"
            title="Discord"
          >
            <svg
              aria-hidden="true"
              height="13"
              role="img"
              viewBox="0 0 24 24"
              width="13"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d={siDiscord.path} fill="currentColor" />
            </svg>
          </a>
        </div>
        <div className="sidebar-footer-version">
          Build: {buildLabel} (
          {runtimeEnvironment === "production" ? "live-prod" : runtimeEnvironment === "local" ? "local" : "live-test"})
        </div>
      </footer>

      {deleteConfirm ? (
        <ConfirmActionModal
          confirmLabel={deleteConfirm.confirmLabel}
          message={deleteConfirm.message}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => {
            const action = deleteConfirm.onConfirm;
            setDeleteConfirm(null);
            action();
          }}
          title={deleteConfirm.title}
        />
      ) : null}
    </aside>
  );
}
