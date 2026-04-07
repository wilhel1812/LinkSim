import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CircleX, Funnel } from "lucide-react";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  filterAndSortLibraryItems,
  parsePersistedLibraryFilterState,
  serializeLibraryFilterState,
  type LibraryFilterRole,
  type LibraryFilterState,
  type LibraryFilterVisibility,
} from "../lib/libraryFilters";
import { formatDate } from "../lib/locale";
import { toAccessVisibility, toInitials } from "../lib/uiFormatting";
import { duplicateSimulationNameMessage, hasDuplicateSimulationNameForOwner } from "../lib/simulationNameValidation";
import { useAppStore } from "../store/appStore";

type FilterGroupKey = "role" | "visibility";

const SIMULATION_LIBRARY_FILTERS_KEY = "rmw-simulation-library-filters-v1";

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

const ALL_ROLE_FILTERS = ROLE_FILTER_OPTIONS.map((option) => option.key);
const ALL_VISIBILITY_FILTERS = VISIBILITY_FILTER_OPTIONS.map((option) => option.key);

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

const toggleValue = <T extends string>(values: T[], key: T): T[] =>
  values.includes(key) ? values.filter((value) => value !== key) : [...values, key];

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

type ResourceOpenParams = {
  kind: "site" | "simulation";
  resourceId: string;
  label: string;
  createdByUserId: string | null;
  createdByName: string;
  createdByAvatarUrl: string;
  lastEditedByUserId: string | null;
  lastEditedByName: string;
  lastEditedByAvatarUrl: string;
};

type SimulationLibraryPanelProps = {
  onClose: () => void;
  onLoadSimulation: (presetId: string) => void;
  onOpenDetails?: (params: ResourceOpenParams) => void;
  hideSaveCopy?: boolean;
};

