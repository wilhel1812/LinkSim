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

export type CustomRadioPreset = {
  id: string;
  name: string;
  defaults: SimulationDefaults;
};

export const MAX_CUSTOM_RADIO_PRESETS = 50;
export const MAX_CUSTOM_RADIO_PRESET_NAME_LENGTH = 80;
export const LEGACY_CUSTOM_RADIO_PRESET_ID = "radio-legacy-custom";

export type UserSimulationDefaultsPreference = {
  mode: "preset" | "custom";
  presetId: string;
  customPresetId?: string;
  customPresets?: CustomRadioPreset[];
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
      rxSensitivityTargetDbm: -130,
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

const normalizeCustomRadioPresetId = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 120) : "";

export const normalizeCustomRadioPresetName = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, MAX_CUSTOM_RADIO_PRESET_NAME_LENGTH) : "";

export const findCustomRadioPreset = (
  preference: UserSimulationDefaultsPreference | null | undefined,
  id: string | null | undefined,
): CustomRadioPreset | undefined =>
  preference?.customPresets?.find((preset) => preset.id === id);

export const normalizeUserSimulationDefaultsPreference = (
  value?: UserSimulationDefaultsPreference | null,
  legacyPresetId?: string | null,
): UserSimulationDefaultsPreference => {
  const raw = value ?? {
    mode: "preset" as const,
    presetId: legacyPresetId ?? FALLBACK_SIMULATION_PRESET_ID,
    overridePresetDefaults: false,
  };
  const presetId = findPresetById(raw.presetId)
    ? raw.presetId
    : findPresetById(legacyPresetId ?? "")
      ? String(legacyPresetId)
      : FALLBACK_SIMULATION_PRESET_ID;
  const customPresets: CustomRadioPreset[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  const addPreset = (candidate: unknown, preserveDefaultsPresetId = false) => {
    if (customPresets.length >= MAX_CUSTOM_RADIO_PRESETS) return;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const rawCandidate = candidate as Partial<CustomRadioPreset>;
    const id = normalizeCustomRadioPresetId(rawCandidate.id);
    const name = normalizeCustomRadioPresetName(rawCandidate.name);
    const nameKey = name.toLocaleLowerCase();
    if (!id || !name || ids.has(id) || names.has(nameKey) || !rawCandidate.defaults) return;
    const normalizedDefaults = normalizeSimulationDefaults(rawCandidate.defaults);
    ids.add(id);
    names.add(nameKey);
    customPresets.push({
      id,
      name,
      defaults: {
        ...normalizedDefaults,
        frequencyPresetId: preserveDefaultsPresetId
          ? normalizedDefaults.frequencyPresetId
          : id,
      },
    });
  };

  if (Array.isArray(raw.customPresets)) {
    for (const candidate of raw.customPresets) addPreset(candidate);
  }
  if (raw.mode === "custom" && raw.custom && !customPresets.length) {
    addPreset({
      id: LEGACY_CUSTOM_RADIO_PRESET_ID,
      name: "My custom preset",
      defaults: normalizeSimulationDefaults(raw.custom, simulationDefaultsFromPreset(presetId)),
    }, true);
  }

  const requestedCustomId = normalizeCustomRadioPresetId(raw.customPresetId);
  const selectedCustom = customPresets.find((preset) => preset.id === requestedCustomId)
    ?? (raw.mode === "custom" ? customPresets[0] : undefined);

  return {
    mode: raw.mode === "custom" && selectedCustom ? "custom" : "preset",
    presetId,
    ...(selectedCustom ? { customPresetId: selectedCustom.id } : {}),
    ...(customPresets.length ? { customPresets } : {}),
    overridePresetDefaults: Boolean(raw.overridePresetDefaults),
    ...(raw.overrides ? { overrides: normalizeSimulationDefaults(raw.overrides, simulationDefaultsFromPreset(presetId)) } : {}),
  };
};

export const resolveUserSimulationDefaults = (
  preference?: UserSimulationDefaultsPreference | null,
  legacyPresetId?: string | null,
): SimulationDefaults => {
  const normalizedPreference = normalizeUserSimulationDefaultsPreference(preference, legacyPresetId);
  const presetId = normalizedPreference.presetId || legacyPresetId || FALLBACK_SIMULATION_PRESET_ID;
  const presetDefaults = simulationDefaultsFromPreset(presetId);
  if (normalizedPreference.mode === "custom") {
    const customPreset = findCustomRadioPreset(normalizedPreference, normalizedPreference.customPresetId);
    if (customPreset) {
      return customPreset.id === LEGACY_CUSTOM_RADIO_PRESET_ID
        ? customPreset.defaults
        : { ...customPreset.defaults, frequencyPresetId: customPreset.id };
    }
  }
  return normalizedPreference.overridePresetDefaults
    ? mergeDefaults(presetDefaults, normalizedPreference.overrides)
    : presetDefaults;
};

export const normalizeSimulationDefaults = (
  value: Partial<SimulationDefaults> | undefined | null,
  base = simulationDefaultsFromPreset(FALLBACK_SIMULATION_PRESET_ID),
): SimulationDefaults => mergeDefaults(base, value ?? undefined);
