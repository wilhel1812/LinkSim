import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { FREQUENCY_PRESETS, frequencyPresetGroups } from "../../lib/frequencyPlans";
import { useAppStore } from "../../store/appStore";
import { useMapEditorFormState } from "./useMapEditorFormState";
import { AccessSettingsEditor } from "../AccessSettingsEditor";
import { ActionButton } from "../ActionButton";
import { Surface } from "../ui/Surface";
import { InlineCloseIconButton } from "../InlineCloseIconButton";
import { SiteBeamVisualizer } from "../SiteBeamVisualizer";

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

// ─── Site Editor Card ────────────────────────────────────────────────────────

function SiteEditorCard({
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
        <h2>{isNew ? "New Site" : `Edit · ${mapEditor?.label ?? "Site"}`}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      {!form.canWrite && !isNew && (
        <p className="field-help warning-text">Read-only: you can view this site but cannot edit it.</p>
      )}

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
          onAddCollaborator={form.addCollaborator}
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
      return <SiteEditorCard form={form} isNew={mapEditor.isNew} onClose={closeMapEditor} />;
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
      <div className="map-editor-sheet" ref={panelRef}>
        <div className="map-editor-sheet-handle" aria-hidden="true" />
        <div className="map-editor-sheet-content">
          {editorContent}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
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
    </Surface>,
    document.body,
  );
}
