import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { updateMyProfile, type CloudUser, type CloudUserProfilePatch } from "../../../lib/cloudUser";
import { FREQUENCY_PRESETS, frequencyPresetGroups } from "../../../lib/frequencyPlans";
import {
  MAX_CUSTOM_RADIO_PRESETS,
  findCustomRadioPreset,
  normalizeCustomRadioPresetName,
  normalizeUserSimulationDefaultsPreference,
  resolveUserSimulationDefaults,
  simulationDefaultsFromPreset,
  type SimulationDefaults,
  type UserSimulationDefaultsPreference,
} from "../../../lib/simulationDefaults";
import { buildRadioPresetShareUrl } from "../../../lib/radioPresetShare";
import { getUiErrorMessage } from "../../../lib/uiError";
import { useAppStore } from "../../../store/appStore";
import { useThemeVariant } from "../../../hooks/useThemeVariant";
import { getHolidayThemeCatalog } from "../../../themes/holidayThemes";
import { setHolidayThemePreview } from "../../../themes/holidayThemeDev";
import type { HolidayThemeKey, UiColorTheme } from "../../../themes/types";
import { AutoSaveIndicator, type AutoSaveState } from "../../ui/AutoSaveIndicator";
import { InfoTip } from "../../InfoTip";
import { Button } from "../../ui/Button";
import {
  MAX_CUSTOM_BASEMAP_SOURCES,
  customBasemapStyleId,
  normalizeUserBasemapPreferences,
  type CustomBasemapSource,
} from "../../../lib/basemapPreferences";
import { DEFAULT_BASEMAP_STYLE_ID } from "../../../lib/basemaps";

type PreferencesSectionProps = {
  me: CloudUser | null;
  onMeUpdated: (user: CloudUser, patch?: CloudUserProfilePatch) => void;
};

type SelectFieldState = {
  state: AutoSaveState;
  error: string | null;
};

const IDLE_SELECT: SelectFieldState = { state: "idle", error: null };
const PRESET_VALUE_SAVE_DEBOUNCE_MS = 300;

export function PreferencesSection({ me, onMeUpdated }: PreferencesSectionProps) {
  const radioPreferenceKey = JSON.stringify([
    me?.id ?? null,
    me?.defaultFrequencyPresetId ?? null,
    me?.simulationDefaultsPreference ?? null,
  ]);
  return (
    <section className="settings-section" aria-labelledby="settings-preferences-heading">
      <header className="settings-section-header">
        <h2 id="settings-preferences-heading">Preferences</h2>
        <p className="field-help">Theme preferences apply to this device. Other preferences sync to your account.</p>
      </header>
      <div className="settings-preferences-fields">
        <DeviceAndMapPreferences me={me} onMeUpdated={onMeUpdated} />
        <RadioPreferencesFields key={radioPreferenceKey} me={me} onMeUpdated={onMeUpdated} />
      </div>
    </section>
  );
}