export default function SimulationLibraryPanel({
  onClose,
  onLoadSimulation,
  onOpenDetails,
  hideSaveCopy = false,
}: SimulationLibraryPanelProps) {
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const currentUser = useAppStore((state) => state.currentUser);
  const saveCurrentSimulationPreset = useAppStore((state) => state.saveCurrentSimulationPreset);
  const createBlankSimulationPreset = useAppStore((state) => state.createBlankSimulationPreset);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const [filters, setFilters] = useState<LibraryFilterState>(() =>
    readLibraryFilterState(SIMULATION_LIBRARY_FILTERS_KEY),
  );
  const [openFilterGroup, setOpenFilterGroup] = useState<FilterGroupKey | null>(null);
  const [roleDraft, setRoleDraft] = useState<LibraryFilterRole[] | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<LibraryFilterVisibility[] | null>(null);
  const filterToolbarRef = useRef<HTMLDivElement | null>(null);

  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetNameError, setNewPresetNameError] = useState("");
  const [simulationSaveStatus, setSimulationSaveStatus] = useState("");

  const [showNewSimulationModal, setShowNewSimulationModal] = useState(false);
  const [newSimulationName, setNewSimulationName] = useState("");
  const [newSimulationDescription, setNewSimulationDescription] = useState("");
  const [newSimulationNameError, setNewSimulationNameError] = useState("");
  const [newSimulationVisibility, setNewSimulationVisibility] = useState<"private" | "shared">("private");

  useEffect(() => {
    persistLibraryFilterState(SIMULATION_LIBRARY_FILTERS_KEY, filters);
  }, [filters]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (openFilterGroup && filterToolbarRef.current && !filterToolbarRef.current.contains(target)) {
        closeFilterEditors();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeFilterEditors();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilterGroup]);

  const filteredPresets = useMemo(
    () =>
      filterAndSortLibraryItems(simulationPresets, filters, currentUser?.id ?? null, (preset) =>
        `${preset.name} ${preset.updatedAt}`,
      ),
    [simulationPresets, filters, currentUser?.id],
  );

  const resolveOwnerDisplay = (
    ownerUserId: string | undefined,
    fallbackName: string | undefined,
    fallbackAvatarUrl: string | undefined,
  ): { name: string; avatarUrl: string } => {
    const name =
      (fallbackName && fallbackName.trim() && fallbackName.trim() !== "Unknown" ? fallbackName : "") ||
      ownerUserId ||
      "Unknown";
    const avatarUrl = fallbackAvatarUrl || "";
    return { name, avatarUrl };
  };

  const commitRoleFilters = (roleFilters: LibraryFilterRole[]) => {
    if (!roleFilters.length) return;
    setFilters((state) => ({ ...state, roleFilters }));
    setOpenFilterGroup(null);
  };

  const commitVisibilityFilters = (visibilityFilters: LibraryFilterVisibility[]) => {
    if (!visibilityFilters.length) return;
    setFilters((state) => ({ ...state, visibilityFilters }));
    setOpenFilterGroup(null);
  };

  const openRoleEditor = () => {
    setRoleDraft(effectiveSelection(filters.roleFilters, ALL_ROLE_FILTERS));
    setOpenFilterGroup((current) => (current === "role" ? null : "role"));
  };

  const openVisibilityEditor = () => {
    setVisibilityDraft(effectiveSelection(filters.visibilityFilters, ALL_VISIBILITY_FILTERS));
    setOpenFilterGroup((current) => (current === "visibility" ? null : "visibility"));
  };

  const closeFilterEditors = () => {
    setOpenFilterGroup(null);
    setRoleDraft(null);
    setVisibilityDraft(null);
  };

  const saveSimulationAsNew = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      setNewPresetNameError("A name is required.");
      setSimulationSaveStatus("");
      return;
    }
    setNewPresetNameError("");
    const savedId = saveCurrentSimulationPreset(trimmed);
    if (savedId) {
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
    if (hasDuplicateSimulationNameForOwner(simulationPresets, trimmed, currentUser.id)) {
      const duplicateMessage = duplicateSimulationNameMessage(trimmed);
      setNewSimulationNameError(duplicateMessage);
      setSimulationSaveStatus(duplicateMessage);
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
      setSimulationSaveStatus(duplicateSimulationNameMessage(trimmed));
      return;
    }
    loadSimulationPreset(createdId);
    setSimulationSaveStatus(`Created simulation: ${trimmed}`);
    setNewSimulationName("");
    setNewSimulationDescription("");
    setShowNewSimulationModal(false);
    onClose();
  };

  const openResourceDetails = (preset: {
    id: string;
    name: string;
    createdByUserId?: string;
    createdByName?: string;
    createdByAvatarUrl?: string;
    lastEditedByUserId?: string;
    lastEditedByName?: string;
    lastEditedByAvatarUrl?: string;
  }) => {
    if (!onOpenDetails) return;
    onOpenDetails({
      kind: "simulation",
      resourceId: preset.id,
      label: preset.name,
      createdByUserId: (preset as Record<string, unknown>).createdByUserId as string | null ?? null,
      createdByName: (preset as Record<string, unknown>).createdByName as string ?? "Unknown",
      createdByAvatarUrl: (preset as Record<string, unknown>).createdByAvatarUrl as string ?? "",
      lastEditedByUserId: (preset as Record<string, unknown>).lastEditedByUserId as string | null ?? null,
      lastEditedByName: (preset as Record<string, unknown>).lastEditedByName as string ?? "Unknown",
      lastEditedByAvatarUrl: (preset as Record<string, unknown>).lastEditedByAvatarUrl as string ?? "",
    });
  };

  return (
    <div className="library-manager-card">
      <div className="library-manager-header">
        <h2>Simulation Library</h2>
        <button aria-label="Close" className="inline-action inline-action-icon" onClick={onClose} title="Close" type="button">
          <CircleX aria-hidden="true" strokeWidth={1.8} />
        </button>
      </div>
      <p className="field-help">
        Manage saved simulations here. Site/node editing still happens in the main workspace.
      </p>
      <label className="field-grid">
        <span>Search</span>
        <input
          onChange={(event) => setFilters((state) => ({ ...state, searchQuery: event.target.value }))}
          placeholder="Filter saved simulations"
          type="text"
          value={filters.searchQuery}
        />
      </label>
      <div className="library-filter-toolbar" ref={filterToolbarRef}>
        <span className="library-filter-row-label">Filters:</span>
        <div className="library-filter-menu">
          <button
            className={clsx("inline-action", "library-filter-trigger", {
              "library-filter-trigger-active": selectionIsFiltered(filters.roleFilters, ALL_ROLE_FILTERS),
            })}
            onClick={openRoleEditor}
            type="button"
          >
            Ownership {selectionLabel(filters.roleFilters, ALL_ROLE_FILTERS)}
            <span className="library-filter-trigger-chevron" aria-hidden="true">
              <Funnel aria-hidden="true" strokeWidth={1.8} />
            </span>
          </button>
          {openFilterGroup === "role" ? (
            <div className="library-filter-popover">
              <div className="library-filter-popover-actions">
                <button className="inline-action" onClick={() => commitRoleFilters(ALL_ROLE_FILTERS)} type="button">
                  All
                </button>
                <button className="inline-action" onClick={() => setRoleDraft([])} type="button">
                  None
                </button>
              </div>
              <div className="library-filter-popover-options">
                {ROLE_FILTER_OPTIONS.map((option) => {
                  const draft = roleDraft ?? effectiveSelection(filters.roleFilters, ALL_ROLE_FILTERS);
                  const checked = draft.includes(option.key);
                  return (
                    <label className="checkbox-field library-filter-option" key={`sim-role-${option.key}`}>
                      <input
                        checked={checked}
                        onChange={() => {
                          const next = toggleValue(draft, option.key);
                          setRoleDraft(next);
                          if (next.length) commitRoleFilters(next);
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
              "library-filter-trigger-active": selectionIsFiltered(filters.visibilityFilters, ALL_VISIBILITY_FILTERS),
            })}
            onClick={openVisibilityEditor}
            type="button"
          >
            Access level {selectionLabel(filters.visibilityFilters, ALL_VISIBILITY_FILTERS)}
            <span className="library-filter-trigger-chevron" aria-hidden="true">
              <Funnel aria-hidden="true" strokeWidth={1.8} />
            </span>
          </button>
          {openFilterGroup === "visibility" ? (
            <div className="library-filter-popover">
              <div className="library-filter-popover-actions">
                <button className="inline-action" onClick={() => commitVisibilityFilters(ALL_VISIBILITY_FILTERS)} type="button">
                  All
                </button>
                <button className="inline-action" onClick={() => setVisibilityDraft([])} type="button">
                  None
                </button>
              </div>
              <div className="library-filter-popover-options">
                {VISIBILITY_FILTER_OPTIONS.map((option) => {
                  const draft =
                    visibilityDraft ?? effectiveSelection(filters.visibilityFilters, ALL_VISIBILITY_FILTERS);
                  const checked = draft.includes(option.key);
                  return (
                    <label className="checkbox-field library-filter-option" key={`sim-vis-${option.key}`}>
                      <input
                        checked={checked}
                        onChange={() => {
                          const next = toggleValue(draft, option.key);
                          setVisibilityDraft(next);
                          if (next.length) commitVisibilityFilters(next);
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
            setFilters(DEFAULT_LIBRARY_FILTER_STATE);
            closeFilterEditors();
          }}
          type="button"
        >
          Clear Filters
        </button>
      </div>
      {!hideSaveCopy ? (
        <>
          <label className="field-grid">
            <span>Save a copy</span>
            <input
              className={newPresetNameError ? "input-error" : ""}
              onChange={(event) => {
                setNewPresetName(event.target.value);
                if (newPresetNameError) setNewPresetNameError("");
              }}
              placeholder="My simulation"
              type="text"
              value={newPresetName}
            />
          </label>
          {newPresetNameError ? <p className="field-help field-help-error">{newPresetNameError}</p> : null}
          <div className="chip-group">
            <button className="inline-action" onClick={saveSimulationAsNew} type="button">
              Save Copy
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
              New Simulation
            </button>
          </div>
        </>
      ) : (
        <div className="chip-group">
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
            New Simulation
          </button>
        </div>
      )}
      {simulationSaveStatus ? <p className="field-help">{simulationSaveStatus}</p> : null}
      <div className="library-editor">
        <h3>Saved simulations</h3>
        <div className="library-manager-list">
          {filteredPresets.map((preset) => {
            const owner = resolveOwnerDisplay(
              (preset as { ownerUserId?: string }).ownerUserId,
              (preset as { createdByName?: string }).createdByName,
              (preset as { createdByAvatarUrl?: string }).createdByAvatarUrl,
            );
            return (
              <div className="library-manager-row simulation-manager-row" key={preset.id}>
                <span className="library-row-label">
                  <strong>{preset.name}</strong>
                  {" · "}
                  Updated {formatDate(preset.updatedAt)}
                </span>
                <span className="library-row-meta">
                  <span className="access-badge">
                    {toAccessVisibility((preset as { visibility?: unknown }).visibility)}
                  </span>
                  <span className="row-avatar owner-avatar" title={`Owner: ${owner.name}`}>
                    {owner.avatarUrl ? (
                      <img alt={owner.name} className="row-avatar-image" src={owner.avatarUrl} />
                    ) : (
                      toInitials(owner.name)
                    )}
                  </span>
                </span>
                <div className="library-row-actions">
                  <button
                    className="inline-action"
                    onClick={() => onLoadSimulation(preset.id)}
                    type="button"
                  >
                    Load
                  </button>
                  {onOpenDetails ? (
                    <button
                      className="inline-action"
                      onClick={() => openResourceDetails(preset)}
                      type="button"
                    >
                      Details
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!filteredPresets.length ? <p className="field-help">No matching saved simulations.</p> : null}
        </div>
      </div>

      {showNewSimulationModal ? (
        <div className="welcome-modal-new-simulation-backdrop">
          <div className="library-manager-card user-profile-popup welcome-modal-new-simulation">
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
              <span>Access level</span>
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
        </div>
      ) : null}
    </div>
  );
}
