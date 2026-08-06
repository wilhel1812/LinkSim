import { describe, expect, it } from "vitest";
import { buildImportedRadioPresetPreference } from "./radioPresetImport";
import { simulationDefaultsFromPreset, type UserSimulationDefaultsPreference } from "./simulationDefaults";

const defaults = simulationDefaultsFromPreset("mt-eu_868");
const preference: UserSimulationDefaultsPreference = {
  mode: "custom",
  presetId: "mt-eu_868",
  customPresetId: "radio-existing",
  customPresets: [{ id: "radio-existing", name: "Alpine Mesh", defaults: { ...defaults, frequencyPresetId: "radio-existing" } }],
  overridePresetDefaults: false,
};

describe("buildImportedRadioPresetPreference", () => {
  it("imports an independent copy and optionally selects it as default", () => {
    const result = buildImportedRadioPresetPreference({
      preference,
      sharedPreset: { name: "Field Mesh", defaults },
      requestedName: "Field Mesh",
      conflictMode: null,
      makeDefault: true,
      createId: () => "radio-imported",
    });
    expect(result.preference).toMatchObject({ mode: "custom", customPresetId: "radio-imported" });
    expect(result.preference.customPresets).toContainEqual(expect.objectContaining({ id: "radio-imported", name: "Field Mesh" }));
  });

  it("replaces a conflicting preset while preserving its stable id", () => {
    const result = buildImportedRadioPresetPreference({
      preference,
      sharedPreset: { name: "Alpine Mesh", defaults: { ...defaults, frequencyMHz: 869.4 } },
      requestedName: "Alpine Mesh",
      conflictMode: "replace",
      makeDefault: false,
      createId: () => "unused",
    });
    expect(result.importedId).toBe("radio-existing");
    expect(result.preference.customPresets).toHaveLength(1);
    expect(result.preference.customPresets?.[0]?.defaults.frequencyMHz).toBe(869.4);
    expect(result.preference.customPresetId).toBe("radio-existing");
  });

  it("requires an explicit conflict choice and a unique rename", () => {
    expect(() => buildImportedRadioPresetPreference({
      preference,
      sharedPreset: { name: "Alpine Mesh", defaults },
      requestedName: "Alpine Mesh",
      conflictMode: null,
      makeDefault: false,
      createId: () => "new",
    })).toThrow(/choose whether/i);
    expect(() => buildImportedRadioPresetPreference({
      preference,
      sharedPreset: { name: "Alpine Mesh", defaults },
      requestedName: "Alpine Mesh",
      conflictMode: "rename",
      makeDefault: false,
      createId: () => "new",
    })).toThrow(/unique/i);
  });
});