function DeviceAndMapPreferences({ me, onMeUpdated }: PreferencesSectionProps) {
  const uiThemePreference = useAppStore((state) => state.uiThemePreference);
  const setUiThemePreference = useAppStore((state) => state.setUiThemePreference);
  const uiColorTheme = useAppStore((state) => state.uiColorTheme);
  const setUiColorTheme = useAppStore((state) => state.setUiColorTheme);
  const { activeHolidayTheme, holidayThemesVisible } = useThemeVariant();
  const holidayThemes = getHolidayThemeCatalog();
  const selectedColorThemeValue = activeHolidayTheme?.key ? `holiday:${activeHolidayTheme.key}` : uiColorTheme;
  const setHolidayThemeSelection = (holidayThemeKey: HolidayThemeKey | null) => {
    setHolidayThemePreview(holidayThemeKey);
    if (!holidayThemeKey) return;
    const holidayTheme = holidayThemes.find((theme) => theme.key === holidayThemeKey);
    if (holidayTheme) setUiColorTheme(holidayTheme.colorTheme as UiColorTheme);
  };

  return (
    <>
      <div className="autosave-field">
        <label className="autosave-field-label" htmlFor="pref-ui-theme">
          <span>UI theme <InfoTip text="Choose whether LinkSim follows your system theme, or force light/dark mode." /></span>
        </label>
        <select id="pref-ui-theme" className="locale-select" value={uiThemePreference} onChange={(event) => setUiThemePreference(event.target.value as "system" | "light" | "dark")}>
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <div className="field-help">Device-only preference — not synced across devices.</div>
      </div>

      <CustomBasemapManager me={me} onMeUpdated={onMeUpdated} />

      <div className="autosave-field">
        <label className="autosave-field-label" htmlFor="pref-color-theme">
          <span>Color theme <InfoTip text="Select the app accent palette." /></span>
        </label>
        <select
          id="pref-color-theme"
          className="locale-select"
          value={selectedColorThemeValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next.startsWith("holiday:")) {
              setHolidayThemeSelection(next.slice("holiday:".length) as HolidayThemeKey);
              return;
            }
            setHolidayThemePreview(null);
            setUiColorTheme(next as UiColorTheme);
          }}
        >
          <option value="blue">Blue</option>
          <option value="pink">Pink</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="neutral">Neutral</option>
          {holidayThemesVisible ? (
            <optgroup label="Seasonal">
              {holidayThemes.map((theme) => <option key={theme.key} value={`holiday:${theme.key}`}>{theme.title.replace(" Theme", "")}</option>)}
            </optgroup>
          ) : activeHolidayTheme ? (
            <option value={`holiday:${activeHolidayTheme.key}`}>{activeHolidayTheme.title.replace(" Theme", "")}</option>
          ) : null}
        </select>
      </div>
    </>
  );
}

type BasemapDraft = {
  id: string;
  name: string;
  kind: "style" | "raster-xyz";
  lightUrl: string;
  darkUrl: string;
  attribution: string;
  attributionUrl: string;
  maxZoom: number;
  tileSize: 256 | 512;
};

const emptyBasemapDraft = (): BasemapDraft => ({
  id: "", name: "", kind: "style", lightUrl: "", darkUrl: "", attribution: "", attributionUrl: "", maxZoom: 18, tileSize: 256,
});

