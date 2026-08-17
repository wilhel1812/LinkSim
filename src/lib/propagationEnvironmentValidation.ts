import type { Polarization, PropagationEnvironment, RadioClimate } from "../types/radio";

const RADIO_CLIMATES = new Set<RadioClimate>([
  "Equatorial", "Continental Subtropical", "Maritime Subtropical", "Desert",
  "Continental Temperate", "Maritime Temperate (Land)", "Maritime Temperate (Sea)",
]);
const POLARIZATIONS = new Set<Polarization>(["Vertical", "Horizontal"]);

const requireFinite = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
};

export const validatePropagationEnvironment = (value: unknown): PropagationEnvironment => {
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
    clutterHeightM, groundDielectric, groundConductivity, atmosphericBendingNUnits,
  };
};
