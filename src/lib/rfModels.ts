import type { PropagationEnvironment } from "../types/radio";

export const fsplDb = (distanceKm: number, frequencyMHz: number): number =>
  32.44 + 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMHz);

// ITM approximation baseline for web-first previews until full Longley-Rice integration is complete.
export const itmApproxDb = (
  distanceKm: number,
  frequencyMHz: number,
  txHeightM: number,
  rxHeightM: number,
  environment?: PropagationEnvironment,
): number => {
  const fspl = fsplDb(distanceKm, frequencyMHz);

  const distanceExcess = Math.max(0, 8 * Math.log10(Math.max(distanceKm, 1)));
  const heightRecovery = 3 * Math.log10(Math.max(txHeightM * rxHeightM, 1));
  const frequencyExcess = frequencyMHz > 1000 ? 3 : frequencyMHz < 200 ? -1.5 : 0;

  const climateAdjustment = (() => {
    switch (environment?.radioClimate) {
      case "Desert":
        return 1.6;
      case "Maritime Temperate (Sea)":
        return -2.4;
      case "Maritime Temperate (Land)":
      case "Maritime Subtropical":
        return -1.2;
      case "Equatorial":
        return -0.8;
      default:
        return 0;
    }
  })();
  const groundAdjustment = (() => {
    if (!environment) return 0;
    const dielectricAdj = (15 - environment.groundDielectric) * 0.08;
    const conductivityAdj = (0.005 - environment.groundConductivity) * 120;
    return Math.max(-2.5, Math.min(3.5, dielectricAdj + conductivityAdj));
  })();
  const polarizationAdjustment = environment?.polarization === "Horizontal" ? 0.7 : 0;
  const medianExcessLoss = Math.max(
    0,
    distanceExcess +
      frequencyExcess -
      heightRecovery +
      climateAdjustment +
      groundAdjustment +
      polarizationAdjustment,
  );
  return fspl + medianExcessLoss;
};

export const getPathLossDb = (
  distanceKm: number,
  frequencyMHz: number,
  txHeightM: number,
  rxHeightM: number,
  environment?: PropagationEnvironment,
): number => itmApproxDb(distanceKm, frequencyMHz, txHeightM, rxHeightM, environment);