function CustomBasemapManager({ me, onMeUpdated }: PreferencesSectionProps) {
  const setAuthState = useAppStore((state) => state.setAuthState);
  const basemapStyleId = useAppStore((state) => state.basemapStyleId);
  const setBasemapStyleId = useAppStore((state) => state.setBasemapStyleId);
  const sources = normalizeUserBasemapPreferences(me?.basemapPreferences).customSources;
  const [managedId, setManagedId] = useState("");
  const [draft, setDraft] = useState<BasemapDraft>(emptyBasemapDraft);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const editSource = (source: CustomBasemapSource) => {
    setManagedId(source.id);
    setDraft({
      id: source.id, name: source.name, kind: source.kind, lightUrl: source.lightUrl,
      darkUrl: source.darkUrl ?? "", attribution: source.attribution, attributionUrl: source.attributionUrl ?? "",
      maxZoom: source.kind === "raster-xyz" ? source.maxZoom : 18,
      tileSize: source.kind === "raster-xyz" ? source.tileSize : 256,
    });
    setStatus("");
  };

  const persist = async (nextSources: CustomBasemapSource[], success: string) => {
    setSaving(true);
    setStatus("");
    try {
      const basemapPreferences = normalizeUserBasemapPreferences({ version: 1, customSources: nextSources }, { strict: true });
      const updated = await updateMyProfile({ basemapPreferences });
      onMeUpdated(updated, { basemapPreferences });
      setAuthState("signed_in");
      setStatus(success);
      return true;
    } catch (error) {
      setStatus(getUiErrorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    const id = managedId || `map-${crypto.randomUUID()}`;
    const source = draft.kind === "style"
      ? { id, name: draft.name, kind: "style" as const, lightUrl: draft.lightUrl, darkUrl: draft.darkUrl || undefined, attribution: draft.attribution, attributionUrl: draft.attributionUrl || undefined }
      : { id, name: draft.name, kind: "raster-xyz" as const, lightUrl: draft.lightUrl, darkUrl: draft.darkUrl || undefined, attribution: draft.attribution, attributionUrl: draft.attributionUrl || undefined, maxZoom: draft.maxZoom, tileSize: draft.tileSize };
    const next = managedId ? sources.map((candidate) => candidate.id === managedId ? source : candidate) : [...sources, source];
    if (await persist(next, managedId ? "Custom map updated." : "Custom map created.")) {
      setManagedId(id);
      setDraft((current) => ({ ...current, id }));
    }
  };

  const deleteManaged = async () => {
    if (!managedId) return;
    if (await persist(sources.filter((source) => source.id !== managedId), "Custom map deleted.")) {
      if (basemapStyleId === customBasemapStyleId(managedId)) setBasemapStyleId(DEFAULT_BASEMAP_STYLE_ID);
      setManagedId("");
      setDraft(emptyBasemapDraft());
    }
  };

  const testConnection = async () => {
    setStatus("Testing connection…");
    const testUrl = draft.kind === "raster-xyz"
      ? draft.lightUrl.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0")
      : draft.lightUrl;
    try {
      const response = await fetch(testUrl, { method: "GET", mode: "cors" });
      setStatus(response.ok ? "Connection succeeded." : `Connection returned HTTP ${response.status}.`);
    } catch (error) {
      setStatus(`Connection test failed: ${getUiErrorMessage(error)}`);
    }
  };

  return (
    <div className="autosave-field custom-basemap-manager">
      <label className="autosave-field-label" htmlFor="pref-custom-basemap-manager">
        <span>Custom maps <InfoTip text="Add a MapLibre style URL or raster XYZ tile template. Definitions sync to your account; the selected map stays on this device." /></span>
      </label>
      <select id="pref-custom-basemap-manager" className="locale-select" value={managedId} onChange={(event) => {
        const source = sources.find((candidate) => candidate.id === event.target.value);
        if (source) editSource(source); else { setManagedId(""); setDraft(emptyBasemapDraft()); setStatus(""); }
      }}>
        <option value="">Create a custom map</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select>
      <label className="field-grid"><span>Name</span><input aria-label="Custom map name" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field-grid"><span>Source type</span><select aria-label="Custom map source type" className="locale-select" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as BasemapDraft["kind"] })}><option value="style">MapLibre style URL</option><option value="raster-xyz">Raster XYZ</option></select></label>
      <label className="field-grid"><span>Light URL</span><input aria-label="Custom map light URL" maxLength={2048} value={draft.lightUrl} onChange={(event) => setDraft({ ...draft, lightUrl: event.target.value })} /></label>
      <label className="field-grid"><span>Dark URL</span><input aria-label="Custom map dark URL" maxLength={2048} placeholder="Optional — reuses light URL" value={draft.darkUrl} onChange={(event) => setDraft({ ...draft, darkUrl: event.target.value })} /></label>
      <label className="field-grid"><span>Attribution</span><input aria-label="Custom map attribution" maxLength={300} value={draft.attribution} onChange={(event) => setDraft({ ...draft, attribution: event.target.value })} /></label>
      <label className="field-grid"><span>Attribution URL</span><input aria-label="Custom map attribution URL" maxLength={2048} value={draft.attributionUrl} onChange={(event) => setDraft({ ...draft, attributionUrl: event.target.value })} /></label>
      {draft.kind === "raster-xyz" ? <>
        <label className="field-grid"><span>Max zoom</span><input aria-label="Custom map max zoom" min={0} max={24} type="number" value={draft.maxZoom} onChange={(event) => setDraft({ ...draft, maxZoom: Number(event.target.value) })} /></label>
        <label className="field-grid"><span>Tile size</span><select aria-label="Custom map tile size" className="locale-select" value={draft.tileSize} onChange={(event) => setDraft({ ...draft, tileSize: Number(event.target.value) as 256 | 512 })}><option value={256}>256</option><option value={512}>512</option></select></label>
      </> : null}
      <p className="field-help">Requests go directly from your browser. HTTP sources are normally blocked on hosted LinkSim. Complete URLs, including query tokens, are stored in private LinkSim profile data and are visible to LinkSim database operators; this is not a secret vault.</p>
      <div className="custom-radio-preset-actions">
        <Button aria-label={managedId ? "Save custom map" : "Create custom map"} disabled={saving || (!managedId && sources.length >= MAX_CUSTOM_BASEMAP_SOURCES)} onClick={() => void saveDraft()} type="button"><Plus aria-hidden="true" size={14} /> {managedId ? "Save" : "Create"}</Button>
        <Button disabled={saving || !draft.lightUrl} onClick={() => void testConnection()} type="button" variant="ghost">Test connection</Button>
        {managedId ? <Button aria-label={`Delete custom map: ${draft.name}`} disabled={saving} onClick={() => void deleteManaged()} type="button" variant="danger"><Trash2 aria-hidden="true" size={14} /> Delete</Button> : null}
      </div>
      {status ? <p className="field-help" role="status">{status}</p> : null}
    </div>
  );
}

function RadioPreferencesFields({ me, onMeUpdated }: PreferencesSectionProps) {
  const setAuthState = useAppStore((state) => state.setAuthState);

  const initialPreference = useMemo(
    () => normalizeUserSimulationDefaultsPreference(
      me?.simulationDefaultsPreference,
      me?.defaultFrequencyPresetId,
    ),
    [me?.defaultFrequencyPresetId, me?.simulationDefaultsPreference],
  );
  const [preference, setPreference] = useState(initialPreference);
  const customPresets = useMemo(() => preference.customPresets ?? [], [preference.customPresets]);

  const [presetState, setPresetState] = useState<SelectFieldState>(IDLE_SELECT);
  const [managedPresetId, setManagedPresetId] = useState(
    initialPreference.mode === "custom" ? initialPreference.customPresetId ?? initialPreference.customPresets?.[0]?.id ?? "" : "",
  );
  const [newPresetName, setNewPresetName] = useState("");
  const [renameDraft, setRenameDraft] = useState<{ presetId: string; value: string } | null>(null);
  const [presetActionStatus, setPresetActionStatus] = useState("");
  const latestRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const pendingSaveRef = useRef<{ preference: UserSimulationDefaultsPreference; revision: number } | null>(null);
  const queuedSaveRef = useRef<{ preference: UserSimulationDefaultsPreference; revision: number } | null>(null);
  const saveInFlightRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const resolvedManagedPresetId = customPresets.some((preset) => preset.id === managedPresetId)
    ? managedPresetId
    : preference.mode === "custom"
      ? preference.customPresetId ?? customPresets[0]?.id ?? ""
      : "";
  const managedPreset = findCustomRadioPreset(preference, resolvedManagedPresetId);
  const renameValue = renameDraft && renameDraft.presetId === managedPreset?.id
    ? renameDraft.value
    : managedPreset?.name ?? "";
  const activeDefaults = resolveUserSimulationDefaults(preference, me?.defaultFrequencyPresetId);
  const editableDefaults = managedPreset?.defaults ?? activeDefaults;

  const drainPreferenceSaveQueue = useCallback(
    async function drainPreferenceSaveQueue(): Promise<void> {
      if (saveInFlightRef.current || !queuedSaveRef.current) return;
      const request = queuedSaveRef.current;
      queuedSaveRef.current = null;
      saveInFlightRef.current = true;
      try {
        const updated = await updateMyProfile({
          defaultFrequencyPresetId: request.preference.presetId,
          simulationDefaultsPreference: request.preference,
        });
        const isLatest = request.revision === latestRevisionRef.current
          && !pendingSaveRef.current
          && !queuedSaveRef.current;
        if (isLatest) {
          persistedRevisionRef.current = request.revision;
          if (mountedRef.current) {
            onMeUpdated(updated, {
              defaultFrequencyPresetId: request.preference.presetId,
              simulationDefaultsPreference: request.preference,
            });
            setAuthState("signed_in");
            setPresetState({ state: "saved", error: null });
            if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
            savedTimerRef.current = window.setTimeout(() => {
              if (mountedRef.current) setPresetState((current) => (current.state === "saved" ? IDLE_SELECT : current));
            }, 1800);
          }
        }
      } catch (error) {
        const isLatest = request.revision === latestRevisionRef.current
          && !pendingSaveRef.current
          && !queuedSaveRef.current;
        if (isLatest && mountedRef.current) {
          setPresetState({ state: "error", error: getUiErrorMessage(error) });
        }
      } finally {
        saveInFlightRef.current = false;
        if (queuedSaveRef.current) await drainPreferenceSaveQueue();
      }
    },
    [onMeUpdated, setAuthState],
  );

  const flushPendingPreferenceSave = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!pendingSaveRef.current) return;
    queuedSaveRef.current = pendingSaveRef.current;
    pendingSaveRef.current = null;
    void drainPreferenceSaveQueue();
  }, [drainPreferenceSaveQueue]);

  const saveSimulationDefaultsPreference = useCallback(
    (nextPreference: UserSimulationDefaultsPreference, debounce = false) => {
      const normalized = normalizeUserSimulationDefaultsPreference(nextPreference);
      const revision = latestRevisionRef.current + 1;
      latestRevisionRef.current = revision;
      setPreference(normalized);
      setPresetState({ state: "saving", error: null });
      if (savedTimerRef.current != null) {
        window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }

      // A newer complete draft supersedes any queued snapshot that has not started.
      queuedSaveRef.current = null;
      pendingSaveRef.current = { preference: normalized, revision };
      if (!debounce) {
        flushPendingPreferenceSave();
        return;
      }
      if (debounceTimerRef.current != null) window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        flushPendingPreferenceSave();
      }, PRESET_VALUE_SAVE_DEBOUNCE_MS);
    },
    [flushPendingPreferenceSave],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current != null) window.clearTimeout(debounceTimerRef.current);
      if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
      if (pendingSaveRef.current) {
        queuedSaveRef.current = pendingSaveRef.current;
        pendingSaveRef.current = null;
        void drainPreferenceSaveQueue();
      }
    };
  }, [drainPreferenceSaveQueue]);

  const patchPreferenceDefaults = (patch: Partial<SimulationDefaults>) => {
    if (managedPreset) {
      const nextDefaults = { ...managedPreset.defaults, ...patch, frequencyPresetId: managedPreset.id };
      saveSimulationDefaultsPreference({
        ...preference,
        customPresets: customPresets.map((preset) =>
          preset.id === managedPreset.id ? { ...preset, defaults: nextDefaults } : preset,
        ),
      }, true);
      return;
    }
    const base = simulationDefaultsFromPreset(preference.presetId);
    const nextDefaults = { ...base, ...activeDefaults, ...patch };
    saveSimulationDefaultsPreference({
      ...preference,
      overridePresetDefaults: true,
      overrides: nextDefaults,
    }, true);
  };

  const createCustomPreset = () => {
    const name = normalizeCustomRadioPresetName(newPresetName);
    if (!name) {
      setPresetActionStatus("Enter a preset name.");
      return;
    }
    if (customPresets.some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setPresetActionStatus("Preset names must be unique.");
      return;
    }
    if (customPresets.length >= MAX_CUSTOM_RADIO_PRESETS) {
      setPresetActionStatus(`You can save up to ${MAX_CUSTOM_RADIO_PRESETS} custom presets.`);
      return;
    }
    const id = `radio-${crypto.randomUUID()}`;
    saveSimulationDefaultsPreference({
      ...preference,
      customPresets: [...customPresets, { id, name, defaults: { ...activeDefaults, frequencyPresetId: id } }],
    });
    setManagedPresetId(id);
    setNewPresetName("");
    setPresetActionStatus("Custom preset created.");
  };

  const renameManagedPreset = () => {
    if (!managedPreset) return;
    const name = normalizeCustomRadioPresetName(renameValue);
    if (!name) {
      setPresetActionStatus("Enter a preset name.");
      return;
    }
    if (customPresets.some((preset) => preset.id !== managedPreset.id && preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setPresetActionStatus("Preset names must be unique.");
      return;
    }
    saveSimulationDefaultsPreference({
      ...preference,
      customPresets: customPresets.map((preset) => preset.id === managedPreset.id ? { ...preset, name } : preset),
    });
    setPresetActionStatus("Preset renamed.");
  };

  const deleteManagedPreset = () => {
    if (!managedPreset || preference.mode === "custom" && preference.customPresetId === managedPreset.id) return;
    saveSimulationDefaultsPreference({
      ...preference,
      customPresets: customPresets.filter((preset) => preset.id !== managedPreset.id),
    });
    setManagedPresetId("");
    setPresetActionStatus("Preset deleted.");
  };

  const shareManagedPreset = async () => {
    if (!managedPreset || latestRevisionRef.current !== persistedRevisionRef.current || presetState.state === "error") return;
    try {
      await navigator.clipboard.writeText(buildRadioPresetShareUrl(managedPreset, window.location));
      setPresetActionStatus("Preset link copied.");
    } catch (error) {
      setPresetActionStatus(`Unable to copy preset link: ${getUiErrorMessage(error)}`);
    }
  };

  return (
    <>
        <div className="autosave-field">
          <label className="autosave-field-label" htmlFor="pref-default-preset">
            <span>
              Default simulation settings{" "}
              <InfoTip text="This cloud setting controls simulations that inherit your account defaults. Use override/custom to edit channel, RX target, and environment defaults." />
            </span>
            <AutoSaveIndicator
              state={presetState.state}
              errorMessage={presetState.error}
              fieldLabel="Default preset"
            />
          </label>
          <select
            id="pref-default-preset"
            className="locale-select"
            value={preference.mode === "custom" ? `custom:${preference.customPresetId}` : preference.presetId}
            onChange={(event) => {
              const next = event.target.value;
              if (next.startsWith("custom:")) {
                const customPresetId = next.slice("custom:".length);
                saveSimulationDefaultsPreference({
                  ...preference,
                  mode: "custom",
                  customPresetId,
                  overridePresetDefaults: false,
                });
                setManagedPresetId(customPresetId);
                return;
              }
              setManagedPresetId("");
              saveSimulationDefaultsPreference({ ...preference, mode: "preset", presetId: next, overridePresetDefaults: false });
            }}
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
            {customPresets.length ? (
              <optgroup label="My presets">
                {customPresets.map((preset) => (
                  <option key={preset.id} value={`custom:${preset.id}`}>{preset.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        <div className="autosave-field custom-radio-preset-manager">
          <label className="autosave-field-label" htmlFor="pref-custom-preset-manager">
            <span>Custom radio presets <InfoTip text="Create named presets, edit their complete Simulation defaults, or copy a portable share link." /></span>
          </label>
          <div className="custom-radio-preset-create-row">
            <input
              aria-label="New custom preset name"
              maxLength={80}
              onChange={(event) => setNewPresetName(event.target.value)}
              placeholder="New preset name"
              type="text"
              value={newPresetName}
            />
            <Button disabled={customPresets.length >= MAX_CUSTOM_RADIO_PRESETS} onClick={createCustomPreset} type="button">
              <Plus aria-hidden="true" size={14} /> Create
            </Button>
          </div>
          {customPresets.length ? (
            <>
              <select
                aria-label="Custom preset to manage"
                className="locale-select"
                id="pref-custom-preset-manager"
                onChange={(event) => { setManagedPresetId(event.target.value); setPresetActionStatus(""); }}
                value={resolvedManagedPresetId}
              >
                <option value="">Select a custom preset to manage</option>
                {customPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
              {managedPreset ? (
                <>
                  <div className="custom-radio-preset-create-row">
                    <input aria-label="Custom preset name" maxLength={80} onChange={(event) => setRenameDraft({ presetId: managedPreset.id, value: event.target.value })} type="text" value={renameValue} />
                    <Button disabled={renameValue.trim() === managedPreset.name} onClick={renameManagedPreset} type="button" variant="ghost">Rename</Button>
                  </div>
                  <div className="custom-radio-preset-actions">
                    <Button
                      aria-label={`Share custom preset: ${managedPreset.name}`}
                      disabled={latestRevisionRef.current !== persistedRevisionRef.current || presetState.state === "error"}
                      onClick={() => void shareManagedPreset()}
                      title="Copy share link"
                      type="button"
                      variant="ghost"
                    ><Copy aria-hidden="true" size={14} /> Share</Button>
                    <Button
                      aria-label={`Delete custom preset: ${managedPreset.name}`}
                      disabled={preference.mode === "custom" && preference.customPresetId === managedPreset.id}
                      onClick={deleteManagedPreset}
                      title={preference.mode === "custom" && preference.customPresetId === managedPreset.id ? "Select another account default before deleting" : "Delete custom preset"}
                      type="button"
                      variant="danger"
                    ><Trash2 aria-hidden="true" size={14} /> Delete</Button>
                  </div>
                </>
              ) : null}
            </>
          ) : <p className="field-help">No custom presets saved yet.</p>}
          {presetActionStatus ? <p className="field-help" role="status">{presetActionStatus}</p> : null}
        </div>

        {preference.mode === "preset" ? (
          <label className="field-grid">
            <span>Override preset settings</span>
            <input
              aria-label="Override preset settings"
              checked={preference.overridePresetDefaults}
              onChange={(event) => {
                setManagedPresetId("");
                saveSimulationDefaultsPreference({
                  ...preference,
                  overridePresetDefaults: event.target.checked,
                  overrides: event.target.checked ? activeDefaults : undefined,
                });
              }}
              type="checkbox"
            />
          </label>
        ) : null}

        {managedPreset || preference.overridePresetDefaults ? (
          <div className="autosave-field" onBlur={flushPendingPreferenceSave}>
            <label className="field-grid">
              <span>Frequency (MHz)</span>
              <input type="number" value={editableDefaults.frequencyMHz} onChange={(event) => patchPreferenceDefaults({ frequencyMHz: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Bandwidth (kHz)</span>
              <input type="number" value={editableDefaults.bandwidthKhz} onChange={(event) => patchPreferenceDefaults({ bandwidthKhz: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Spread factor</span>
              <input type="number" value={editableDefaults.spreadFactor} onChange={(event) => patchPreferenceDefaults({ spreadFactor: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Coding rate</span>
              <input type="number" value={editableDefaults.codingRate} onChange={(event) => patchPreferenceDefaults({ codingRate: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Region code</span>
              <input type="text" value={editableDefaults.regionCode ?? ""} onChange={(event) => patchPreferenceDefaults({ regionCode: event.target.value || undefined })} />
            </label>
            <label className="field-grid">
              <span>RX target (dBm)</span>
              <input type="number" value={editableDefaults.rxSensitivityTargetDbm} onChange={(event) => patchPreferenceDefaults({ rxSensitivityTargetDbm: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Env loss (dB)</span>
              <input min={0} type="number" value={editableDefaults.environmentLossDb} onChange={(event) => patchPreferenceDefaults({ environmentLossDb: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Auto environment defaults</span>
              <input aria-label="Auto environment defaults" checked={editableDefaults.autoPropagationEnvironment} onChange={(event) => patchPreferenceDefaults({ autoPropagationEnvironment: event.target.checked })} type="checkbox" />
            </label>
            {editableDefaults.autoPropagationEnvironment ? (
              <p className="field-help">Auto derives climate and clutter from terrain for each path. Turn it off to use fixed manual environment values.</p>
            ) : (
              <>
                <label className="field-grid">
                  <span>Radio climate</span>
                  <select className="locale-select" value={editableDefaults.propagationEnvironment.radioClimate} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...editableDefaults.propagationEnvironment, radioClimate: event.target.value as SimulationDefaults["propagationEnvironment"]["radioClimate"] } })}>
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
                  <span>Polarization</span>
                  <select className="locale-select" value={editableDefaults.propagationEnvironment.polarization} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...editableDefaults.propagationEnvironment, polarization: event.target.value as SimulationDefaults["propagationEnvironment"]["polarization"] } })}>
                    <option value="Vertical">Vertical</option>
                    <option value="Horizontal">Horizontal</option>
                  </select>
                </label>
                <label className="field-grid">
                  <span>Clutter height (m)</span>
                  <input type="number" value={editableDefaults.propagationEnvironment.clutterHeightM} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...editableDefaults.propagationEnvironment, clutterHeightM: Number(event.target.value) } })} />
                </label>
                <label className="field-grid">
                  <span>Ground dielectric</span>
                  <input type="number" value={editableDefaults.propagationEnvironment.groundDielectric} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...editableDefaults.propagationEnvironment, groundDielectric: Number(event.target.value) } })} />
                </label>
                <label className="field-grid">
                  <span>Ground conductivity</span>
                  <input type="number" value={editableDefaults.propagationEnvironment.groundConductivity} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...editableDefaults.propagationEnvironment, groundConductivity: Number(event.target.value) } })} />
                </label>
                <label className="field-grid">
                  <span>Atmospheric bending (N-units)</span>
                  <input type="number" value={editableDefaults.propagationEnvironment.atmosphericBendingNUnits} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...editableDefaults.propagationEnvironment, atmosphericBendingNUnits: Number(event.target.value) } })} />
                </label>
              </>
            )}
          </div>
        ) : null}
    </>
  );
}
