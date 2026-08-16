import { describe, expect, it } from "vitest";
import {
  LEGACY_CUSTOM_RADIO_PRESET_ID,
  MAX_CUSTOM_RADIO_PRESETS,
  normalizeUserSimulationDefaultsPreference,
  resolveUserSimulationDefaults,
  simulationDefaultsFromPreset,
} from "./simulationDefaults";

describe("custom radio presets", () => {
  it("migrates the legacy unnamed custom defaults without changing values", () => {
    const legacy = {
      mode: "custom" as const,
      presetId: "mt-us",
      overridePresetDefaults: false,
      custom: { ...simulationDefaultsFromPreset("mt-us"), frequencyMHz: 906.875, rxSensitivityTargetDbm: -126 },
    };
    const normalized = normalizeUserSimulationDefaultsPreference(legacy);
    expect(normalized.customPresetId).toBe(LEGACY_CUSTOM_RADIO_PRESET_ID);
    expect(normalized.customPresets).toHaveLength(1);
    expect(normalized.customPresets?.[0]).toMatchObject({
      id: LEGACY_CUSTOM_RADIO_PRESET_ID,
      name: "My custom preset",
      defaults: { frequencyMHz: 906.875, rxSensitivityTargetDbm: -126 },
    });
    expect(resolveUserSimulationDefaults(normalized).frequencyMHz).toBe(906.875);
  });

  it("resolves a selected named preset and keeps its stable id", () => {
    const base = simulationDefaultsFromPreset("mt-eu_868");
    const preference = normalizeUserSimulationDefaultsPreference({
      mode: "custom",
      presetId: "mt-eu_868",
      customPresetId: "radio-alpine",
      customPresets: [{ id: "radio-alpine", name: "Alpine Mesh", defaults: { ...base, frequencyMHz: 869.4 } }],
      overridePresetDefaults: false,
    });
    expect(resolveUserSimulationDefaults(preference)).toMatchObject({
      frequencyPresetId: "radio-alpine",
      frequencyMHz: 869.4,
    });
  });

  it("deduplicates names and caps the normalized collection", () => {
    const base = simulationDefaultsFromPreset("mt-us");
    const customPresets = Array.from({ length: MAX_CUSTOM_RADIO_PRESETS + 5 }, (_, index) => ({
      id: `radio-${index}`,
      name: index === 1 ? " mesh 0 " : `Mesh ${index}`,
      defaults: base,
    }));
    const normalized = normalizeUserSimulationDefaultsPreference({
      mode: "preset",
      presetId: "mt-us",
      overridePresetDefaults: false,
      customPresets,
    });
    expect(normalized.customPresets).toHaveLength(MAX_CUSTOM_RADIO_PRESETS);
    expect(normalized.customPresets?.filter((preset) => preset.name.toLowerCase() === "mesh 0")).toHaveLength(1);
  });

  it("ignores malformed collection entries during server-safe normalization", () => {
    const malformed = {
      mode: "custom",
      presetId: "mt-us",
      overridePresetDefaults: false,
      customPresetId: "valid",
      customPresets: [null, "bad", { id: "valid", name: "Valid", defaults: simulationDefaultsFromPreset("mt-us") }],
    } as unknown as Parameters<typeof normalizeUserSimulationDefaultsPreference>[0];
    const normalized = normalizeUserSimulationDefaultsPreference(malformed);
    expect(normalized.customPresets).toHaveLength(1);
    expect(normalized.customPresetId).toBe("valid");
  });

  it("drops a custom preset with an unsupported propagation environment", () => {
    const defaults = simulationDefaultsFromPreset("mt-us");
    const normalized = normalizeUserSimulationDefaultsPreference({
      mode: "custom",
      presetId: "mt-us",
      overridePresetDefaults: false,
      customPresetId: "invalid-environment",
      customPresets: [{
        id: "invalid-environment",
        name: "Invalid environment",
        defaults: {
          ...defaults,
          propagationEnvironment: {
            ...defaults.propagationEnvironment,
            radioClimate: "Martian" as never,
          },
        },
      }],
    });

    expect(normalized.mode).toBe("preset");
    expect(normalized.customPresets).toBeUndefined();
  });

  it("drops invalid legacy custom defaults without throwing", () => {
    const defaults = simulationDefaultsFromPreset("mt-us");
    const normalized = normalizeUserSimulationDefaultsPreference({
      mode: "custom",
      presetId: "mt-us",
      overridePresetDefaults: false,
      custom: {
        ...defaults,
        propagationEnvironment: {
          ...defaults.propagationEnvironment,
          radioClimate: "Martian" as never,
        },
      },
    });

    expect(normalized).toMatchObject({
      mode: "preset",
      presetId: "mt-us",
      overridePresetDefaults: false,
    });
    expect(normalized.customPresets).toBeUndefined();
  });

  it("drops invalid legacy preset overrides without throwing", () => {
    const defaults = simulationDefaultsFromPreset("mt-us");
    const normalized = normalizeUserSimulationDefaultsPreference({
      mode: "preset",
      presetId: "mt-us",
      overridePresetDefaults: true,
      overrides: {
        propagationEnvironment: {
          ...defaults.propagationEnvironment,
          radioClimate: "Martian" as never,
        },
      },
    });

    expect(normalized).toMatchObject({
      mode: "preset",
      presetId: "mt-us",
      overridePresetDefaults: false,
    });
    expect(normalized.overrides).toBeUndefined();
  });
});
