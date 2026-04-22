import type { PassFailState } from "./passFailState";

export type BeamPreviewInput = {
  antennaHeightM: number;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
};

export type BeamPreviewBand = {
  state: PassFailState;
  label: string;
  radiusPercent: number;
};

export type BeamPreviewMetrics = {
  beamWidthDeg: number;
  beamSpreadPercent: number;
  rangeScore: number;
  rangeLabel: "Short" | "Moderate" | "Long" | "Extended";
  linkBudgetScoreDb: number;
  bands: BeamPreviewBand[];
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const finiteOr = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);

export const computeBeamPreviewMetrics = ({
  antennaHeightM,
  txPowerDbm,
  txGainDbi,
  rxGainDbi,
  cableLossDb,
}: BeamPreviewInput): BeamPreviewMetrics => {
  const antenna = clamp(finiteOr(antennaHeightM, 2), 0, 80);
  const txPower = clamp(finiteOr(txPowerDbm, 0), 0, 40);
  const txGain = clamp(finiteOr(txGainDbi, 0), 0, 30);
  const rxGain = clamp(finiteOr(rxGainDbi, 0), 0, 30);
  const cableLoss = clamp(finiteOr(cableLossDb, 0), 0, 30);
  const gainSum = txGain + rxGain;
  const linkBudgetScoreDb = txPower + gainSum - cableLoss;

  const powerFactor = clamp((txPower - 10) / 20, 0, 1);
  const gainFactor = clamp((gainSum - 2) / 22, 0, 1);
  const antennaFactor = clamp((antenna - 2) / 28, 0, 1);
  const lossFactor = clamp(cableLoss / 10, 0, 1);
  const rangeScore = clamp(0.26 + powerFactor * 0.34 + gainFactor * 0.32 + antennaFactor * 0.14 - lossFactor * 0.24, 0.16, 0.96);
  const beamWidthDeg = Math.round(clamp(150 - gainSum * 4.2, 32, 150));
  const beamSpreadPercent = Math.round((beamWidthDeg / 150) * 100);
  const rangeLabel =
    rangeScore >= 0.82 ? "Extended" : rangeScore >= 0.62 ? "Long" : rangeScore >= 0.38 ? "Moderate" : "Short";

  return {
    beamWidthDeg,
    beamSpreadPercent,
    rangeScore,
    rangeLabel,
    linkBudgetScoreDb,
    bands: [
      { state: "fail_blocked", label: "Weak edge", radiusPercent: 100 },
      { state: "fail_clear", label: "Marginal", radiusPercent: 78 },
      { state: "pass_blocked", label: "Usable", radiusPercent: 56 },
      { state: "pass_clear", label: "Strong core", radiusPercent: 34 },
    ],
  };
};
