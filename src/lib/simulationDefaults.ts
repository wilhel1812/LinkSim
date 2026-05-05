import { defaultPropagationEnvironment } from "./propagationEnvironment";
import { findPresetById } from "./frequencyPlans";
import type { PropagationEnvironment } from "../types/radio";

export type SimulationDefaults = {
  frequencyPresetId: string;
  frequencyMHz: number;
  bandwidthKhz: number;
  spreadFactor: number;
  codingRate: number;
  regionCode?: string;
  rxSensitivityTargetDbm: number;
  environmentLossDb: number;
  propagationEnvironment: PropagationEnvironment;
  autoPropagationEnvironment: boolean;
};

export type UserSimulationDefaultsPreference = {
  mode: "preset" | "custom";
  presetId: string;
  overridePresetDefaults: boolean;
  overrides?: Partial<SimulationDefaults>;
  custom?: Partial<SimulationDefaults>;
};

export const FALLBACK_SIMULATION_PRESET_ID = "oslo-local-869618";

export const simulationDefaultsFromPreset = (presetId: string): SimulationDefaults => {
  const preset = findPresetById(presetId) ?? findPresetById(FALLBACK_SIMULATION_PRESET_ID);
  if (!preset) {
    return {
      frequencyPresetId: FALLBACK_SIMULATION_PRESET_ID,
      frequencyMHz: 869.618,
      bandwidthKhz: 62,
      spreadFactor: 8,
      codingRate: 5,
      regionCode: "EU_868",
      rxSensitivityTargetDbm: -120,
      environmentLossDb: 0,
      propagationEnvironment: defaultPropagationEnvironment(),
      autoPropagationEnvironment: true,
    };
  }
  return {
    frequencyPresetId: preset.id,
    frequencyMHz: preset.frequencyMHz,
    bandwidthKhz: preset.bandwidthKhz,
    spreadFactor: preset.spreadFactor,
    codingRate: preset.codingRate,
    regionCode: preset.regionCode,
    rxSensitivityTargetDbm: preset.rxSensitivityTargetDbm,
    environmentLossDb: preset.environmentLossDb,
    propagationEnvironment: preset.propagationEnvironment,
    autoPropagationEnvironment: preset.autoPropagationEnvironment,
  };
};

const cleanNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const mergeDefaults = (base: SimulationDefaults, patch?: Partial<SimulationDefaults>): SimulationDefaults => ({
  ...base,
  ...patch,
  frequencyPresetId: typeof patch?.frequencyPresetId === "string" ? patch.frequencyPresetId : base.frequencyPresetId,
  frequencyMHz: cleanNumber(patch?.frequencyMHz, base.frequencyMHz),
  bandwidthKhz: cleanNumber(patch?.bandwidthKhz, base.bandwidthKhz),
  spreadFactor: cleanNumber(patch?.spreadFactor, base.spreadFactor),
  codingRate: cleanNumber(patch?.codingRate, base.codingRate),
  rxSensitivityTargetDbm: cleanNumber(patch?.rxSensitivityTargetDbm, base.rxSensitivityTargetDbm),
  environmentLossDb: Math.max(0, cleanNumber(patch?.environmentLossDb, base.environmentLossDb)),
  propagationEnvironment: {
    ...base.propagationEnvironment,
    ...(patch?.propagationEnvironment ?? {}),
  },
  autoPropagationEnvironment:
    typeof patch?.autoPropagationEnvironment === "boolean"
      ? patch.autoPropagationEnvironment
      : base.autoPropagationEnvironment,
});

export const resolveUserSimulationDefaults = (
  preference?: UserSimulationDefaultsPreference | null,
  legacyPresetId?: string | null,
): SimulationDefaults => {
  const presetId = preference?.presetId || legacyPresetId || FALLBACK_SIMULATION_PRESET_ID;
  const presetDefaults = simulationDefaultsFromPreset(presetId);
  if (preference?.mode === "custom") {
    return mergeDefaults(presetDefaults, preference.custom);
  }
  return preference?.overridePresetDefaults ? mergeDefaults(presetDefaults, preference.overrides) : presetDefaults;
};

export const normalizeSimulationDefaults = (
  value: Partial<SimulationDefaults> | undefined | null,
  base = simulationDefaultsFromPreset(FALLBACK_SIMULATION_PRESET_ID),
): SimulationDefaults => mergeDefaults(base, value ?? undefined);
