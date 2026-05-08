import { describe, expect, it } from "vitest";
import { FREQUENCY_PRESETS, findPresetById } from "./frequencyPlans";

describe("frequency presets", () => {
  it("defines complete simulation defaults for every preset", () => {
    for (const preset of FREQUENCY_PRESETS) {
      expect(Number.isFinite(preset.rxSensitivityTargetDbm)).toBe(true);
      expect(Number.isFinite(preset.environmentLossDb)).toBe(true);
      expect(typeof preset.autoPropagationEnvironment).toBe("boolean");
      expect(preset.propagationEnvironment.radioClimate).toBeTruthy();
      expect(preset.propagationEnvironment.polarization).toBeTruthy();
      expect(Number.isFinite(preset.propagationEnvironment.clutterHeightM)).toBe(true);
      expect(Number.isFinite(preset.propagationEnvironment.groundDielectric)).toBe(true);
      expect(Number.isFinite(preset.propagationEnvironment.groundConductivity)).toBe(true);
      expect(Number.isFinite(preset.propagationEnvironment.atmosphericBendingNUnits)).toBe(true);
    }
  });

  it("uses -130 dBm RX target for Oslo Local", () => {
    expect(findPresetById("oslo-local-869618")?.rxSensitivityTargetDbm).toBe(-130);
  });
});
