import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { FREQUENCY_PRESETS, frequencyPresetGroups } from "../../lib/frequencyPlans";
import {
  fetchResourceChanges,
  fetchUserById,
  revertResourceChangeCopy,
  type CloudUser,
  type ResourceChange,
} from "../../lib/cloudUser";
import { formatDate } from "../../lib/locale";
import { getUiErrorMessage } from "../../lib/uiError";
import { useAppStore } from "../../store/appStore";
import { useMapEditorFormState } from "./useMapEditorFormState";
import { AccessSettingsEditor } from "../AccessSettingsEditor";
import { ActionButton } from "../ActionButton";
import { Surface } from "../ui/Surface";
import { InlineCloseIconButton } from "../InlineCloseIconButton";
import { SiteBeamVisualizer } from "../SiteBeamVisualizer";
import { AvatarBadge } from "../AvatarBadge";
import { ModalOverlay } from "../ModalOverlay";

// ─── Positioning ─────────────────────────────────────────────────────────────

type AnchorRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

function computePosition(
  anchorRect: AnchorRect,
  panelWidth: number,
  panelHeight: number,
): { left: number; top: number } {
  const MARGIN = 16;
  const GAP = 8;

  // Prefer opening to the right of the trigger button
  let left = anchorRect.right + GAP;
  if (left + panelWidth > window.innerWidth - MARGIN) {
    // Overflow right → try left of trigger
    left = anchorRect.left - panelWidth - GAP;
  }
  // Clamp to viewport
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - panelWidth - MARGIN));

  // Align top to trigger top, shift up if it would overflow the bottom
  let top = anchorRect.top;
  if (top + panelHeight > window.innerHeight - MARGIN) {
    top = window.innerHeight - panelHeight - MARGIN;
  }
  top = Math.max(MARGIN, top);

  return { left, top };
}

const UserBadge = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
  <span className="user-list-row">
    <AvatarBadge avatarUrl={avatarUrl} imageClassName="profile-avatar" name={name} />
    <span>{name}</span>
  </span>
);

const formatChangeSummary = (action: string, note: string | null): string => {
  if (note && note.trim()) return note;
  if (action === "created") return "Created record.";
  if (action === "updated") return "Updated record.";
  return "Change recorded.";
};

const formatChangeDetailValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "-";
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
  return !new Set([
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
  ]).has(normalized);
};

// ─── Site Editor Card ────────────────────────────────────────────────────────

