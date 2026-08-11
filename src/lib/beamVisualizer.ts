import type { PassFailState } from "./passFailState";
import { antennaAttenuationDb } from "./antennaPattern";

export type BeamPreviewInput = {
  antennaHeightM: number;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
  antennaMode?: "omnidirectional" | "directional";
  antennaAzimuthDeg?: number;
  antennaTiltDeg?: number;
  antennaHorizontalBeamwidthDeg?: number;
  antennaVerticalBeamwidthDeg?: number;
  antennaMaxAttenuationDb?: number;
};

export type BeamPreviewBand = {
  state: PassFailState;
  label: string;
  radiusPercent: number;
};

export type BeamPreviewMetrics = {
  beamWidthDeg: number;
  verticalBeamWidthDeg: number;
  maxAttenuationDb: number;
  azimuthDeg: number;
  tiltDeg: number;
  residualRangePercent: number;
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
  antennaMode = "omnidirectional",
  antennaAzimuthDeg = 0,
  antennaTiltDeg = 0,
  antennaHorizontalBeamwidthDeg = 60,
  antennaVerticalBeamwidthDeg = 30,
  antennaMaxAttenuationDb = 25,
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
  const azimuthDeg = ((finiteOr(antennaAzimuthDeg, 0) % 360) + 360) % 360;
  const tiltDeg = antennaMode === "directional" ? clamp(finiteOr(antennaTiltDeg, 0), -90, 90) : 0;
  const beamWidthDeg = antennaMode === "directional" ? clamp(finiteOr(antennaHorizontalBeamwidthDeg, 60), 1, 180) : 360;
  const verticalBeamWidthDeg = antennaMode === "directional"
    ? clamp(finiteOr(antennaVerticalBeamwidthDeg, 30), 1, 180)
    : Math.round(clamp(150 - gainSum * 4.2, 32, 150));
  const maxAttenuationDb = antennaMode === "directional" ? clamp(finiteOr(antennaMaxAttenuationDb, 25), 0, 60) : 0;
  const beamSpreadPercent = Math.round(((antennaMode === "directional" ? beamWidthDeg : verticalBeamWidthDeg) / 150) * 100);
  const rearAttenuationDb = antennaMode === "directional"
    ? antennaAttenuationDb(
        {
          antennaMode,
          antennaAzimuthDeg: azimuthDeg,
          antennaTiltDeg: tiltDeg,
          antennaHorizontalBeamwidthDeg: beamWidthDeg,
          antennaVerticalBeamwidthDeg: verticalBeamWidthDeg,
          antennaMaxAttenuationDb: maxAttenuationDb,
        },
        { azimuthDeg: azimuthDeg + 180, elevationDeg: tiltDeg },
      )
    : 0;
  const residualRangePercent = antennaMode === "directional"
    ? Math.max(18, Math.round(100 * 10 ** (-rearAttenuationDb / 20)))
    : 100;
  const rangeLabel =
    rangeScore >= 0.82 ? "Extended" : rangeScore >= 0.62 ? "Long" : rangeScore >= 0.38 ? "Moderate" : "Short";

  return {
    beamWidthDeg,
    verticalBeamWidthDeg,
    maxAttenuationDb,
    azimuthDeg,
    tiltDeg,
    residualRangePercent,
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
