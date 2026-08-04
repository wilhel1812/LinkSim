import { useEffect, useMemo, useRef, useState } from "react";
import { Filter } from "lucide-react";
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
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(new Set());
  const [deleteSelection, setDeleteSelection] = useState<string[] | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setActiveTab(initialTab), [initialTab]);
  useEffect(() => persistLibraryFilterState(SITE_LIBRARY_FILTERS_KEY, siteFilters), [siteFilters]);
  useEffect(
    () => persistLibraryFilterState(SIMULATION_LIBRARY_FILTERS_KEY, simulationFilters),
    [simulationFilters],
  );

  const currentUserId = currentUser?.id ?? null;
  const activeFilters = activeTab === "sites" ? siteFilters : simulationFilters;
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

  return (
    <Surface className="library-unified-card" variant="card">
      <div className="library-manager-header library-unified-header">
        <h2>Library</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>
      <div aria-label="Library sections" className="library-tabs" role="tablist">
        <button
          aria-selected={activeTab === "sites"}
          className={activeTab === "sites" ? "is-active" : ""}
          onClick={() => {
            setActiveTab("sites");
            closeFilters();
          }}
          role="tab"
          type="button"
        >
          Sites
        </button>
        <button
          aria-selected={activeTab === "simulations"}
          className={activeTab === "simulations" ? "is-active" : ""}
          onClick={() => {
            setActiveTab("simulations");
            closeFilters();
          }}
          role="tab"
          type="button"
        >
          Simulations
        </button>
      </div>
      <div className="library-search-row">
        <input
          aria-label={`Search ${activeTab === "sites" ? "Sites" : "Simulations"}`}
          onChange={(event) => setActiveFilters({ ...activeFilters, searchQuery: event.target.value })}
          placeholder={activeTab === "sites" ? "Search by name or coordinates" : "Search Simulations"}
          role="searchbox"
          type="search"
          value={activeFilters.searchQuery}
        />
        <ActionButton
          aria-expanded={filtersOpen}
          aria-label={`Filter and sort ${activeTab === "sites" ? "Sites" : "Simulations"}${filterCount ? `, active` : ""}`}
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
            aria-label={`Filter and sort ${activeTab === "sites" ? "Sites" : "Simulations"}`}
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

      {activeTab === "sites" && !isMobile ? (
        <div className="library-bulk-toolbar">
          <ActionButton
            onClick={() => setSelectedSiteIds(new Set(filteredSites.map((entry) => entry.id)))}
            type="button"
          >
            Select filtered ({filteredSites.length})
          </ActionButton>
          <ActionButton onClick={() => setSelectedSiteIds(new Set())} type="button">Clear selection</ActionButton>
          <ActionButton
            disabled={!selectedSiteIds.size || !canAddToActiveSimulation}
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
            disabled={
              !selectedSiteIds.size ||
              Array.from(selectedSiteIds).some((id) => {
                const entry = siteLibrary.find((candidate) => candidate.id === id);
                return !entry || !canEditResource(entry, currentUserId);
              })
            }
            onClick={() => setDeleteSelection(Array.from(selectedSiteIds))}
            type="button"
            variant="danger"
          >
            Delete selected ({selectedSiteIds.size})
          </ActionButton>
        </div>
      ) : null}

      <div className="library-unified-list">
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
                  <button
                    aria-label={`Open Site details: ${entry.name}`}
                    className="library-item-details"
                    onClick={(event) => openSiteDetails(entry, event.currentTarget)}
                    type="button"
                  >
                    <strong>{entry.name}</strong>
                    <span>{entry.position.lat.toFixed(5)}, {entry.position.lon.toFixed(5)}</span>
                  </button>
                  <div className="library-item-meta">
                    <Badge variant={visibility as "private" | "public" | "shared"}>{visibility}</Badge>
                    {entry.sourceMeta?.sourceType === "mqtt-feed" ? (
                      <Badge variant="mqtt">MQTT</Badge>
                    ) : (
                      <span className="library-source-label">Manual</span>
                    )}
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
                  <ActionButton
                    disabled={!canAddToActiveSimulation}
                    onClick={() => closeAndAddSite(entry.id)}
                    title={canAddToActiveSimulation ? "Add to Simulation" : "Open an editable Simulation to add this Site"}
                    type="button"
                  >
                    Add
                  </ActionButton>
                </article>
              );
            })
          : filteredSimulations.map((preset) => {
              const owner = ownerDisplay(preset);
              const visibility = toAccessVisibility(preset.visibility);
              return (
                <article className="library-unified-item library-simulation-item" key={preset.id}>
                  <button
                    aria-label={`Open Simulation details: ${preset.name}`}
                    className="library-item-details"
                    onClick={(event) => openSimulationDetails(preset, event.currentTarget)}
                    type="button"
                  >
                    <strong>{preset.name}</strong>
                    <span>Updated {formatDate(preset.updatedAt)}</span>
                  </button>
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
                  <ActionButton onClick={() => closeAndLoadSimulation(preset.id)} type="button">Load</ActionButton>
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
    </Surface>
  );
}