function SiteEditorCard({
  isNew,
  form,
  onClose,
  onOpenChangeLog,
  onOpenUserProfile,
}: {
  isNew: boolean;
  form: ReturnType<typeof useMapEditorFormState>;
  onClose: () => void;
  onOpenChangeLog: (kind: "site", resourceId: string, label: string) => void;
  onOpenUserProfile: (userId: string) => void;
}) {
  const mapEditor = useAppStore((state) => state.mapEditor);

  return (
    <>
      <div className="library-manager-header">
        <h2>{isNew ? "New Site" : `Edit · ${mapEditor?.label ?? "Site"}`}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      {!form.canWrite && !isNew && (
        <p className="field-help warning-text">Read-only: you can view this site but cannot edit it.</p>
      )}

      {!isNew && form.siteMetadata ? (
        <div className="site-editor-meta-row">
          <button
            className="site-editor-meta-chip"
            onClick={() => onOpenUserProfile(form.siteMetadata?.owner.id ?? "")}
            type="button"
          >
            <span className="site-editor-meta-label">Owner</span>
            <UserBadge avatarUrl={form.siteMetadata.owner.avatarUrl} name={form.siteMetadata.owner.name} />
          </button>
          <button
            className="site-editor-meta-chip"
            onClick={() => onOpenUserProfile(form.siteMetadata?.lastEditedBy.id ?? "")}
            type="button"
          >
            <span className="site-editor-meta-label">Last edited</span>
            <UserBadge
              avatarUrl={form.siteMetadata.lastEditedBy.avatarUrl}
              name={form.siteMetadata.lastEditedBy.name}
            />
          </button>
          <ActionButton
            onClick={() =>
              form.siteMetadata
                ? onOpenChangeLog("site", form.siteMetadata.resourceId, form.siteMetadata.label)
                : undefined
            }
            type="button"
          >
            Change log
          </ActionButton>
        </div>
      ) : null}

      <fieldset className="resource-edit-fieldset" disabled={!form.canWrite && !isNew}>
        <label className="field-grid">
          <span>Name</span>
          <input
            onChange={(e) => form.setNameDraft(e.target.value)}
            placeholder="My site"
            type="text"
            value={form.nameDraft}
          />
        </label>

        <label className="field-grid">
          <span>Description</span>
          <textarea
            onChange={(e) => form.setDescriptionDraft(e.target.value)}
            placeholder="Optional site notes (equipment, placement, access notes)"
            rows={3}
            value={form.descriptionDraft}
          />
        </label>

        <AccessSettingsEditor
          collaborators={form.collaborators}
          directory={form.collaboratorDirectory}
          directoryBusy={form.collaboratorDirectoryBusy}
          directoryStatus={form.collaboratorDirectoryStatus}
          disabled={!form.currentUser?.id}
          canRemoveCollaborators={form.currentUserIsOwner}
          onAddCollaborator={form.addCollaborator}
          onOpenUserProfile={onOpenUserProfile}
          onRemoveCollaborator={form.removeCollaborator}
          onRoleChange={form.setCollaboratorRole}
          onVisibilityChange={form.setAccessVisibility}
          ownerUserId={form.ownerUserId}
          visibility={form.accessVisibility}
        />

        <label className="field-grid">
          <span>Latitude</span>
          <input
            onChange={(e) => form.setLatDraft(e.target.value)}
            step="0.000001"
            type="number"
            value={form.latDraft}
          />
        </label>

        <label className="field-grid">
          <span>Longitude</span>
          <input
            onChange={(e) => form.setLonDraft(e.target.value)}
            step="0.000001"
            type="number"
            value={form.lonDraft}
          />
        </label>

        <label className="field-grid">
          <span>Map search</span>
          <div className="field-inline">
            <input
              onChange={(e) => form.setSiteSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void form.runSiteSearch();
                }
              }}
              placeholder="Place, address, or coordinates"
              type="text"
              value={form.siteSearchQuery}
            />
            <ActionButton
              className="field-inline-btn"
              disabled={form.siteSearchBusy}
              onClick={() => void form.runSiteSearch()}
              type="button"
            >
              {form.siteSearchBusy ? "Searching..." : "Search"}
            </ActionButton>
          </div>
        </label>
        {form.siteSearchStatus ? <p className="field-help">{form.siteSearchStatus}</p> : null}
        {form.siteSearchResults.length ? (
          <div className="site-quick-list">
            {form.siteSearchResults.map((result) => (
              <ActionButton
                disabled={form.siteSearchPickBusyId !== null}
                key={result.id}
                onClick={() => void form.selectSiteSearchResult(result)}
                type="button"
              >
                {form.siteSearchPickBusyId === result.id ? "Loading..." : `Use: ${result.label}`}
              </ActionButton>
            ))}
          </div>
        ) : null}

        <label className="field-grid">
          <span>Ground elev (m)</span>
          <div className="field-inline">
            <input
              onChange={(e) => form.setGroundDraft(e.target.value)}
              type="number"
              value={form.groundDraft}
            />
            <ActionButton
              className="field-inline-btn"
              disabled={form.isEditorTerrainFetching}
              onClick={() => {
                const elevation = form.fetchGroundElevation();
                if (elevation === null) {
                  form.setStatus(
                    "No loaded terrain value at these coordinates. Fetch terrain data for this area first.",
                  );
                  return;
                }
                form.setGroundDraft(elevation);
              }}
              type="button"
            >
              {form.isEditorTerrainFetching ? "Loading…" : "Fetch"}
            </ActionButton>
          </div>
        </label>

        <div className="beam-visualizer-field-group">
          <label className="field-grid">
            <span>Antenna (m)</span>
            <input
              onChange={(e) => form.setAntennaDraft(e.target.value)}
              type="number"
              value={form.antennaDraft}
            />
          </label>

          <label className="field-grid">
            <span>Tx power (dBm)</span>
            <input
              onChange={(e) => form.setTxPowerDraft(e.target.value)}
              type="number"
              value={form.txPowerDraft}
            />
          </label>

          {form.separateGain ? (
            <>
              <label className="field-grid">
                <span>Tx gain (dBi)</span>
                <input
                  onChange={(e) => form.setTxGainDraft(e.target.value)}
                  type="number"
                  value={form.txGainDraft}
                />
              </label>
              <label className="field-grid">
                <span>Rx gain (dBi)</span>
                <input
                  onChange={(e) => form.setRxGainDraft(e.target.value)}
                  type="number"
                  value={form.rxGainDraft}
                />
              </label>
            </>
          ) : (
            <label className="field-grid">
              <span>Gain (dBi)</span>
              <input
                onChange={(e) => form.handleGainChange(Number(e.target.value))}
                type="number"
                value={form.txGainDraft}
              />
            </label>
          )}

          <div className="field-grid gain-mode-toggle">
            <span>Separate RX/TX gain</span>
            <input
              aria-label="Separate RX/TX gain"
              checked={form.separateGain}
              onChange={(e) => form.handleSeparateGainToggle(e.target.checked)}
              type="checkbox"
            />
          </div>

          <label className="field-grid">
            <span>Cable loss (dB)</span>
            <input
              onChange={(e) => form.setCableLossDraft(e.target.value)}
              type="number"
              value={form.cableLossDraft}
            />
          </label>
        </div>

        <SiteBeamVisualizer
          values={{
            antennaHeightM: form.antennaDraft,
            txPowerDbm: form.txPowerDraft,
            txGainDbi: form.txGainDraft,
            rxGainDbi: form.rxGainDraft,
            cableLossDb: form.cableLossDraft,
          }}
        />
      </fieldset>

      {form.status ? <p className="field-help">{form.status}</p> : null}

      <div className="chip-group">
        <ActionButton
          disabled={!form.canWrite && !isNew}
          onClick={form.handleSaveSite}
          type="button"
        >
          {isNew ? "Create Site" : "Save Site"}
        </ActionButton>
        <ActionButton onClick={onClose} type="button">
          Cancel
        </ActionButton>
      </div>
    </>
  );
}

