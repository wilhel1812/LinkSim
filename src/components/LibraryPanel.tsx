import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Filter, Menu, X } from "lucide-react";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  filterAndSortLibraryItems,
  type LibraryFilterRole,
  type LibraryFilterSource,
  type LibraryFilterState,
  type LibraryFilterVisibility,
} from "../lib/libraryFilters";
import { persistLibraryFilterState, readLibraryFilterState } from "../lib/libraryFilterUi";
import { formatDate } from "../lib/locale";
import { toAccessVisibility } from "../lib/uiFormatting";
import { useAppStore, type LibraryTab } from "../store/appStore";
import { ActionButton } from "./ActionButton";
import { AvatarBadge } from "./AvatarBadge";
import { ConfirmActionModal } from "./ConfirmActionModal";
import { InlineCloseIconButton } from "./InlineCloseIconButton";
import { ModalOverlay } from "./ModalOverlay";
import { Badge } from "./ui/Badge";
import { FloatingPopover } from "./ui/FloatingPopover";
import { Surface } from "./ui/Surface";
import { SettingsNav, type SettingsNavItem } from "./settings/SettingsNav";

const SITE_LIBRARY_FILTERS_KEY = "rmw-site-library-filters-v1";
const SIMULATION_LIBRARY_FILTERS_KEY = "rmw-simulation-library-filters-v1";
const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";

const ROLE_FILTER_OPTIONS: Array<{ key: LibraryFilterRole; label: string }> = [
  { key: "owned", label: "Owned" },
  { key: "collaborator", label: "Collaborator" },
  { key: "editable", label: "Editable" },
  { key: "viewOnly", label: "View-only" },
];
const VISIBILITY_FILTER_OPTIONS: Array<{ key: LibraryFilterVisibility; label: string }> = [
  { key: "private", label: "Private" },
  { key: "sharedPublic", label: "Shared or Public" },
];
const SOURCE_FILTER_OPTIONS: Array<{ key: LibraryFilterSource; label: string }> = [
  { key: "manual", label: "Manual" },
  { key: "mqtt", label: "MQTT" },
];

type LibraryPanelProps = {
  initialTab: LibraryTab;
  isMobile: boolean;
  onClose: () => void;
  onOpenUserProfile?: (userId: string, anchor: HTMLElement) => void;
  readOnly: boolean;
};

const cloneDefaultFilters = (): LibraryFilterState => ({
  ...DEFAULT_LIBRARY_FILTER_STATE,
  roleFilters: [...DEFAULT_LIBRARY_FILTER_STATE.roleFilters],
  visibilityFilters: [...DEFAULT_LIBRARY_FILTER_STATE.visibilityFilters],
  sourceFilters: [...DEFAULT_LIBRARY_FILTER_STATE.sourceFilters],
});

const toggleDraftValue = <T extends string>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];

const canEditResource = (
  resource: { ownerUserId?: string; effectiveRole?: string },
  currentUserId: string | null,
) =>
  Boolean(
    currentUserId &&
      (resource.ownerUserId === currentUserId ||
        resource.effectiveRole === "owner" ||
        resource.effectiveRole === "admin" ||
        resource.effectiveRole === "editor"),
  );

