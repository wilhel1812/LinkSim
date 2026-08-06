import type { RadioClimate, Polarization, PropagationEnvironment } from "../types/radio";
import type { SimulationDefaults } from "./simulationDefaults";
import { MAX_CUSTOM_RADIO_PRESET_NAME_LENGTH } from "./simulationDefaults";

export const RADIO_PRESET_SHARE_MAX_ENCODED_LENGTH = 8 * 1024;

export type SharedRadioPreset = {
  name: string;
  defaults: SimulationDefaults;
};

export type RadioPresetShareParseResult =
  | { ok: true; preset: SharedRadioPreset }
  | { ok: false; reason: "missing" | "too_large" | "malformed" | "unsupported_version" | "invalid" };

const RADIO_CLIMATES = new Set<RadioClimate>([
  "Equatorial",
  "Continental Subtropical",
  "Maritime Subtropical",
  "Desert",
  "Continental Temperate",
  "Maritime Temperate (Land)",
  "Maritime Temperate (Sea)",
]);
const POLARIZATIONS = new Set<Polarization>(["Vertical", "Horizontal"]);

const requireFinite = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
};

const validateEnvironment = (value: unknown): PropagationEnvironment => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Propagation environment is invalid.");
  const raw = value as Partial<PropagationEnvironment>;
  if (!RADIO_CLIMATES.has(raw.radioClimate as RadioClimate)) throw new Error("Radio climate is invalid.");
  if (!POLARIZATIONS.has(raw.polarization as Polarization)) throw new Error("Polarization is invalid.");
  const clutterHeightM = requireFinite(raw.clutterHeightM, "Clutter height");
  const groundDielectric = requireFinite(raw.groundDielectric, "Ground dielectric");
  const groundConductivity = requireFinite(raw.groundConductivity, "Ground conductivity");
  const atmosphericBendingNUnits = requireFinite(raw.atmosphericBendingNUnits, "Atmospheric bending");
  if (clutterHeightM < 0 || groundDielectric <= 0 || groundConductivity < 0 || atmosphericBendingNUnits <= 0) {
    throw new Error("Propagation environment values are outside the supported range.");
  }
  return {
    radioClimate: raw.radioClimate as RadioClimate,
    polarization: raw.polarization as Polarization,
    clutterHeightM,
    groundDielectric,
    groundConductivity,
    atmosphericBendingNUnits,
  };
};

export const validateSharedRadioPreset = (value: unknown): SharedRadioPreset => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Preset payload is invalid.");
  const raw = value as { name?: unknown; defaults?: unknown };
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > MAX_CUSTOM_RADIO_PRESET_NAME_LENGTH) throw new Error("Preset name must be 1-80 characters.");
  if (!raw.defaults || typeof raw.defaults !== "object" || Array.isArray(raw.defaults)) throw new Error("Preset defaults are invalid.");
  const defaults = raw.defaults as Partial<SimulationDefaults>;
  const frequencyMHz = requireFinite(defaults.frequencyMHz, "Frequency");
  const bandwidthKhz = requireFinite(defaults.bandwidthKhz, "Bandwidth");
  const spreadFactor = requireFinite(defaults.spreadFactor, "Spread factor");
  const codingRate = requireFinite(defaults.codingRate, "Coding rate");
  const rxSensitivityTargetDbm = requireFinite(defaults.rxSensitivityTargetDbm, "RX target");
  const environmentLossDb = requireFinite(defaults.environmentLossDb, "Environment loss");
  if (frequencyMHz <= 0) throw new Error("Frequency must be greater than zero.");
  if (bandwidthKhz <= 0) throw new Error("Bandwidth must be greater than zero.");
  if (!Number.isInteger(spreadFactor) || spreadFactor < 5 || spreadFactor > 12) throw new Error("Spread factor must be an integer from 5 to 12.");
  if (!Number.isInteger(codingRate) || codingRate < 5 || codingRate > 8) throw new Error("Coding rate must be an integer from 5 to 8.");
  if (environmentLossDb < 0) throw new Error("Environment loss cannot be negative.");
  if (typeof defaults.autoPropagationEnvironment !== "boolean") throw new Error("Automatic environment mode must be a boolean.");
  const regionCode = typeof defaults.regionCode === "string" ? defaults.regionCode.trim().slice(0, 32) : undefined;
  return {
    name,
    defaults: {
      // Internal account preset IDs are deliberately excluded from portable links.
      frequencyPresetId: "custom",
      frequencyMHz,
      bandwidthKhz,
      spreadFactor,
      codingRate,
      ...(regionCode ? { regionCode } : {}),
      rxSensitivityTargetDbm,
      environmentLossDb,
      propagationEnvironment: validateEnvironment(defaults.propagationEnvironment),
      autoPropagationEnvironment: defaults.autoPropagationEnvironment,
    },
  };
};

const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

export const buildRadioPresetShareHash = (preset: SharedRadioPreset): string => {
  const validated = validateSharedRadioPreset(preset);
  const encoded = encodeBase64Url(JSON.stringify({ v: 1, ...validated }));
  if (encoded.length > RADIO_PRESET_SHARE_MAX_ENCODED_LENGTH) throw new Error("Preset share payload is too large.");
  return `#preset=${encoded}`;
};

export const buildRadioPresetShareUrl = (preset: SharedRadioPreset, location: Pick<Location, "origin" | "pathname" | "search">): string =>
  `${location.origin}${location.pathname}${location.search}${buildRadioPresetShareHash(preset)}`;

export const parseRadioPresetShareHash = (hash: string): RadioPresetShareParseResult => {
  if (!hash.startsWith("#preset=")) return { ok: false, reason: "missing" };
  const encoded = hash.slice("#preset=".length);
  if (!encoded || encoded.length > RADIO_PRESET_SHARE_MAX_ENCODED_LENGTH) {
    return { ok: false, reason: encoded ? "too_large" : "missing" };
  }
  try {
    const raw = JSON.parse(decodeBase64Url(encoded)) as { v?: unknown };
    if (raw.v !== 1) return { ok: false, reason: "unsupported_version" };
    return { ok: true, preset: validateSharedRadioPreset(raw) };
  } catch {
    return { ok: false, reason: "malformed" };
  }
};