// ─── Link Editor Card ────────────────────────────────────────────────────────

function LinkEditorCard({
  isNew,
  form,
  onClose,
}: {
  isNew: boolean;
  form: ReturnType<typeof useMapEditorFormState>;
  onClose: () => void;
}) {
  const mapEditor = useAppStore((state) => state.mapEditor);

  return (
    <>
      <div className="library-manager-header">
        <h2>{isNew ? "New Link" : `Edit · ${mapEditor?.label ?? "Link"}`}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      <label className="field-grid">
        <span>Link name</span>
        <input
          onChange={(e) => form.setLinkNameDraft(e.target.value)}
          type="text"
          value={form.linkNameDraft}
        />
      </label>

      <label className="field-grid endpoint-field">
        <span>From site</span>
        <select
          className="locale-select"
          onChange={(e) => {
            const nextFrom = e.target.value;
            form.setLinkFromSiteId(nextFrom);
            if (form.linkToSiteId === nextFrom) {
              const fallback = form.sites.find((s) => s.id !== nextFrom)?.id ?? "";
              form.setLinkToSiteId(fallback);
            }
          }}
          value={form.linkFromSiteId}
        >
          {form.sites.map((site) => (
            <option key={`from-${site.id}`} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field-grid endpoint-field">
        <span>To site</span>
        <select
          className="locale-select"
          onChange={(e) => form.setLinkToSiteId(e.target.value)}
          value={form.linkToSiteId}
        >
          {form.sites
            .filter((s) => s.id !== form.linkFromSiteId)
            .map((site) => (
              <option key={`to-${site.id}`} value={site.id}>
                {site.name}
              </option>
            ))}
        </select>
      </label>

        <label className="field-grid">
          <span>Override site radio settings</span>
          <input
            aria-label="Override site radio settings"
            checked={form.overrideRadio}
            onChange={(e) => form.setOverrideRadio(e.target.checked)}
            type="checkbox"
          />
        </label>
        {!form.overrideRadio ? (
          <p className="field-help">This link uses the selected From/To site radio settings.</p>
        ) : null}
        {form.overrideRadio ? (
          <>
            <label className="field-grid">
              <span>Tx power (dBm)</span>
              <input
                onChange={(e) => form.setLinkTxPower(e.target.value)}
                type="number"
                value={form.linkTxPower}
              />
            </label>
            <label className="field-grid">
              <span>Tx gain (dBi)</span>
              <input
                onChange={(e) => form.setLinkTxGain(e.target.value)}
                type="number"
                value={form.linkTxGain}
              />
            </label>
            <label className="field-grid">
              <span>Rx gain (dBi)</span>
              <input
                onChange={(e) => form.setLinkRxGain(e.target.value)}
                type="number"
                value={form.linkRxGain}
              />
            </label>
            <label className="field-grid">
              <span>Cable loss (dB)</span>
              <input
                onChange={(e) => form.setLinkCableLoss(e.target.value)}
                type="number"
                value={form.linkCableLoss}
              />
            </label>
          </>
        ) : null}

      {form.status ? <p className="field-help">{form.status}</p> : null}

      <div className="chip-group">
        <ActionButton onClick={form.handleSaveLink} type="button">
          {isNew ? "Create Link" : "Save Link"}
        </ActionButton>
        <ActionButton onClick={onClose} type="button">
          Cancel
        </ActionButton>
      </div>
    </>
  );
}

// ─── Simulation Editor Card ──────────────────────────────────────────────────

function SimulationEditorCard({
  isNew,
  form,
  onClose,
}: {
  isNew: boolean;
  form: ReturnType<typeof useMapEditorFormState>;
  onClose: () => void;
}) {
  const mapEditor = useAppStore((state) => state.mapEditor);

  return (
    <>
      <div className="library-manager-header">
        <h2>{isNew ? "New Simulation" : `Edit · ${mapEditor?.label ?? "Simulation"}`}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      {!form.canWrite && !isNew && (
        <p className="field-help warning-text">Read-only: you can view this simulation but cannot edit it.</p>
      )}

      <fieldset className="resource-edit-fieldset" disabled={!form.canWrite && !isNew}>
        <label className="field-grid">
          <span>Name</span>
          <input
            onChange={(e) => form.setNameDraft(e.target.value)}
            type="text"
            value={form.nameDraft}
          />
        </label>

        <label className="field-grid">
          <span>Description</span>
          <textarea
            onChange={(e) => form.setDescriptionDraft(e.target.value)}
            placeholder="Optional simulation notes"
            rows={3}
            value={form.descriptionDraft}
          />
        </label>

        <AccessSettingsEditor
          collaborators={form.collaborators}
          directory={form.collaboratorDirectory}
          directoryBusy={form.collaboratorDirectoryBusy}
          directoryStatus={form.collaboratorDirectoryStatus}
          disabled={!form.currentUser?.id}
          onAddCollaborator={form.addCollaborator}
          onRemoveCollaborator={form.removeCollaborator}
          onRoleChange={form.setCollaboratorRole}
          onVisibilityChange={form.setAccessVisibility}
          ownerUserId={form.ownerUserId}
          visibility={form.accessVisibility}
        />
        {isNew ? (
          <>
            <label className="field-grid">
              <span>Frequency Plan</span>
              <select
                className="locale-select"
                onChange={(e) => form.setSimulationFrequencyPresetId(e.target.value)}
                value={form.simulationFrequencyPresetId}
              >
                {frequencyPresetGroups(FREQUENCY_PRESETS).map((groupEntry) => (
                  <optgroup key={groupEntry.group} label={groupEntry.group}>
                    {groupEntry.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field-grid">
              <span>Auto environment defaults</span>
              <select
                className="locale-select"
                onChange={(e) => form.setSimulationAutoPropagationEnvironment(e.target.value === "auto")}
                value={form.simulationAutoPropagationEnvironment ? "auto" : "manual"}
              >
                <option value="auto">Auto (recommended)</option>
                <option value="manual">Manual override</option>
              </select>
            </label>
          </>
        ) : null}
      </fieldset>

      {/* Pending visibility confirmation prompt */}
      {form.pendingVisibilityConfirm ? (
        <div className="field-help warning-text">
          <p>
            This simulation references {form.pendingVisibilityConfirm.referencedPrivateSiteIds.length} private site(s).
            Making this simulation shared will also make those sites shared. Continue?
          </p>
          <div className="chip-group">
            <ActionButton onClick={form.applyPendingVisibilityChange} type="button">
              Make Shared
            </ActionButton>
            <ActionButton onClick={() => form.setPendingVisibilityConfirm(null)} type="button">
              Cancel
            </ActionButton>
          </div>
        </div>
      ) : null}

      {form.status ? <p className="field-help">{form.status}</p> : null}

      {!form.pendingVisibilityConfirm ? (
        <div className="chip-group">
          <ActionButton disabled={!form.canWrite} onClick={form.handleSaveSimulation} type="button">
            {isNew ? "Create Simulation" : "Save"}
          </ActionButton>
          <ActionButton onClick={onClose} type="button">
            Cancel
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}

// ─── MapEditorPanel ──────────────────────────────────────────────────────────

type MapEditorPanelProps = {
  isMobile: boolean;
};

export function MapEditorPanel({ isMobile }: MapEditorPanelProps) {
  const mapEditor = useAppStore((state) => state.mapEditor);
  const closeMapEditor = useAppStore((state) => state.closeMapEditor);
  const form = useMapEditorFormState();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [profilePopupUser, setProfilePopupUser] = useState<CloudUser | null>(null);
  const [profilePopupBusy, setProfilePopupBusy] = useState(false);
  const [profilePopupStatus, setProfilePopupStatus] = useState("");
  const [changeLogPopup, setChangeLogPopup] = useState<{
    kind: "site";
    resourceId: string;
    label: string;
    changes: ResourceChange[];
    busy: boolean;
    status: string;
  } | null>(null);

  const openUserProfilePopup = async (userId: string) => {
    if (!userId) return;
    setProfilePopupBusy(true);
    setProfilePopupStatus("");
    try {
      const user = await fetchUserById(userId);
      setProfilePopupUser(user);
    } catch (error) {
      setProfilePopupStatus(`Failed loading user: ${getUiErrorMessage(error)}`);
    } finally {
      setProfilePopupBusy(false);
    }
  };

  const openChangeLogPopup = async (kind: "site", resourceId: string, label: string) => {
    setChangeLogPopup({ kind, resourceId, label, changes: [], busy: true, status: "" });
    try {
      const changes = await fetchResourceChanges(kind, resourceId);
      setChangeLogPopup({ kind, resourceId, label, changes, busy: false, status: "" });
    } catch (error) {
      setChangeLogPopup({
        kind,
        resourceId,
        label,
        changes: [],
        busy: false,
        status: `Failed loading changes: ${getUiErrorMessage(error)}`,
      });
    }
  };

  const revertChangeAsCopy = async (kind: "site", resourceId: string, changeId: number) => {
    try {
      await revertResourceChangeCopy(kind, resourceId, changeId);
      const refreshed = await fetchResourceChanges(kind, resourceId);
      setChangeLogPopup((current) => (current ? { ...current, changes: refreshed, status: "Reverted as copy." } : current));
    } catch (error) {
      setChangeLogPopup((current) =>
        current ? { ...current, status: `Revert failed: ${getUiErrorMessage(error)}` } : current,
      );
    }
  };
  const closeUserProfilePopup = () => {
    setProfilePopupUser(null);
    setProfilePopupBusy(false);
    setProfilePopupStatus("");
  };

  // Compute position on open and on resize
  useEffect(() => {
    if (!mapEditor || isMobile) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const panelEl = panelRef.current;
      const panelWidth = panelEl ? panelEl.offsetWidth : 380;
      const panelHeight = panelEl ? panelEl.offsetHeight : 500;
      setPosition(computePosition(mapEditor.anchorRect, panelWidth, panelHeight));
    };

    // Compute immediately on open (panelRef may not be populated yet, use estimated size)
    setPosition(computePosition(mapEditor.anchorRect, 380, 560));

    // Recompute once panel is rendered with actual dimensions
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => updatePosition());
    if (panelRef.current && resizeObserver) {
      resizeObserver.observe(panelRef.current);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      resizeObserver?.disconnect();
    };
  }, [mapEditor, isMobile]);

  // ESC dismiss
  useEffect(() => {
    if (!mapEditor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMapEditor();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mapEditor, closeMapEditor]);

  if (!mapEditor) return null;

  const editorContent = (() => {
    if (mapEditor.kind === "site") {
      return (
        <SiteEditorCard
          form={form}
          isNew={mapEditor.isNew}
          onClose={closeMapEditor}
          onOpenChangeLog={openChangeLogPopup}
          onOpenUserProfile={(userId) => void openUserProfilePopup(userId)}
        />
      );
    }
    if (mapEditor.kind === "link") {
      return <LinkEditorCard form={form} isNew={mapEditor.isNew} onClose={closeMapEditor} />;
    }
    if (mapEditor.kind === "simulation") {
      return <SimulationEditorCard form={form} isNew={mapEditor.isNew} onClose={closeMapEditor} />;
    }
    return null;
  })();

  if (isMobile) {
    return createPortal(
      <>
        <div className="map-editor-sheet" ref={panelRef}>
          <div className="map-editor-sheet-handle" aria-hidden="true" />
          <div className="map-editor-sheet-content">
            {editorContent}
          </div>
        </div>
        <MapEditorAuxiliaryModals
          changeLogPopup={changeLogPopup}
          onCloseChangeLog={() => setChangeLogPopup(null)}
          onOpenUserProfile={(userId) => void openUserProfilePopup(userId)}
          onRevertChange={revertChangeAsCopy}
          canRevert={form.canWrite}
          onCloseProfile={closeUserProfilePopup}
          profilePopupBusy={profilePopupBusy}
          profilePopupStatus={profilePopupStatus}
          profilePopupUser={profilePopupUser}
        />
      </>,
      document.body,
    );
  }

  return createPortal(
    <>
      <Surface
        ref={panelRef}
        variant="card"
        className="map-editor-floating"
        style={
          position
            ? { left: position.left, top: position.top }
            : { visibility: "hidden", left: 0, top: 0 }
        }
      >
        {editorContent}
      </Surface>
      <MapEditorAuxiliaryModals
        changeLogPopup={changeLogPopup}
        onCloseChangeLog={() => setChangeLogPopup(null)}
        onOpenUserProfile={(userId) => void openUserProfilePopup(userId)}
        onRevertChange={revertChangeAsCopy}
        canRevert={form.canWrite}
        onCloseProfile={closeUserProfilePopup}
        profilePopupBusy={profilePopupBusy}
        profilePopupStatus={profilePopupStatus}
        profilePopupUser={profilePopupUser}
      />
    </>,
    document.body,
  );
}

function MapEditorAuxiliaryModals({
  changeLogPopup,
  onCloseChangeLog,
  onOpenUserProfile,
  onRevertChange,
  canRevert,
  onCloseProfile,
  profilePopupBusy,
  profilePopupStatus,
  profilePopupUser,
}: {
  changeLogPopup: {
    kind: "site";
    resourceId: string;
    label: string;
    changes: ResourceChange[];
    busy: boolean;
    status: string;
  } | null;
  onCloseChangeLog: () => void;
  onOpenUserProfile: (userId: string) => void;
  onRevertChange: (kind: "site", resourceId: string, changeId: number) => void;
  canRevert: boolean;
  onCloseProfile: () => void;
  profilePopupBusy: boolean;
  profilePopupStatus: string;
  profilePopupUser: CloudUser | null;
}) {
  return (
    <>
      {profilePopupUser || profilePopupBusy || profilePopupStatus ? (
        <ModalOverlay aria-label="User Profile" onClose={onCloseProfile} tier="raised">
          <div className="library-manager-card user-profile-popup">
            <div className="library-manager-header">
              <h2>User Profile</h2>
              <InlineCloseIconButton onClick={onCloseProfile} />
            </div>
            {profilePopupBusy ? <p className="field-help">Loading user...</p> : null}
            {profilePopupUser ? (
              <>
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
                <p className="field-help">Access: {profilePopupUser.accountState ?? "approved"}</p>
              </>
            ) : null}
            {profilePopupStatus ? <p className="field-help">{profilePopupStatus}</p> : null}
          </div>
        </ModalOverlay>
      ) : null}

      {changeLogPopup ? (
        <ModalOverlay aria-label="Change Log" onClose={onCloseChangeLog} tier="raised">
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Change Log · {changeLogPopup.label}</h2>
              <InlineCloseIconButton onClick={onCloseChangeLog} />
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
                    onClick={() => onOpenUserProfile(change.actorUserId)}
                    type="button"
                  >
                    <UserBadge avatarUrl={change.actorAvatarUrl} name={change.actorName ?? change.actorUserId} />
                  </button>
                  <p className="field-help">{formatChangeSummary(change.action, change.note)}</p>
                  {change.details && typeof change.details === "object" ? (
                    (() => {
                      const diffEntries = Object.entries(
                        ((change.details as { diff?: Record<string, { before: unknown; after: unknown }> }).diff ??
                          {}) as Record<string, { before: unknown; after: unknown }>,
                      ).filter(([field]) => isMeaningfulChangeField(field));
                      if (!diffEntries.length) return null;
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
                  {canRevert ? (
                    <div className="chip-group">
                      <ActionButton
                        onClick={() => onRevertChange(changeLogPopup.kind, changeLogPopup.resourceId, change.id)}
                        type="button"
                      >
                        Revert
                      </ActionButton>
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
    </>
  );
}