export function LibraryPanel({
  initialTab,
  isMobile,
  onClose,
  onOpenUserProfile,
  readOnly,
}: LibraryPanelProps) {
  const currentUser = useAppStore((state) => state.currentUser);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const scenarioOptions = useAppStore((state) => state.scenarioOptions);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const isOnline = useAppStore((state) => state.isOnline);
  const syncErrorMessage = useAppStore((state) => state.syncErrorMessage);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const insertSitesFromLibrary = useAppStore((state) => state.insertSitesFromLibrary);
  const deleteSiteLibraryEntries = useAppStore((state) => state.deleteSiteLibraryEntries);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const openMapEditor = useAppStore((state) => state.openMapEditor);
  const getDefaultFrequencyPresetIdForNewSimulation = useAppStore(
    (state) => state.getDefaultFrequencyPresetIdForNewSimulation,
  );

  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);
  const [siteFilters, setSiteFilters] = useState<LibraryFilterState>(() =>
    readLibraryFilterState(SITE_LIBRARY_FILTERS_KEY),
  );
  const [simulationFilters, setSimulationFilters] = useState<LibraryFilterState>(() =>
    readLibraryFilterState(SIMULATION_LIBRARY_FILTERS_KEY),
  );
  const [filterDraft, setFilterDraft] = useState<LibraryFilterState | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(true);
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(new Set());
  const [deleteSelection, setDeleteSelection] = useState<string[] | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Record<LibraryTab, number>>({ sites: 0, simulations: 0 });

  useEffect(() => {
    setActiveTab(initialTab);
    setMobileDetailOpen(true);
  }, [initialTab]);
  useEffect(() => persistLibraryFilterState(SITE_LIBRARY_FILTERS_KEY, siteFilters), [siteFilters]);
  useEffect(
    () => persistLibraryFilterState(SIMULATION_LIBRARY_FILTERS_KEY, simulationFilters),
    [simulationFilters],
  );

  const currentUserId = currentUser?.id ?? null;
  const activeFilters = activeTab === "sites" ? siteFilters : simulationFilters;
  const sectionItems = useMemo<SettingsNavItem<LibraryTab>[]>(
    () => [
      { id: "sites", label: "Sites", description: "Saved locations and radio details" },
      { id: "simulations", label: "Simulations", description: "Saved workspaces and scenarios" },
    ],
    [],
  );
  const setActiveFilters = (next: LibraryFilterState) => {
    if (activeTab === "sites") setSiteFilters(next);
    else setSimulationFilters(next);
  };
  const activeSavedSimulation = simulationPresets.find((preset) => preset.id === selectedScenarioId);
  const activeBuiltinSimulation = scenarioOptions.some((scenario) => scenario.id === selectedScenarioId);
  const canAddToActiveSimulation = Boolean(
    !readOnly &&
      selectedScenarioId &&
      (activeBuiltinSimulation || (activeSavedSimulation && canEditResource(activeSavedSimulation, currentUserId))),
  );

  const filteredSites = useMemo(
    () =>
      filterAndSortLibraryItems(
        siteLibrary,
        siteFilters,
        currentUserId,
        (entry) => `${entry.name} ${entry.position.lat} ${entry.position.lon}`,
        (entry, source) =>
          source === "mqtt"
            ? entry.sourceMeta?.sourceType === "mqtt-feed"
            : entry.sourceMeta?.sourceType !== "mqtt-feed",
      ),
    [currentUserId, siteFilters, siteLibrary],
  );
  const filteredSimulations = useMemo(
    () =>
      filterAndSortLibraryItems(
        simulationPresets,
        simulationFilters,
        currentUserId,
        (preset) => `${preset.name} ${preset.description ?? ""} ${preset.updatedAt}`,
      ),
    [currentUserId, simulationFilters, simulationPresets],
  );

  const openFilters = () => {
    setFilterDraft({
      ...activeFilters,
      roleFilters: [...activeFilters.roleFilters],
      visibilityFilters: [...activeFilters.visibilityFilters],
      sourceFilters: [...activeFilters.sourceFilters],
    });
    setFiltersOpen(true);
  };
  const closeFilters = () => {
    setFiltersOpen(false);
    setFilterDraft(null);
  };
  const rememberScrollPosition = () => {
    if (listRef.current) scrollPositionsRef.current[activeTab] = listRef.current.scrollTop;
  };
  const selectSection = (section: LibraryTab) => {
    rememberScrollPosition();
    setActiveTab(section);
    setMobileDetailOpen(true);
    closeFilters();
  };
  const openSectionList = () => {
    rememberScrollPosition();
    setMobileDetailOpen(false);
    closeFilters();
  };

  useLayoutEffect(() => {
    if (!mobileDetailOpen || !listRef.current) return;
    listRef.current.scrollTop = scrollPositionsRef.current[activeTab];
  }, [activeTab, mobileDetailOpen]);
  const applyFilters = () => {
    if (filterDraft) setActiveFilters(filterDraft);
    closeFilters();
  };
  const clearFilters = () => {
    const reset = cloneDefaultFilters();
    setFilterDraft(reset);
    setActiveFilters(reset);
    closeFilters();
  };
  const filterCount =
    activeFilters.roleFilters.length !== DEFAULT_LIBRARY_FILTER_STATE.roleFilters.length ||
    activeFilters.visibilityFilters.length > 0 ||
    (activeTab === "sites" && activeFilters.sourceFilters.length > 0) ||
    activeFilters.sort !== "nameAsc"
      ? 1
      : 0;

  const openSiteDetails = (entry: (typeof siteLibrary)[number], anchor: HTMLElement) => {
    openMapEditor({
      kind: "site",
      resourceId: entry.id,
      isNew: false,
      label: entry.name,
      anchorRect: anchor.getBoundingClientRect(),
      readOnly: !canEditResource(entry, currentUserId),
      origin: { kind: "library", tab: "sites" },
    });
  };
  const openSimulationDetails = (preset: (typeof simulationPresets)[number], anchor: HTMLElement) => {
    openMapEditor({
      kind: "simulation",
      resourceId: preset.id,
      isNew: false,
      label: preset.name,
      anchorRect: anchor.getBoundingClientRect(),
      readOnly: !canEditResource(preset, currentUserId),
      origin: { kind: "library", tab: "simulations" },
    });
  };
  const openNewSite = (anchor: HTMLElement) => {
    openMapEditor({
      kind: "site",
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: anchor.getBoundingClientRect(),
      siteSeed: { awaitMapClick: true },
      origin: { kind: "library", tab: "sites" },
    });
  };
  const openNewSimulation = (anchor: HTMLElement) => {
    openMapEditor({
      kind: "simulation",
      resourceId: null,
      isNew: true,
      label: "New Simulation",
      anchorRect: anchor.getBoundingClientRect(),
      simulationSeed: {
        frequencyPresetId: getDefaultFrequencyPresetIdForNewSimulation(),
        autoPropagationEnvironment,
      },
      origin: { kind: "library", tab: "simulations" },
    });
  };
  const openSimulationCopy = (anchor: HTMLElement) => {
    const activeName = activeSavedSimulation?.name;
    openMapEditor({
      kind: "simulation",
      resourceId: null,
      isNew: true,
      label: "Save a copy",
      anchorRect: anchor.getBoundingClientRect(),
      simulationSeed: {
        copyCurrentSimulation: true,
        name: activeName ? `${activeName} Copy` : "Copy of current simulation",
        autoPropagationEnvironment,
      },
      origin: { kind: "library", tab: "simulations" },
    });
  };

  const closeAndAddSite = (entryId: string) => {
    if (!canAddToActiveSimulation) return;
    insertSiteFromLibrary(entryId);
    onClose();
  };
  const closeAndLoadSimulation = (presetId: string) => {
    loadSimulationPreset(presetId);
    try {
      localStorage.setItem(LAST_SIMULATION_REF_KEY, `saved:${presetId}`);
    } catch {
      // Best effort only.
    }
    onClose();
  };

  const filterPanel = filterDraft ? (
    <div className="library-filter-panel">
      <fieldset>
        <legend>Ownership</legend>
        <div className="library-filter-options">
          {ROLE_FILTER_OPTIONS.map((option) => (
            <label className="checkbox-field" key={option.key}>
              <input
                checked={filterDraft.roleFilters.includes(option.key)}
                onChange={() =>
                  setFilterDraft((current) =>
                    current
                      ? { ...current, roleFilters: toggleDraftValue(current.roleFilters, option.key) }
                      : current,
                  )
                }
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Access level</legend>
        <div className="library-filter-options">
          {VISIBILITY_FILTER_OPTIONS.map((option) => (
            <label className="checkbox-field" key={option.key}>
              <input
                checked={filterDraft.visibilityFilters.includes(option.key)}
                onChange={() =>
                  setFilterDraft((current) =>
                    current
                      ? {
                          ...current,
                          visibilityFilters: toggleDraftValue(current.visibilityFilters, option.key),
                        }
                      : current,
                  )
                }
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {activeTab === "sites" ? (
        <fieldset>
          <legend>Source</legend>
          <div className="library-filter-options">
            {SOURCE_FILTER_OPTIONS.map((option) => (
              <label className="checkbox-field" key={option.key}>
                <input
                  checked={filterDraft.sourceFilters.includes(option.key)}
                  onChange={() =>
                    setFilterDraft((current) =>
                      current
                        ? { ...current, sourceFilters: toggleDraftValue(current.sourceFilters, option.key) }
                        : current,
                    )
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset>
        <legend>Sort</legend>
        <div className="library-filter-options">
          <label className="checkbox-field">
            <input
              checked={filterDraft.sort === "nameAsc"}
              name={`library-sort-${activeTab}`}
              onChange={() => setFilterDraft((current) => (current ? { ...current, sort: "nameAsc" } : current))}
              type="radio"
            />
            <span>Name A–Z</span>
          </label>
          <label className="checkbox-field">
            <input
              checked={filterDraft.sort === "recentDesc"}
              name={`library-sort-${activeTab}`}
              onChange={() =>
                setFilterDraft((current) => (current ? { ...current, sort: "recentDesc" } : current))
              }
              type="radio"
            />
            <span>{activeTab === "sites" ? "Recently created" : "Recently updated"}</span>
          </label>
        </div>
      </fieldset>
      <div className="chip-group library-filter-actions">
        <ActionButton onClick={clearFilters} type="button">Clear</ActionButton>
        <ActionButton onClick={closeFilters} type="button">Cancel</ActionButton>
        <ActionButton onClick={applyFilters} type="button">Apply</ActionButton>
      </div>
    </div>
  ) : null;

  const ownerDisplay = (resource: {
    ownerUserId?: string;
    createdByName?: string;
    createdByAvatarUrl?: string;
  }) => ({
    name: resource.createdByName?.trim() || resource.ownerUserId || "Unknown",
    avatarUrl: resource.createdByAvatarUrl ?? "",
  });

  const showSectionList = !isMobile || !mobileDetailOpen;
  const showSectionDetail = !isMobile || mobileDetailOpen;
  const activeSectionLabel = activeTab === "sites" ? "Sites" : "Simulations";

  return (
    <div className="settings-panel library-panel">
      <header className="settings-panel-header">
        <div className="settings-panel-header-lead">
          {isMobile && mobileDetailOpen ? (
            <button
              aria-label="Open Library sections"
              className="settings-panel-menu"
              onClick={openSectionList}
              type="button"
            >
              <Menu aria-hidden="true" size={20} strokeWidth={2} />
            </button>
          ) : null}
          <h2 className="settings-panel-title">
            {isMobile && mobileDetailOpen ? activeSectionLabel : "Library"}
          </h2>
        </div>
        <button
          aria-label="Close Library"
          className="settings-panel-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={20} strokeWidth={2} />
        </button>
      </header>

      <div className="settings-panel-body">
        {showSectionList ? (
          <aside className="settings-panel-sidebar library-panel-sidebar">
            <SettingsNav
              activeSection={activeTab}
              ariaLabel="Library sections"
              items={sectionItems}
              layout={isMobile ? "list" : "sidebar"}
              onSelect={selectSection}
            />
          </aside>
        ) : null}
        {showSectionDetail ? (
          <main className="settings-panel-content library-panel-content">
            <div className="library-search-row">
              <input
                aria-label={`Search ${activeSectionLabel}`}
                onChange={(event) => setActiveFilters({ ...activeFilters, searchQuery: event.target.value })}
                placeholder={activeTab === "sites" ? "Search by name or coordinates" : "Search Simulations"}
                role="searchbox"
                type="search"
                value={activeFilters.searchQuery}
              />
              <ActionButton
                aria-expanded={filtersOpen}
                aria-label={`Filter and sort ${activeSectionLabel}${filterCount ? `, active` : ""}`}
                onClick={filtersOpen ? closeFilters : openFilters}
                ref={filterTriggerRef}
                type="button"
              >
                <Filter aria-hidden="true" size={16} strokeWidth={1.8} />
                Filter and sort{filterCount ? " · Active" : ""}
              </ActionButton>
            </div>
            {isMobile ? (
              filtersOpen ? (
                <ModalOverlay
                  aria-label={`Filter and sort ${activeSectionLabel}`}
                  className="library-filter-sheet-overlay"
                  onClose={closeFilters}
                  tier="raised"
                >
                  <Surface className="library-filter-sheet" variant="card">
                    <div className="library-manager-header">
                      <h2>Filter and sort</h2>
                      <InlineCloseIconButton onClick={closeFilters} />
                    </div>
                    {filterPanel}
                  </Surface>
                </ModalOverlay>
              ) : null
            ) : (
              <FloatingPopover
                className="library-filter-floating"
                estimatedHeight={520}
                estimatedWidth={360}
                onClose={closeFilters}
                open={filtersOpen}
                triggerRef={filterTriggerRef}
              >
                {filterPanel}
              </FloatingPopover>
            )}

            <div className="library-tab-actions">
              {activeTab === "sites" ? (
                <ActionButton onClick={(event) => openNewSite(event.currentTarget)} type="button">New Site</ActionButton>
              ) : (
                <>
                  <ActionButton onClick={(event) => openNewSimulation(event.currentTarget)} type="button">
                    New Simulation
                  </ActionButton>
                  <ActionButton onClick={(event) => openSimulationCopy(event.currentTarget)} type="button">
                    Save a copy
                  </ActionButton>
                </>
              )}
            </div>

            {!isOnline ? <p className="field-help library-status">Offline: showing cached Library items.</p> : null}
            {syncErrorMessage ? <p className="field-help warning-text library-status">{syncErrorMessage}</p> : null}

            {activeTab === "sites" && !isMobile && selectedSiteIds.size > 0 ? (
              <div className="library-bulk-toolbar">
                <ActionButton
                  onClick={() => setSelectedSiteIds(new Set(filteredSites.map((entry) => entry.id)))}
                  type="button"
                >
                  Select filtered ({filteredSites.length})
                </ActionButton>
                <ActionButton onClick={() => setSelectedSiteIds(new Set())} type="button">Clear selection</ActionButton>
                <ActionButton
                  disabled={!canAddToActiveSimulation}
                  onClick={() => {
                    insertSitesFromLibrary(Array.from(selectedSiteIds));
                    setSelectedSiteIds(new Set());
                    onClose();
                  }}
                  type="button"
                >
                  Add selected ({selectedSiteIds.size})
                </ActionButton>
                <ActionButton
                  disabled={Array.from(selectedSiteIds).some((id) => {
                    const entry = siteLibrary.find((candidate) => candidate.id === id);
                    return !entry || !canEditResource(entry, currentUserId);
                  })}
                  onClick={() => setDeleteSelection(Array.from(selectedSiteIds))}
                  type="button"
                  variant="danger"
                >
                  Delete selected ({selectedSiteIds.size})
                </ActionButton>
              </div>
            ) : null}

            <div className="library-unified-list" ref={listRef}>
        {isInitializing && !(activeTab === "sites" ? siteLibrary.length : simulationPresets.length) ? (
          <p className="field-help">Loading Library…</p>
        ) : null}
        {activeTab === "sites"
          ? filteredSites.map((entry) => {
              const owner = ownerDisplay(entry);
              const visibility = toAccessVisibility(entry.visibility);
              return (
                <article className="library-unified-item" key={entry.id}>
                  {!isMobile ? (
                    <input
                      aria-label={`Select ${entry.name}`}
                      checked={selectedSiteIds.has(entry.id)}
                      className="library-site-select"
                      onChange={() =>
                        setSelectedSiteIds((current) => {
                          const next = new Set(current);
                          if (next.has(entry.id)) next.delete(entry.id);
                          else next.add(entry.id);
                          return next;
                        })
                      }
                      type="checkbox"
                    />
                  ) : null}
                  <div
                    className="library-item-copy"
                  >
                    <strong>{entry.name}</strong>
                    <span>{entry.position.lat.toFixed(5)}, {entry.position.lon.toFixed(5)}</span>
                  </div>
                  <div className="library-item-meta">
                    <Badge variant={visibility as "private" | "public" | "shared"}>{visibility}</Badge>
                    {entry.sourceMeta?.sourceType === "mqtt-feed" ? <Badge variant="mqtt">MQTT</Badge> : null}
                    {entry.ownerUserId && onOpenUserProfile ? (
                      <button
                        aria-label={`Open owner profile: ${owner.name}`}
                        className="row-avatar owner-avatar"
                        onClick={(event) => onOpenUserProfile(entry.ownerUserId as string, event.currentTarget)}
                        title={`Owner: ${owner.name}`}
                        type="button"
                      >
                        <AvatarBadge avatarUrl={owner.avatarUrl} fallbackRawText imageClassName="row-avatar-image" name={owner.name} />
                      </button>
                    ) : (
                      <span className="row-avatar owner-avatar" title={`Owner: ${owner.name}`}>
                        <AvatarBadge avatarUrl={owner.avatarUrl} fallbackRawText imageClassName="row-avatar-image" name={owner.name} />
                      </span>
                    )}
                    {(entry.sharedWith ?? []).map((grant) =>
                      onOpenUserProfile ? (
                        <button
                          aria-label={`Open collaborator profile: ${grant.userId}`}
                          className="row-avatar owner-avatar"
                          key={grant.userId}
                          onClick={(event) => onOpenUserProfile(grant.userId, event.currentTarget)}
                          title={`Collaborator: ${grant.userId} (${grant.role})`}
                          type="button"
                        >
                          <AvatarBadge avatarUrl="" fallbackRawText imageClassName="row-avatar-image" name={grant.userId} />
                        </button>
                      ) : (
                        <span
                          className="row-avatar owner-avatar"
                          key={grant.userId}
                          title={`Collaborator: ${grant.userId} (${grant.role})`}
                        >
                          <AvatarBadge avatarUrl="" fallbackRawText imageClassName="row-avatar-image" name={grant.userId} />
                        </span>
                      ),
                    )}
                  </div>
                  <div className="library-item-actions">
                    <ActionButton
                      aria-label={`Details for ${entry.name}`}
                      onClick={(event) => openSiteDetails(entry, event.currentTarget)}
                      type="button"
                    >
                      Details
                    </ActionButton>
                    <ActionButton
                      aria-label={`Add ${entry.name}`}
                      disabled={!canAddToActiveSimulation}
                      onClick={() => closeAndAddSite(entry.id)}
                      title={canAddToActiveSimulation ? "Add to Simulation" : "Open an editable Simulation to add this Site"}
                      type="button"
                    >
                      Add
                    </ActionButton>
                  </div>
                </article>
              );
            })
          : filteredSimulations.map((preset) => {
              const owner = ownerDisplay(preset);
              const visibility = toAccessVisibility(preset.visibility);
              return (
                <article className="library-unified-item library-simulation-item" key={preset.id}>
                  <div
                    className="library-item-copy"
                  >
                    <strong>{preset.name}</strong>
                    <span>Updated {formatDate(preset.updatedAt)}</span>
                  </div>
                  <div className="library-item-meta">
                    <Badge variant={visibility as "private" | "public" | "shared"}>{visibility}</Badge>
                    {preset.ownerUserId && onOpenUserProfile ? (
                      <button
                        aria-label={`Open owner profile: ${owner.name}`}
                        className="row-avatar owner-avatar"
                        onClick={(event) => onOpenUserProfile(preset.ownerUserId as string, event.currentTarget)}
                        title={`Owner: ${owner.name}`}
                        type="button"
                      >
                        <AvatarBadge avatarUrl={owner.avatarUrl} fallbackRawText imageClassName="row-avatar-image" name={owner.name} />
                      </button>
                    ) : (
                      <span className="row-avatar owner-avatar" title={`Owner: ${owner.name}`}>
                        <AvatarBadge avatarUrl={owner.avatarUrl} fallbackRawText imageClassName="row-avatar-image" name={owner.name} />
                      </span>
                    )}
                  </div>
                  <div className="library-item-actions">
                    <ActionButton
                      aria-label={`Details for ${preset.name}`}
                      onClick={(event) => openSimulationDetails(preset, event.currentTarget)}
                      type="button"
                    >
                      Details
                    </ActionButton>
                    <ActionButton
                      aria-label={`Open ${preset.name}`}
                      onClick={() => closeAndLoadSimulation(preset.id)}
                      type="button"
                    >
                      Open
                    </ActionButton>
                  </div>
                </article>
              );
            })}
        {!isInitializing && activeTab === "sites" && !siteLibrary.length ? (
          <p className="field-help">No Sites have been saved to the Library.</p>
        ) : null}
        {!isInitializing && activeTab === "simulations" && !simulationPresets.length ? (
          <p className="field-help">No Simulations have been saved to the Library.</p>
        ) : null}
        {!isInitializing && activeTab === "sites" && siteLibrary.length > 0 && !filteredSites.length ? (
          <p className="field-help">No Sites match the current search and filters.</p>
        ) : null}
        {!isInitializing && activeTab === "simulations" && simulationPresets.length > 0 && !filteredSimulations.length ? (
          <p className="field-help">No Simulations match the current search and filters.</p>
        ) : null}
            </div>
          </main>
        ) : null}
      </div>

      {deleteSelection ? (
        <ConfirmActionModal
          message={`Delete ${deleteSelection.length} selected Site${deleteSelection.length === 1 ? "" : "s"} from the Library? Referenced Simulation data will be detached but preserved.`}
          onCancel={() => setDeleteSelection(null)}
          onConfirm={() => {
            deleteSiteLibraryEntries(deleteSelection);
            setSelectedSiteIds(new Set());
            setDeleteSelection(null);
          }}
          title="Delete Sites"
        />
      ) : null}
    </div>
  );
}
