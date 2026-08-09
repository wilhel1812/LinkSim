import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, History, Loader2, Pencil, RefreshCw, Search } from "lucide-react";
import {
  fetchResourceChanges,
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
import { Button } from "../ui/Button";
import { Surface } from "../ui/Surface";
import { InlineCloseIconButton } from "../InlineCloseIconButton";
import { SiteBeamVisualizer } from "../SiteBeamVisualizer";
import { AvatarBadge } from "../AvatarBadge";
import { ModalOverlay } from "../ModalOverlay";
import { FloatingPopover } from "../ui/FloatingPopover";
import { UserProfilePopover, type UserProfilePopoverTarget } from "../UserProfilePopover";
import { ConfirmActionModal } from "../ConfirmActionModal";
import {
  getSiteIconOption,
  resolveSiteIconKey,
  SITE_ICON_OPTIONS,
  suggestSiteIconKey,
} from "../../lib/siteIcons";
import { SIMULATION_COLOR_PRESETS } from "../../lib/simulationColors";

function SimulationColorControl({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="simulation-color-field">
      <span>{label}</span>
      <div aria-label={`${label} presets`} className="simulation-color-presets" role="group">
        {SIMULATION_COLOR_PRESETS.map((preset) => (
          <button
            aria-label={`Set ${label} to ${preset.label}`}
            aria-pressed={value === preset.value}
            className="simulation-color-swatch"
            disabled={disabled}
            key={preset.value}
            onClick={() => onChange(preset.value)}
            style={{ "--simulation-swatch-color": preset.value } as CSSProperties}
            title={preset.label}
            type="button"
          />
        ))}
        <span aria-hidden="true" className="simulation-color-separator" />
        <button
          aria-label={`Use theme ${label}`}
          aria-pressed={value === null}
          className="simulation-color-swatch is-theme-color"
          disabled={disabled}
          onClick={() => onChange(null)}
          title="Use theme color"
          type="button"
        />
      </div>
    </div>
  );
}

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

type ResourceKindWithChanges = "site" | "simulation";

type ResourceMetadata = {
  kind: ResourceKindWithChanges;
  resourceId: string;
  label: string;
  owner: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  lastEditedBy: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
};

const formatStaticValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  return String(value);
};

function StaticField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="field-grid">
      <span>{label}</span>
      <span aria-label={label} className="field-help static-field-value">
        {formatStaticValue(value)}
      </span>
    </div>
  );
}

const UserBadge = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
  <span className="user-list-row">
    <AvatarBadge avatarUrl={avatarUrl} imageClassName="profile-avatar" name={name} />
    <span>{name}</span>
  </span>
);

