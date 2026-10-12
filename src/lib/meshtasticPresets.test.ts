import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FREQUENCY_PRESETS, findPresetById, type FrequencyPreset } from "./frequencyPlans";
import { defaultScenario, DEMO_SCENARIO } from "./scenarios";
import { FALLBACK_SIMULATION_PRESET_ID, resolveUserSimulationDefaults, simulationDefaultsFromPreset } from "./simulationDefaults";

type RadioFixture = Pick<FrequencyPreset, "id" | "frequencyMHz" | "bandwidthKhz" | "spreadFactor" | "codingRate" | "regionCode">;
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/meshtastic-2.8.1.json", import.meta.url), "utf8")) as {
  presets: Array<RadioFixture & { channel: number }>;
  legacy: Array<RadioFixture & Pick<FrequencyPreset, "label" | "rxSensitivityTargetDbm">>;
};
const narrowFast = { frequencyPresetId: "mt-eu_n_868-narrow-fast", frequencyMHz: 869.44165, bandwidthKhz: 62.5, spreadFactor: 7, codingRate: 6, regionCode: "EU_N_868", rxSensitivityTargetDbm: -130 };

describe("pinned Meshtastic 2.8.1 presets", () => {
  it.each(fixture.presets)("matches firmware region, radio parameters and canonical slot for $id", ({ channel, ...expected }) => {
    const preset = findPresetById(expected.id);
    expect(preset).toMatchObject(expected);
    expect(preset?.notes).toContain(`Channel ${channel}`);
    expect(preset?.group).toBe(expected.regionCode?.startsWith("ITU") ? "Amateur / Reference" : "Meshtastic Regional");
  });
  it("covers the complete supported matrix with unique additive IDs", () => {
    const added = FREQUENCY_PRESETS.filter(({ id }) => /^mt-.+-(long|medium|short|lite|narrow|tiny)-/.test(id));
    expect(added).toHaveLength(265);
    expect(new Set(added.map(({ regionCode }) => regionCode)).size).toBe(34);
    expect(new Set(FREQUENCY_PRESETS.map(({ id }) => id)).size).toBe(FREQUENCY_PRESETS.length);
    expect(added.some(({ regionCode }) => regionCode === "UNSET")).toBe(false);
  });
  it("retains every legacy preset ID, label and radio/planning value", () => {
    for (const old of fixture.legacy) expect(findPresetById(old.id)).toMatchObject(old);
  });
  it("uses NarrowFast consistently for default and invalid-preset fallback while retaining the planning target", () => {
    expect(FALLBACK_SIMULATION_PRESET_ID).toBe(narrowFast.frequencyPresetId);
    expect(resolveUserSimulationDefaults()).toMatchObject(narrowFast);
    expect(simulationDefaultsFromPreset("not-a-preset")).toMatchObject(narrowFast);
    expect(resolveUserSimulationDefaults({ mode: "preset", presetId: "invalid", overridePresetDefaults: false })).toMatchObject(narrowFast);
  });
  it("preserves an explicitly selected Oslo default", () => {
    expect(resolveUserSimulationDefaults(undefined, "oslo-local-869618")).toMatchObject({ frequencyPresetId: "oslo-local-869618", frequencyMHz: 869.618, bandwidthKhz: 62, spreadFactor: 8, codingRate: 5, rxSensitivityTargetDbm: -130 });
  });
  it.each([defaultScenario, DEMO_SCENARIO])("aligns fresh $name radio settings with the default preset", (scenario) => {
    expect(scenario.defaultFrequencyPresetId).toBe(narrowFast.frequencyPresetId);
    for (const network of scenario.networks) expect(network).toMatchObject({ frequencyMHz: narrowFast.frequencyMHz, frequencyOverrideMHz: narrowFast.frequencyMHz, bandwidthKhz: 62.5, spreadFactor: 7, codingRate: 6, regionCode: "EU_N_868" });
    for (const link of scenario.links) expect(link.frequencyMHz).toBe(narrowFast.frequencyMHz);
  });
});
