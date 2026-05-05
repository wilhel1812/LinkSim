import { useCallback, useState } from "react";
import { updateMyProfile, type CloudUser } from "../../../lib/cloudUser";
import { FREQUENCY_PRESETS, frequencyPresetGroups } from "../../../lib/frequencyPlans";
import {
  resolveUserSimulationDefaults,
  simulationDefaultsFromPreset,
  type SimulationDefaults,
  type UserSimulationDefaultsPreference,
} from "../../../lib/simulationDefaults";
import { getUiErrorMessage } from "../../../lib/uiError";
import { useAppStore } from "../../../store/appStore";
import { useThemeVariant } from "../../../hooks/useThemeVariant";
import type { UiColorTheme } from "../../../themes/types";
import { AutoSaveIndicator, type AutoSaveState } from "../../ui/AutoSaveIndicator";
import { InfoTip } from "../../InfoTip";

type PreferencesSectionProps = {
  me: CloudUser | null;
  onMeUpdated: (user: CloudUser) => void;
};

type SelectFieldState = {
  state: AutoSaveState;
  error: string | null;
};

const IDLE_SELECT: SelectFieldState = { state: "idle", error: null };

export function PreferencesSection({ me, onMeUpdated }: PreferencesSectionProps) {
  const uiThemePreference = useAppStore((state) => state.uiThemePreference);
  const setUiThemePreference = useAppStore((state) => state.setUiThemePreference);
  const uiColorTheme = useAppStore((state) => state.uiColorTheme);
  const setUiColorTheme = useAppStore((state) => state.setUiColorTheme);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setAuthState = useAppStore((state) => state.setAuthState);
  const { activeHolidayTheme } = useThemeVariant();

  const [presetState, setPresetState] = useState<SelectFieldState>(IDLE_SELECT);

  const preference: UserSimulationDefaultsPreference = me?.simulationDefaultsPreference ?? {
    mode: "preset",
    presetId: me?.defaultFrequencyPresetId ?? "oslo-local-869618",
    overridePresetDefaults: false,
  };
  const activeDefaults = resolveUserSimulationDefaults(preference, me?.defaultFrequencyPresetId);

  const saveSimulationDefaultsPreference = useCallback(
    async (nextPreference: UserSimulationDefaultsPreference) => {
      setPresetState({ state: "saving", error: null });
      try {
        const updated = await updateMyProfile({
          defaultFrequencyPresetId: nextPreference.presetId,
          simulationDefaultsPreference: nextPreference,
        });
        onMeUpdated(updated);
        setCurrentUser(updated);
        setAuthState("signed_in");
        setPresetState({ state: "saved", error: null });
        window.setTimeout(() => {
          setPresetState((current) => (current.state === "saved" ? IDLE_SELECT : current));
        }, 1800);
      } catch (error) {
        setPresetState({ state: "error", error: getUiErrorMessage(error) });
      }
    },
    [onMeUpdated, setAuthState, setCurrentUser],
  );

  const patchPreferenceDefaults = (patch: Partial<SimulationDefaults>) => {
    const base = preference.mode === "custom" ? activeDefaults : simulationDefaultsFromPreset(preference.presetId);
    const nextDefaults = { ...base, ...activeDefaults, ...patch };
    void saveSimulationDefaultsPreference({
      ...preference,
      overridePresetDefaults: preference.mode === "custom" ? preference.overridePresetDefaults : true,
      ...(preference.mode === "custom" ? { custom: nextDefaults } : { overrides: nextDefaults }),
    });
  };

  return (
    <section className="settings-section" aria-labelledby="settings-preferences-heading">
      <header className="settings-section-header">
        <h2 id="settings-preferences-heading">Preferences</h2>
        <p className="field-help">Theme preferences apply to this device. Other preferences sync to your account.</p>
      </header>

      <div className="settings-preferences-fields">
        <div className="autosave-field">
          <label className="autosave-field-label" htmlFor="pref-ui-theme">
            <span>
              UI theme{" "}
              <InfoTip text="Choose whether LinkSim follows your system theme, or force light/dark mode." />
            </span>
          </label>
          <select
            id="pref-ui-theme"
            className="locale-select"
            value={uiThemePreference}
            onChange={(event) =>
              setUiThemePreference(event.target.value as "system" | "light" | "dark")
            }
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
          <div className="field-help">Device-only preference — not synced across devices.</div>
        </div>

        <div className="autosave-field">
          <label className="autosave-field-label" htmlFor="pref-color-theme">
            <span>
              Color theme <InfoTip text="Select the app accent palette." />
            </span>
          </label>
          <select
            id="pref-color-theme"
            className="locale-select"
            value={uiColorTheme}
            onChange={(event) => setUiColorTheme(event.target.value as UiColorTheme)}
          >
            <option value="blue">Blue</option>
            <option value="pink">Pink</option>
            <option value="red">Red</option>
            <option value="green">Green</option>
            {activeHolidayTheme ? (
              <option value="yellow">{activeHolidayTheme.title.replace(" Theme", "")}</option>
            ) : null}
          </select>
        </div>

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
            value={preference.mode === "custom" ? "custom" : preference.presetId}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "custom") {
                void saveSimulationDefaultsPreference({
                  mode: "custom",
                  presetId: preference.presetId,
                  overridePresetDefaults: false,
                  custom: activeDefaults,
                });
                return;
              }
              void saveSimulationDefaultsPreference({ mode: "preset", presetId: next, overridePresetDefaults: false });
            }}
          >
            <option value="custom">Custom preset</option>
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
        </div>

        {preference.mode === "preset" ? (
          <label className="field-grid">
            <span>Override preset settings</span>
            <input
              aria-label="Override preset settings"
              checked={preference.overridePresetDefaults}
              onChange={(event) => {
                void saveSimulationDefaultsPreference({
                  ...preference,
                  overridePresetDefaults: event.target.checked,
                  overrides: event.target.checked ? activeDefaults : undefined,
                });
              }}
              type="checkbox"
            />
          </label>
        ) : null}

        {preference.mode === "custom" || preference.overridePresetDefaults ? (
          <div className="autosave-field">
            <label className="field-grid">
              <span>Frequency (MHz)</span>
              <input type="number" value={activeDefaults.frequencyMHz} onChange={(event) => patchPreferenceDefaults({ frequencyMHz: Number(event.target.value), frequencyPresetId: preference.presetId })} />
            </label>
            <label className="field-grid">
              <span>Bandwidth (kHz)</span>
              <input type="number" value={activeDefaults.bandwidthKhz} onChange={(event) => patchPreferenceDefaults({ bandwidthKhz: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Spread factor</span>
              <input type="number" value={activeDefaults.spreadFactor} onChange={(event) => patchPreferenceDefaults({ spreadFactor: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Coding rate</span>
              <input type="number" value={activeDefaults.codingRate} onChange={(event) => patchPreferenceDefaults({ codingRate: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Region code</span>
              <input type="text" value={activeDefaults.regionCode ?? ""} onChange={(event) => patchPreferenceDefaults({ regionCode: event.target.value || undefined })} />
            </label>
            <label className="field-grid">
              <span>RX target (dBm)</span>
              <input type="number" value={activeDefaults.rxSensitivityTargetDbm} onChange={(event) => patchPreferenceDefaults({ rxSensitivityTargetDbm: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Env loss (dB)</span>
              <input min={0} type="number" value={activeDefaults.environmentLossDb} onChange={(event) => patchPreferenceDefaults({ environmentLossDb: Number(event.target.value) })} />
            </label>
            <label className="field-grid">
              <span>Auto environment defaults</span>
              <input aria-label="Auto environment defaults" checked={activeDefaults.autoPropagationEnvironment} onChange={(event) => patchPreferenceDefaults({ autoPropagationEnvironment: event.target.checked })} type="checkbox" />
            </label>
            <label className="field-grid">
              <span>Radio climate</span>
              <select className="locale-select" value={activeDefaults.propagationEnvironment.radioClimate} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...activeDefaults.propagationEnvironment, radioClimate: event.target.value as SimulationDefaults["propagationEnvironment"]["radioClimate"] } })}>
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
              <input type="number" value={activeDefaults.propagationEnvironment.clutterHeightM} onChange={(event) => patchPreferenceDefaults({ propagationEnvironment: { ...activeDefaults.propagationEnvironment, clutterHeightM: Number(event.target.value) } })} />
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
