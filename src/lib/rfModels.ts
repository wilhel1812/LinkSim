import type { PropagationModel } from "../types/radio";

export const fsplDb = (distanceKm: number, frequencyMHz: number): number =>
  32.44 + 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMHz);

export const twoRayDb = (
  distanceKm: number,
  frequencyMHz: number,
  txHeightM: number,
  rxHeightM: number,
): number => {
  const dMeters = distanceKm * 1000;
  const wavelengthM = 300 / frequencyMHz;
  const breakpointMeters = (4 * Math.PI * txHeightM * rxHeightM) / wavelengthM;

  if (dMeters <= breakpointMeters) {
    return fsplDb(distanceKm, frequencyMHz);
  }

  return 40 * Math.log10(dMeters) - 20 * Math.log10(txHeightM) - 20 * Math.log10(rxHeightM);
};

// ITM approximation baseline for web-first previews until full Longley-Rice integration is complete.
export const itmApproxDb = (
  distanceKm: number,
  frequencyMHz: number,
  txHeightM: number,
  rxHeightM: number,
): number => {
  const fspl = fsplDb(distanceKm, frequencyMHz);

  const distanceExcess = Math.max(0, 8 * Math.log10(Math.max(distanceKm, 1)));
  const heightRecovery = 3 * Math.log10(Math.max(txHeightM * rxHeightM, 1));
  const frequencyExcess = frequencyMHz > 1000 ? 3 : frequencyMHz < 200 ? -1.5 : 0;

  const medianExcessLoss = Math.max(0, distanceExcess + frequencyExcess - heightRecovery);
  return fspl + medianExcessLoss;
};

export const getPathLossByModel = (
  model: PropagationModel,
  distanceKm: number,
  frequencyMHz: number,
  txHeightM: number,
  rxHeightM: number,
): number => {
  if (model === "TwoRay") return twoRayDb(distanceKm, frequencyMHz, txHeightM, rxHeightM);
  if (model === "ITM") return itmApproxDb(distanceKm, frequencyMHz, txHeightM, rxHeightM);
  return fsplDb(distanceKm, frequencyMHz);
};