function EditorMetadataStrip({
  metadata,
  onOpenChangeLog,
  onOpenUserProfile,
}: {
  metadata: ResourceMetadata;
  onOpenChangeLog: (kind: ResourceKindWithChanges, resourceId: string, label: string) => void;
  onOpenUserProfile: (userId: string, anchor: HTMLElement) => void;
}) {
  return (
    <div className="editor-meta-footer" aria-label="Resource metadata">
      <span className="editor-meta-item">
        <span className="editor-meta-label">Owner</span>
        <ActionButton
          aria-label={`Open owner profile: ${metadata.owner.name}`}
          className="editor-meta-avatar-button"
          onClick={(event) => onOpenUserProfile(metadata.owner.id, event.currentTarget)}
          size="icon"
          title={`Owner: ${metadata.owner.name}`}
          type="button"
        >
          <AvatarBadge
            avatarUrl={metadata.owner.avatarUrl}
            imageClassName="editor-meta-avatar"
            name={metadata.owner.name}
          />
        </ActionButton>
      </span>
      <span className="editor-meta-item">
        <span className="editor-meta-label">Last edited</span>
        <ActionButton
          aria-label={`Open last editor profile: ${metadata.lastEditedBy.name}`}
          className="editor-meta-avatar-button"
          onClick={(event) => onOpenUserProfile(metadata.lastEditedBy.id, event.currentTarget)}
          size="icon"
          title={`Last edited by: ${metadata.lastEditedBy.name}`}
          type="button"
        >
          <AvatarBadge
            avatarUrl={metadata.lastEditedBy.avatarUrl}
            imageClassName="editor-meta-avatar"
            name={metadata.lastEditedBy.name}
          />
        </ActionButton>
      </span>
      <ActionButton
        aria-label="Open change log"
        onClick={() => onOpenChangeLog(metadata.kind, metadata.resourceId, metadata.label)}
        size="icon"
        title="Change log"
        type="button"
      >
        <History aria-hidden="true" size={17} strokeWidth={1.8} />
      </ActionButton>
    </div>
  );
}

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
  onRequestDelete,
  onOpenChangeLog,
  onOpenUserProfile,
}: {
  isNew: boolean;
  form: ReturnType<typeof useMapEditorFormState>;
  onClose: () => void;
  onRequestDelete: () => void;
  onOpenChangeLog: (kind: ResourceKindWithChanges, resourceId: string, label: string) => void;
  onOpenUserProfile: (userId: string, anchor: HTMLElement) => void;
}) {
  const mapEditor = useAppStore((state) => state.mapEditor);
  const isReadOnly = Boolean(mapEditor?.readOnly && !isNew) || (!form.canWrite && !isNew);
  const title = isNew ? "New Site" : (mapEditor?.label ?? form.nameDraft);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const suggestedIconKey = suggestSiteIconKey({ name: form.nameDraft, antennaHeightM: form.antennaDraft });
  const resolvedIconKey = resolveSiteIconKey({
    name: form.nameDraft,
    antennaHeightM: form.antennaDraft,
    iconKey: form.iconDraft === "auto" ? undefined : form.iconDraft,
  });
  const resolvedIconOption = getSiteIconOption(resolvedIconKey);
  const ResolvedIcon = resolvedIconOption.Icon;

  return (
    <>
      <div className="library-manager-header">
        <h2>{title}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      {isReadOnly && (
        <p className="field-help warning-text">Read-only: you can view this site but cannot edit it.</p>
      )}

      {isReadOnly ? (
        <div className="resource-edit-fieldset">
          <StaticField label="Name" value={form.nameDraft} />
          <StaticField label="Description" value={form.descriptionDraft} />
          <StaticField label="Visibility" value={form.accessVisibility} />
          <StaticField label="Latitude" value={form.latDraft} />
          <StaticField label="Longitude" value={form.lonDraft} />
          <StaticField label="Ground elev (m)" value={form.groundDraft} />
          <div className="field-grid">
            <span>Icon</span>
            <span className="field-help static-field-value site-icon-static-value">
              <ResolvedIcon aria-label={resolvedIconOption.label} role="img" size={16} strokeWidth={1.8} />
            </span>
          </div>
          {form.activeSimulationSiteId ? (
            <StaticField label="Site icon color" value={form.activeSiteIconColor ?? "Theme color"} />
          ) : null}
          <div className="beam-visualizer-field-group">
            <StaticField label="Antenna (m)" value={form.antennaDraft} />
            <StaticField label="Tx power (dBm)" value={form.txPowerDraft} />
            {form.separateGain ? (
              <>
                <StaticField label="Tx gain (dBi)" value={form.txGainDraft} />
                <StaticField label="Rx gain (dBi)" value={form.rxGainDraft} />
              </>
            ) : (
              <StaticField label="Gain (dBi)" value={form.txGainDraft} />
            )}
            <StaticField label="Separate RX/TX gain" value={form.separateGain ? "Yes" : "No"} />
            <StaticField label="Cable loss (dB)" value={form.cableLossDraft} />
            <StaticField label="Antenna mode" value={form.antennaMode === "directional" ? "Directional" : "Omnidirectional"} />
            {form.antennaMode === "directional" ? (
              <>
                <StaticField label="Azimuth (°)" value={form.antennaAzimuthDraft.toFixed(1)} />
                <StaticField label="Tilt (°)" value={form.antennaTiltDraft.toFixed(1)} />
                <StaticField label="Horizontal beamwidth (°)" value={form.antennaHorizontalBeamwidthDraft} />
                <StaticField label="Vertical beamwidth (°)" value={form.antennaVerticalBeamwidthDraft} />
                <StaticField label="Maximum attenuation (dB)" value={form.antennaMaxAttenuationDraft} />
              </>
            ) : null}
          </div>
          <SiteBeamVisualizer
            values={{
              antennaHeightM: form.antennaDraft,
              txPowerDbm: form.txPowerDraft,
              txGainDbi: form.txGainDraft,
              rxGainDbi: form.rxGainDraft,
              cableLossDb: form.cableLossDraft,
              antennaMode: form.antennaMode,
              antennaHorizontalBeamwidthDeg: form.antennaHorizontalBeamwidthDraft,
              antennaVerticalBeamwidthDeg: form.antennaVerticalBeamwidthDraft,
              antennaMaxAttenuationDb: form.antennaMaxAttenuationDraft,
            }}
          />
        </div>
      ) : (
      <fieldset className="resource-edit-fieldset">
        <label className="field-grid">
          <span>Name</span>
          <input
            onChange={(e) => form.setNameDraft(e.target.value)}
            placeholder="My site"
            type="text"
            value={form.nameDraft}
          />
        </label>

        <div className="field-grid">
          <span>Icon</span>
          <ActionButton
            aria-label={resolvedIconOption.label}
            aria-expanded={iconPickerOpen}
            aria-haspopup="true"
            className="site-icon-picker-trigger"
            onClick={() => setIconPickerOpen((open) => !open)}
            ref={iconPickerTriggerRef}
            type="button"
          >
            <ResolvedIcon aria-hidden="true" size={16} strokeWidth={1.8} />
            <ChevronDown aria-hidden="true" size={14} />
          </ActionButton>
          <FloatingPopover
            className="site-icon-picker-popover"
            estimatedHeight={250}
            estimatedWidth={280}
            onClose={() => setIconPickerOpen(false)}
            open={iconPickerOpen}
            triggerRef={iconPickerTriggerRef}
          >
            <div aria-label="Site icon options" className="site-icon-picker-options" role="group">
              {[
                { ...getSiteIconOption(suggestedIconKey), key: "auto" as const },
                ...SITE_ICON_OPTIONS,
              ].map((option) => {
                const OptionIcon = option.Icon;
                return (
                  <ActionButton
                    aria-label={option.label}
                    aria-pressed={form.iconDraft === option.key}
                    className={form.iconDraft === option.key ? "is-selected" : undefined}
                    key={option.key}
                    onClick={() => {
                      form.setIconDraft(option.key);
                      setIconPickerOpen(false);
                    }}
                    size="icon"
                    title={option.label}
                    type="button"
                  >
                    <OptionIcon aria-hidden="true" size={16} strokeWidth={1.8} />
                  </ActionButton>
                );
              })}
            </div>
          </FloatingPopover>
        </div>

        {form.activeSimulationSiteId ? (
          <div className="simulation-site-color-control">
            <SimulationColorControl
              disabled={!form.canEditActiveSimulationAppearance}
              label="Site icon color"
              onChange={form.setActiveSiteIconColor}
              value={form.activeSiteIconColor}
            />
            <p className="field-help">Applies to this Simulation only.</p>
          </div>
        ) : null}

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
            aria-invalid={form.latError ? true : undefined}
            className={form.latError ? "input-error" : undefined}
            onChange={(e) => form.setLatDraft(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              form.setLatDraft(e.clipboardData.getData("text"));
            }}
            step="0.000001"
            type="number"
            value={form.latDraft}
          />
          {form.latError ? <p className="field-help warning-text">{form.latError}</p> : null}
        </label>

        <label className="field-grid">
          <span>Longitude</span>
          <input
            aria-invalid={form.lonError ? true : undefined}
            className={form.lonError ? "input-error" : undefined}
            onChange={(e) => form.setLonDraft(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              form.setLonDraft(e.clipboardData.getData("text"));
            }}
            step="0.000001"
            type="number"
            value={form.lonDraft}
          />
          {form.lonError ? <p className="field-help warning-text">{form.lonError}</p> : null}
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
            <Button
              aria-label="Search location"
              disabled={form.siteSearchBusy}
              onClick={() => void form.runSiteSearch()}
              size="icon"
              title="Search location"
              type="button"
            >
              {form.siteSearchBusy ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
            </Button>
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
            <Button
              aria-label="Fetch elevation"
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
              size="icon"
              title="Fetch elevation"
              type="button"
            >
              {form.isEditorTerrainFetching ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            </Button>
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

          <div className="field-grid gain-mode-toggle">
            <span>Directional antenna</span>
            <input
              aria-label="Directional antenna"
              checked={form.antennaMode === "directional"}
              onChange={(event) => form.setAntennaMode(event.target.checked ? "directional" : "omnidirectional")}
              type="checkbox"
            />
          </div>

          {form.antennaMode === "directional" ? (
            <div className="directional-antenna-fields">
              <label className="field-grid">
                <span>Azimuth (°)</span>
                <input
                  aria-label="Antenna azimuth"
                  disabled={Boolean(form.antennaTargetSiteId)}
                  max="359.999"
                  min="0"
                  onChange={(event) => form.setAntennaAzimuthDraft(event.target.value)}
                  step="0.1"
                  type="number"
                  value={form.antennaAzimuthDraft}
                />
              </label>
              <label className="field-grid">
                <span>Tilt (°)</span>
                <input
                  aria-label="Antenna tilt"
                  disabled={Boolean(form.antennaTargetSiteId)}
                  max="90"
                  min="-90"
                  onChange={(event) => form.setAntennaTiltDraft(event.target.value)}
                  step="0.1"
                  type="number"
                  value={form.antennaTiltDraft}
                />
              </label>
              <label className="field-grid">
                <span>Horizontal beamwidth (°)</span>
                <input
                  aria-label="Horizontal beamwidth"
                  max="180"
                  min="1"
                  onChange={(event) => form.setAntennaHorizontalBeamwidthDraft(event.target.value)}
                  type="number"
                  value={form.antennaHorizontalBeamwidthDraft}
                />
              </label>
              <label className="field-grid">
                <span>Vertical beamwidth (°)</span>
                <input
                  aria-label="Vertical beamwidth"
                  max="180"
                  min="1"
                  onChange={(event) => form.setAntennaVerticalBeamwidthDraft(event.target.value)}
                  type="number"
                  value={form.antennaVerticalBeamwidthDraft}
                />
              </label>
              <label className="field-grid">
                <span>Maximum attenuation (dB)</span>
                <input
                  aria-label="Maximum off-axis attenuation"
                  max="60"
                  min="0"
                  onChange={(event) => form.setAntennaMaxAttenuationDraft(event.target.value)}
                  type="number"
                  value={form.antennaMaxAttenuationDraft}
                />
              </label>
              {form.activeSimulationSiteId ? (
                <label className="field-grid">
                  <span>Point at Site</span>
                  <select
                    aria-label="Point antenna at Site"
                    onChange={(event) => form.pointAntennaAtSite(event.target.value)}
                    value={form.antennaTargetSiteId}
                  >
                    <option value="">Manual orientation</option>
                    {form.sites.filter((site) => site.id !== form.activeSimulationSiteId).map((site) => (
                      <option key={site.id} value={site.id}>{site.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {form.antennaTargetSiteId ? (
                <ActionButton onClick={form.detachAntennaTarget} type="button">Detach pointing target</ActionButton>
              ) : null}
            </div>
          ) : null}
        </div>

        <SiteBeamVisualizer
          values={{
            antennaHeightM: form.antennaDraft,
            txPowerDbm: form.txPowerDraft,
            txGainDbi: form.txGainDraft,
            rxGainDbi: form.rxGainDraft,
            cableLossDb: form.cableLossDraft,
            antennaMode: form.antennaMode,
            antennaHorizontalBeamwidthDeg: form.antennaHorizontalBeamwidthDraft,
            antennaVerticalBeamwidthDeg: form.antennaVerticalBeamwidthDraft,
            antennaMaxAttenuationDb: form.antennaMaxAttenuationDraft,
          }}
        />
      </fieldset>
      )}

      {form.status ? <p className="field-help">{form.status}</p> : null}

      <div className="chip-group">
        {!isReadOnly && isNew && mapEditor?.origin?.kind === "library" ? (
          <>
            <ActionButton onClick={() => form.handleSaveSite({ insertIntoSimulation: false })} type="button">
              Save to Library
            </ActionButton>
            {form.canAddToActiveSimulation ? (
              <ActionButton
                onClick={() => form.handleSaveSite({ insertIntoSimulation: true, exitLibrary: true })}
                type="button"
              >
                Save &amp; Add to Simulation
              </ActionButton>
            ) : null}
          </>
        ) : !isReadOnly ? (
          <ActionButton onClick={() => form.handleSaveSite()} type="button">
            {isNew ? "Create Site" : "Save Site"}
          </ActionButton>
        ) : null}
        {!isNew && !isReadOnly ? (
          <ActionButton onClick={onRequestDelete} type="button" variant="danger">
            Delete Site
          </ActionButton>
        ) : null}
        <ActionButton onClick={onClose} type="button">
          Cancel
        </ActionButton>
      </div>

      {!isNew && form.siteMetadata ? (
        <EditorMetadataStrip
          metadata={form.siteMetadata}
          onOpenChangeLog={onOpenChangeLog}
          onOpenUserProfile={onOpenUserProfile}
        />
      ) : null}
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
  const isReadOnly = Boolean(mapEditor?.readOnly && !isNew);
  const title = isNew ? "New Link" : (mapEditor?.label ?? form.linkNameDraft) || "Link";
  const fromSiteName = form.sites.find((site) => site.id === form.linkFromSiteId)?.name ?? "";
  const toSiteName = form.sites.find((site) => site.id === form.linkToSiteId)?.name ?? "";

  return (
    <>
      <div className="library-manager-header">
        <h2>{title}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      {isReadOnly ? <p className="field-help warning-text">Read-only: you can view this link but cannot edit it.</p> : null}

      {isReadOnly ? (
        <div className="resource-edit-fieldset">
          <StaticField label="Link name" value={form.linkNameDraft} />
          <StaticField label="From site" value={fromSiteName} />
          <StaticField label="To site" value={toSiteName} />
          <StaticField
            label="Link color"
            value={form.linkColorDraft ?? (form.activeLinkColorMode === "auto" ? "Automatic" : "Theme color")}
          />
          <StaticField label="Override site radio settings" value={form.overrideRadio ? "Yes" : "No"} />
          {form.overrideRadio ? (
            <>
              <StaticField label="Tx power (dBm)" value={form.linkTxPower} />
              <StaticField label="Tx gain (dBi)" value={form.linkTxGain} />
              <StaticField label="Rx gain (dBi)" value={form.linkRxGain} />
              <StaticField label="Cable loss (dB)" value={form.linkCableLoss} />
            </>
          ) : null}
        </div>
      ) : (
        <>
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

      {form.activeLinkColorMode === "manual" ? (
        <SimulationColorControl
          label="Link color"
          onChange={form.setLinkColorDraft}
          value={form.linkColorDraft}
        />
      ) : (
        <p className="field-help">This Simulation uses automatic Link colors from the Path Profile result.</p>
      )}

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
        </>
      )}

      {form.status ? <p className="field-help">{form.status}</p> : null}

      <div className="chip-group">
        {!isReadOnly ? (
          <ActionButton onClick={form.handleSaveLink} type="button">
            {isNew ? "Create Link" : "Save Link"}
          </ActionButton>
        ) : null}
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
  onOpenChangeLog,
  onOpenUserProfile,
  onRequestDelete,
  canDelete,
  isDeleted,
  lifecycleBusy,
  lifecycleError,
  onRestore,
}: {
  isNew: boolean;
  form: ReturnType<typeof useMapEditorFormState>;
  onClose: () => void;
  onOpenChangeLog: (kind: ResourceKindWithChanges, resourceId: string, label: string) => void;
  onOpenUserProfile: (userId: string, anchor: HTMLElement) => void;
  onRequestDelete: () => void;
  canDelete: boolean;
  isDeleted: boolean;
  lifecycleBusy: boolean;
  lifecycleError: string;
  onRestore: () => void;
}) {
  const mapEditor = useAppStore((state) => state.mapEditor);
  const isReadOnly = Boolean(mapEditor?.readOnly && !isNew) || (!form.canWrite && !isNew);
  const isCopySimulation = Boolean(mapEditor?.simulationSeed?.copyCurrentSimulation);
  const title = isNew ? (isCopySimulation ? "Save a copy" : "New Simulation") : (mapEditor?.label ?? form.nameDraft);
  const simulationDefaultsSummary = [
    `${form.simulationDefaultsDraft.frequencyMHz} MHz`,
    `${form.simulationDefaultsDraft.bandwidthKhz} kHz`,
    `SF${form.simulationDefaultsDraft.spreadFactor}`,
    `CR${form.simulationDefaultsDraft.codingRate}`,
    form.simulationDefaultsDraft.regionCode ? `Region ${form.simulationDefaultsDraft.regionCode}` : null,
    `RX ${form.simulationDefaultsDraft.rxSensitivityTargetDbm} dBm`,
    form.simulationDefaultsDraft.autoPropagationEnvironment
      ? "Auto environment"
      : `${form.simulationDefaultsDraft.propagationEnvironment.radioClimate}, ${form.simulationDefaultsDraft.propagationEnvironment.clutterHeightM} m clutter`,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <div className="library-manager-header">
        <h2>{title}</h2>
        <InlineCloseIconButton onClick={onClose} />
      </div>

      {isReadOnly && (
        <p className="field-help warning-text">
          {isDeleted ? "Deleted: this Simulation is available to platform admins for inspection and restoration only." : "Read-only: you can view this simulation but cannot edit it."}
        </p>
      )}

      {isReadOnly ? (
        <div className="resource-edit-fieldset">
          <StaticField label="Name" value={form.nameDraft} />
          <StaticField label="Description" value={form.descriptionDraft} />
          <StaticField label="Visibility" value={form.accessVisibility} />
          <div className="simulation-settings-block">
            <div className="simulation-settings-header">
              <span>Simulation settings</span>
            </div>
            <p className="field-help simulation-settings-summary">{simulationDefaultsSummary}</p>
          </div>
        </div>
      ) : (
      <fieldset className="resource-edit-fieldset">
        <label className="field-grid">
          <span>Name</span>
          <input
            aria-invalid={form.simulationNameError ? true : undefined}
            className={form.simulationNameError ? "input-error" : undefined}
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
        <div className="simulation-settings-block">
          <div className="simulation-settings-header">
            <span>Simulation settings</span>
            <Button
              aria-label={form.simulationDefaultsOverrideEnabled ? "Editing Simulation settings" : "Override Simulation settings"}
              disabled={form.simulationDefaultsOverrideEnabled}
              isSelected={form.simulationDefaultsOverrideEnabled}
              onClick={() => form.setSimulationDefaultsOverrideEnabled(true)}
              size="icon"
              title={form.simulationDefaultsOverrideEnabled ? "Editing Simulation settings" : "Override Simulation settings"}
              type="button"
            >
              <Pencil aria-hidden="true" size={14} />
            </Button>
          </div>
          <p className="field-help simulation-settings-summary">{simulationDefaultsSummary}</p>
        </div>
        {form.simulationDefaultsOverrideEnabled ? (
          <>
            <div className="simulation-settings-actions">
              <Button
                onClick={() => form.setSimulationDefaultsOverrideEnabled(false)}
                type="button"
                variant="ghost"
              >
                Use inherited defaults
              </Button>
            </div>
            <label className="field-grid">
              <span>Frequency (MHz)</span>
              <input type="number" value={form.simulationDefaultsDraft.frequencyMHz} onChange={(e) => form.setSimulationDefaultsDraft({ frequencyMHz: Number(e.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Bandwidth (kHz)</span>
              <input type="number" value={form.simulationDefaultsDraft.bandwidthKhz} onChange={(e) => form.setSimulationDefaultsDraft({ bandwidthKhz: Number(e.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Spread factor</span>
              <input type="number" value={form.simulationDefaultsDraft.spreadFactor} onChange={(e) => form.setSimulationDefaultsDraft({ spreadFactor: Number(e.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Coding rate</span>
              <input type="number" value={form.simulationDefaultsDraft.codingRate} onChange={(e) => form.setSimulationDefaultsDraft({ codingRate: Number(e.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Region code</span>
              <input type="text" value={form.simulationDefaultsDraft.regionCode ?? ""} onChange={(e) => form.setSimulationDefaultsDraft({ regionCode: e.target.value || undefined })} />
            </label>
            <label className="field-grid">
              <span>RX target (dBm)</span>
              <input type="number" value={form.simulationDefaultsDraft.rxSensitivityTargetDbm} onChange={(e) => form.setSimulationDefaultsDraft({ rxSensitivityTargetDbm: Number(e.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Env loss (dB)</span>
              <input min={0} type="number" value={form.simulationDefaultsDraft.environmentLossDb} onChange={(e) => form.setSimulationDefaultsDraft({ environmentLossDb: Number(e.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Auto environment defaults</span>
              <input aria-label="Auto environment defaults" checked={form.simulationDefaultsDraft.autoPropagationEnvironment} onChange={(e) => form.setSimulationDefaultsDraft({ autoPropagationEnvironment: e.target.checked })} type="checkbox" />
            </label>
            {form.simulationDefaultsDraft.autoPropagationEnvironment ? (
              <p className="field-help">Auto derives climate and clutter from terrain for each path. Turn it off to use fixed manual environment values.</p>
            ) : (
              <>
                <label className="field-grid">
                  <span>Radio climate</span>
                  <select className="locale-select" value={form.simulationDefaultsDraft.propagationEnvironment.radioClimate} onChange={(e) => form.setSimulationDefaultsDraft({ propagationEnvironment: { ...form.simulationDefaultsDraft.propagationEnvironment, radioClimate: e.target.value as typeof form.simulationDefaultsDraft.propagationEnvironment.radioClimate } })}>
                    <option value="Continental Temperate">Continental Temperate</option>
                    <option value="Maritime Temperate (Land)">Maritime Temperate (Land)</option>
                    <option value="Maritime Temperate (Sea)">Maritime Temperate (Sea)</option>
                    <option value="Desert">Desert</option>
                    <option value="Equatorial">Equatorial</option>
                    <option value="Continental Subtropical">Continental Subtropical</option>
                    <option value="Maritime Subtropical">Maritime Subtropical</option>
                  </select>
                </label>
                <label className="field-grid">
                  <span>Clutter height (m)</span>
                  <input type="number" value={form.simulationDefaultsDraft.propagationEnvironment.clutterHeightM} onChange={(e) => form.setSimulationDefaultsDraft({ propagationEnvironment: { ...form.simulationDefaultsDraft.propagationEnvironment, clutterHeightM: Number(e.target.value) } })} />
                </label>
                <label className="field-grid">
                  <span>Ground dielectric</span>
                  <input type="number" value={form.simulationDefaultsDraft.propagationEnvironment.groundDielectric} onChange={(e) => form.setSimulationDefaultsDraft({ propagationEnvironment: { ...form.simulationDefaultsDraft.propagationEnvironment, groundDielectric: Number(e.target.value) } })} />
                </label>
                <label className="field-grid">
                  <span>Ground conductivity</span>
                  <input type="number" value={form.simulationDefaultsDraft.propagationEnvironment.groundConductivity} onChange={(e) => form.setSimulationDefaultsDraft({ propagationEnvironment: { ...form.simulationDefaultsDraft.propagationEnvironment, groundConductivity: Number(e.target.value) } })} />
                </label>
                <label className="field-grid">
                  <span>Atmospheric bending (N-units)</span>
                  <input type="number" value={form.simulationDefaultsDraft.propagationEnvironment.atmosphericBendingNUnits} onChange={(e) => form.setSimulationDefaultsDraft({ propagationEnvironment: { ...form.simulationDefaultsDraft.propagationEnvironment, atmosphericBendingNUnits: Number(e.target.value) } })} />
                </label>
              </>
            )}
          </>
        ) : null}
      </fieldset>
      )}

      {form.simulationNameError ? <p className="field-help field-help-error">{form.simulationNameError}</p> : null}
      {form.status ? <p className="field-help">{form.status}</p> : null}
      {lifecycleError ? <p className="field-help field-help-error">{lifecycleError}</p> : null}

      <div className="chip-group">
        {!isReadOnly ? (
          <ActionButton onClick={form.handleSaveSimulation} type="button">
            {isNew ? (isCopySimulation ? "Save a copy" : "Create Simulation") : "Save"}
          </ActionButton>
        ) : null}
        {!isNew && isDeleted ? (
          <ActionButton disabled={lifecycleBusy} onClick={onRestore} type="button">
            {lifecycleBusy ? "Restoring..." : "Restore Simulation"}
          </ActionButton>
        ) : null}
        {!isNew && !isReadOnly && canDelete ? (
          <ActionButton onClick={onRequestDelete} type="button" variant="danger">
            Delete Simulation
          </ActionButton>
        ) : null}
        <ActionButton onClick={onClose} type="button">
          Cancel
        </ActionButton>
      </div>

      {!isNew && form.simulationMetadata ? (
        <EditorMetadataStrip
          metadata={form.simulationMetadata}
          onOpenChangeLog={onOpenChangeLog}
          onOpenUserProfile={onOpenUserProfile}
        />
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
  const deleteSiteLibraryEntry = useAppStore((state) => state.deleteSiteLibraryEntry);
  const deleteSimulationPreset = useAppStore((state) => state.deleteSimulationPreset);
  const restoreSimulationPreset = useAppStore((state) => state.restoreSimulationPreset);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const currentUser = useAppStore((state) => state.currentUser);
  const form = useMapEditorFormState();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [profileTarget, setProfileTarget] = useState<UserProfilePopoverTarget | null>(null);
  const [changeLogPopup, setChangeLogPopup] = useState<{
    kind: ResourceKindWithChanges;
    resourceId: string;
    label: string;
    changes: ResourceChange[];
    busy: boolean;
    status: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "site" | "simulation";
    resourceId: string;
    label: string;
  } | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");

  useEffect(() => {
    setLifecycleBusy(false);
    setLifecycleError("");
  }, [mapEditor?.kind, mapEditor?.resourceId]);

  const openUserProfilePopup = (userId: string, anchor: HTMLElement) => {
    if (userId) setProfileTarget({ anchor, userId });
  };

  const openChangeLogPopup = async (kind: ResourceKindWithChanges, resourceId: string, label: string) => {
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

  const revertChangeAsCopy = async (kind: ResourceKindWithChanges, resourceId: string, changeId: number) => {
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
      if (e.key === "Escape" && !e.defaultPrevented) closeMapEditor();
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
          onOpenUserProfile={openUserProfilePopup}
          onRequestDelete={() => {
            if (mapEditor.resourceId) {
              setDeleteTarget({ kind: "site", resourceId: mapEditor.resourceId, label: mapEditor.label });
            }
          }}
        />
      );
    }
    if (mapEditor.kind === "link") {
      return <LinkEditorCard form={form} isNew={mapEditor.isNew} onClose={closeMapEditor} />;
    }
    if (mapEditor.kind === "simulation") {
      const simulation = mapEditor.resourceId
        ? simulationPresets.find((preset) => preset.id === mapEditor.resourceId)
        : undefined;
      const isDeleted = simulation?.status === "deleted";
      const canDelete = Boolean(
        simulation &&
          !isDeleted &&
          currentUser?.id &&
          (currentUser.isAdmin || simulation.ownerUserId === currentUser.id || simulation.effectiveRole === "owner"),
      );
      return (
        <SimulationEditorCard
          form={form}
          isNew={mapEditor.isNew}
          onClose={closeMapEditor}
          onOpenChangeLog={openChangeLogPopup}
          onOpenUserProfile={openUserProfilePopup}
          canDelete={canDelete}
          isDeleted={isDeleted}
          lifecycleBusy={lifecycleBusy}
          lifecycleError={lifecycleError}
          onRequestDelete={() => {
            if (mapEditor.resourceId) {
              setDeleteTarget({ kind: "simulation", resourceId: mapEditor.resourceId, label: mapEditor.label });
            }
          }}
          onRestore={() => {
            if (!mapEditor.resourceId || lifecycleBusy) return;
            setLifecycleBusy(true);
            setLifecycleError("");
            void restoreSimulationPreset(mapEditor.resourceId)
              .then(() => closeMapEditor())
              .catch((error) => setLifecycleError(`Restore failed: ${getUiErrorMessage(error)}`))
              .finally(() => setLifecycleBusy(false));
          }}
        />
      );
    }
    return null;
  })();

  const deleteConfirmation = deleteTarget ? (
    <ConfirmActionModal
      busy={lifecycleBusy}
      error={lifecycleError}
      message={
        deleteTarget.kind === "site"
          ? `Delete ${deleteTarget.label} from the Library? Referenced Simulation data will be detached but preserved.`
          : `Delete ${deleteTarget.label} from the Library?${deleteTarget.resourceId === useAppStore.getState().selectedScenarioId ? " The active workspace will be cleared." : ""}`
      }
      onCancel={() => {
        if (!lifecycleBusy) {
          setLifecycleError("");
          setDeleteTarget(null);
        }
      }}
      onConfirm={() => {
        if (deleteTarget.kind === "site") {
          deleteSiteLibraryEntry(deleteTarget.resourceId);
          setDeleteTarget(null);
          closeMapEditor();
          return;
        }
        if (lifecycleBusy) return;
        setLifecycleBusy(true);
        setLifecycleError("");
        void deleteSimulationPreset(deleteTarget.resourceId)
          .then(() => {
            setDeleteTarget(null);
            closeMapEditor();
          })
          .catch((error) => setLifecycleError(`Delete failed: ${getUiErrorMessage(error)}`))
          .finally(() => setLifecycleBusy(false));
      }}
      title={deleteTarget.kind === "site" ? "Delete Site" : "Delete Simulation"}
    />
  ) : null;

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
          onOpenUserProfile={openUserProfilePopup}
          onRevertChange={revertChangeAsCopy}
          canRevert={form.canWrite}
          onCloseProfile={() => setProfileTarget(null)}
          profileTarget={profileTarget}
          viewer={form.currentUser}
        />
        {deleteConfirmation}
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
        onOpenUserProfile={openUserProfilePopup}
        onRevertChange={revertChangeAsCopy}
        canRevert={form.canWrite}
        onCloseProfile={() => setProfileTarget(null)}
        profileTarget={profileTarget}
        viewer={form.currentUser}
      />
      {deleteConfirmation}
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
  profileTarget,
  viewer,
}: {
  changeLogPopup: {
    kind: ResourceKindWithChanges;
    resourceId: string;
    label: string;
    changes: ResourceChange[];
    busy: boolean;
    status: string;
  } | null;
  onCloseChangeLog: () => void;
  onOpenUserProfile: (userId: string, anchor: HTMLElement) => void;
  onRevertChange: (kind: ResourceKindWithChanges, resourceId: string, changeId: number) => void;
  canRevert: boolean;
  onCloseProfile: () => void;
  profileTarget: UserProfilePopoverTarget | null;
  viewer: CloudUser | null;
}) {
  return (
    <>
      <UserProfilePopover onClose={onCloseProfile} target={profileTarget} viewer={viewer} />

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
                    aria-label={`Open profile for ${change.actorName ?? change.actorUserId}`}
                    className="inline-link-button"
                    onClick={(event) => onOpenUserProfile(change.actorUserId, event.currentTarget)}
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
