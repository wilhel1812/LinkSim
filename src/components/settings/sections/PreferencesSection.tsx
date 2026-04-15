import { useCallback, useState } from "react";
import { updateMyProfile, type CloudUser } from "../../../lib/cloudUser";
import { FREQUENCY_PRESETS, frequencyPresetGroups } from "../../../lib/frequencyPlans";
import { getUiErrorMessage } from "../../../lib/uiError";
import { useAppStore } from "../../../store/appStore";
import { useThemeVariant } from "../../../hooks/useThemeVariant";
import type { UiColorTheme } from "../../../themes/types";
import { AutoSaveField } from "../AutoSaveField";
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

  const canModerate = Boolean(me?.isAdmin || me?.isModerator);
  const canEditAccessRequestNote = Boolean(canModerate || !me?.isApproved);
  const showAccessRequestNoteField = Boolean(canModerate || !me?.isApproved);

  const savePreset = useCallback(
    async (value: string | null) => {
      setPresetState({ state: "saving", error: null });
      try {
        const updated = await updateMyProfile({ defaultFrequencyPresetId: value });
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

  const saveNote = useCallback(
    async (value: string) => {
      const updated = await updateMyProfile({ accessRequestNote: value });
      onMeUpdated(updated);
      setCurrentUser(updated);
      setAuthState("signed_in");
    },
    [onMeUpdated, setAuthState, setCurrentUser],
  );

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
              Default preset for new simulations{" "}
              <InfoTip text="This cloud setting applies when you create a new simulation. Existing simulations keep their own saved channel settings." />
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
            value={me?.defaultFrequencyPresetId ?? ""}
            onChange={(event) => {
              const next = event.target.value ? event.target.value : null;
              void savePreset(next);
            }}
          >
            <option value="">App default (Oslo Local 869.618)</option>
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

        {showAccessRequestNoteField ? (
          <AutoSaveField
            as="textarea"
            id="pref-access-request-note"
            label="Access request note"
            value={me?.accessRequestNote ?? ""}
            onSave={saveNote}
            textareaProps={{
              maxLength: 1200,
              rows: 5,
              readOnly: !canEditAccessRequestNote,
              disabled: !canEditAccessRequestNote,
              placeholder: canEditAccessRequestNote
                ? "Optional private note to moderators/admins."
                : "Request note is locked after approval.",
            }}
            help={
              canEditAccessRequestNote
                ? "Visible to moderators and admins. Up to 1200 characters."
                : "Request note is locked after approval."
            }
          />
        ) : null}
      </div>
    </section>
  );
}
