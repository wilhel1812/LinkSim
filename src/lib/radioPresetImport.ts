import {
  MAX_CUSTOM_RADIO_PRESETS,
  normalizeCustomRadioPresetName,
  normalizeUserSimulationDefaultsPreference,
  type UserSimulationDefaultsPreference,
} from "./simulationDefaults";
import type { SharedRadioPreset } from "./radioPresetShare";

export type RadioPresetImportConflictMode = "replace" | "rename" | null;

export const findRadioPresetImportConflict = (
  preference: UserSimulationDefaultsPreference,
  sharedPresetName: string,
) => preference.customPresets?.find(
  (preset) => preset.name.toLocaleLowerCase() === sharedPresetName.trim().toLocaleLowerCase(),
);

export const buildImportedRadioPresetPreference = (input: {
  preference: UserSimulationDefaultsPreference;
  sharedPreset: SharedRadioPreset;
  requestedName: string;
  conflictMode: RadioPresetImportConflictMode;
  makeDefault: boolean;
  createId: () => string;
}): { preference: UserSimulationDefaultsPreference; importedName: string; importedId: string } => {
  const preference = normalizeUserSimulationDefaultsPreference(input.preference);
  const customPresets = preference.customPresets ?? [];
  const requestedName = normalizeCustomRadioPresetName(input.requestedName);
  if (!requestedName) throw new Error("Enter a preset name.");

  const conflict = findRadioPresetImportConflict(preference, input.sharedPreset.name);
  if (conflict && !input.conflictMode) {
    throw new Error("Choose whether to replace the existing preset or save with a new name.");
  }
  const replacing = Boolean(conflict && input.conflictMode === "replace");
  const nameCollision = customPresets.find(
    (preset) => preset.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase() && preset.id !== conflict?.id,
  );
  if (!replacing && (nameCollision || requestedName.toLocaleLowerCase() === conflict?.name.toLocaleLowerCase())) {
    throw new Error("Choose a unique preset name.");
  }
  if (!replacing && customPresets.length >= MAX_CUSTOM_RADIO_PRESETS) {
    throw new Error(`You can save up to ${MAX_CUSTOM_RADIO_PRESETS} custom presets.`);
  }

  const importedId = replacing ? conflict!.id : input.createId();
  const importedName = replacing ? conflict!.name : requestedName;
  const imported = {
    id: importedId,
    name: importedName,
    defaults: { ...input.sharedPreset.defaults, frequencyPresetId: importedId },
  };
  const nextCustomPresets = replacing
    ? customPresets.map((preset) => preset.id === importedId ? imported : preset)
    : [...customPresets, imported];

  return {
    importedId,
    importedName,
    preference: normalizeUserSimulationDefaultsPreference({
      ...preference,
      ...(input.makeDefault
        ? { mode: "custom" as const, customPresetId: importedId, overridePresetDefaults: false }
        : {}),
      customPresets: nextCustomPresets,
    }),
  };
};
