import type { Coordinates, PropagationEnvironment, RadioClimate } from "../types/radio";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const climateDefaults = (
  climate: RadioClimate,
): Pick<PropagationEnvironment, "groundDielectric" | "groundConductivity" | "atmosphericBendingNUnits"> => {
  switch (climate) {
    case "Equatorial":
      return { groundDielectric: 18, groundConductivity: 0.008, atmosphericBendingNUnits: 325 };
    case "Continental Subtropical":
      return { groundDielectric: 15, groundConductivity: 0.006, atmosphericBendingNUnits: 320 };
    case "Maritime Subtropical":
      return { groundDielectric: 25, groundConductivity: 0.02, atmosphericBendingNUnits: 340 };
    case "Desert":
      return { groundDielectric: 9, groundConductivity: 0.0015, atmosphericBendingNUnits: 280 };
    case "Maritime Temperate (Land)":
      return { groundDielectric: 20, groundConductivity: 0.01, atmosphericBendingNUnits: 330 };
    case "Maritime Temperate (Sea)":
      return { groundDielectric: 70, groundConductivity: 3, atmosphericBendingNUnits: 360 };
    case "Continental Temperate":
    default:
      return { groundDielectric: 15, groundConductivity: 0.005, atmosphericBendingNUnits: 301 };
  }
};

export const defaultPropagationEnvironment = (): PropagationEnvironment => ({
  radioClimate: "Continental Temperate",
  polarization: "Vertical",
  clutterHeightM: 10,
  ...climateDefaults("Continental Temperate"),
});

type DeriveEnvironmentInput = {
  from: Coordinates;
  to: Coordinates;
  fromGroundM: number;
  toGroundM: number;
  terrainSampler?: (coordinates: Coordinates) => number | null;
};

export const deriveDynamicPropagationEnvironment = ({
  from,
  to,
  fromGroundM,
  toGroundM,
  terrainSampler,
}: DeriveEnvironmentInput): { environment: PropagationEnvironment; reason: string } => {
  const sampleCount = 24;
  const trace: number[] = [];
  let lowlandCount = 0;
  let seaLevelCount = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
    const p = {
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
    };
    const terrain = terrainSampler?.(p);
    if (terrain === null || terrain === undefined) continue;
    trace.push(terrain);
    if (terrain <= 120) lowlandCount += 1;
    if (terrain <= 20) seaLevelCount += 1;
  }

  const fallbackAvg = (fromGroundM + toGroundM) / 2;
  const minElev = trace.length ? Math.min(...trace) : Math.min(fromGroundM, toGroundM);
  const maxElev = trace.length ? Math.max(...trace) : Math.max(fromGroundM, toGroundM);
  const avgElev = trace.length ? trace.reduce((sum, x) => sum + x, 0) / trace.length : fallbackAvg;
  const relief = maxElev - minElev;
  const lowlandRatio = trace.length ? lowlandCount / trace.length : 0;
  const seaLevelRatio = trace.length ? seaLevelCount / trace.length : 0;

  const likelySea = seaLevelRatio >= 0.45;
  const likelyCoastal = !likelySea && seaLevelRatio >= 0.2;
  const likelyMountain = avgElev >= 700 || relief >= 450 || maxElev >= 1100;
  const likelyHighland = !likelyMountain && (avgElev >= 350 || relief >= 220);

  let climate: RadioClimate = "Continental Temperate";
  let clutterHeightM = 10;
  let reason = "Default inland temperate profile.";

  if (likelySea) {
    climate = "Maritime Temperate (Sea)";
    clutterHeightM = 4;
    reason = "Sea-dominant path inferred from low terrain trace.";
  } else if (likelyCoastal) {
    climate = "Maritime Temperate (Land)";
    clutterHeightM = 8;
    reason = "Coastal path inferred from low-elevation terrain trace.";
  } else if (likelyMountain) {
    climate = "Continental Temperate";
    clutterHeightM = 3;
    reason = "Mountain/high-relief path inferred from terrain elevation and relief.";
  } else if (likelyHighland) {
    climate = "Continental Temperate";
    clutterHeightM = 6;
    reason = "Highland/rolling terrain inferred from elevation profile.";
  } else if (lowlandRatio > 0.6) {
    climate = "Maritime Temperate (Land)";
    clutterHeightM = 12;
    reason = "Lowland path inferred; applying moderate clutter with maritime-temperate land defaults.";
  }

  const base = climateDefaults(climate);
  return {
    environment: {
      radioClimate: climate,
      polarization: "Vertical",
      clutterHeightM: clamp(clutterHeightM, 0, 60),
      groundDielectric: base.groundDielectric,
      groundConductivity: base.groundConductivity,
      atmosphericBendingNUnits: clamp(base.atmosphericBendingNUnits, 250, 400),
    },
    reason,
  };
};

export const withClimateDefaults = (
  current: PropagationEnvironment,
  climate: RadioClimate,
): PropagationEnvironment => {
  const defaults = climateDefaults(climate);
  return {
    ...current,
    radioClimate: climate,
    groundDielectric: defaults.groundDielectric,
    groundConductivity: defaults.groundConductivity,
    atmosphericBendingNUnits: defaults.atmosphericBendingNUnits,
  };
};
