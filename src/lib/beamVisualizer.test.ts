import { describe, expect, it } from "vitest";
import { computeBeamPreviewMetrics } from "./beamVisualizer";

const base = {
  antennaHeightM: 2,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

describe("computeBeamPreviewMetrics", () => {
  it("increases relative range when tx power increases", () => {
    const low = computeBeamPreviewMetrics({ ...base, txPowerDbm: 12 });
    const high = computeBeamPreviewMetrics({ ...base, txPowerDbm: 28 });

    expect(high.rangeScore).toBeGreaterThan(low.rangeScore);
  });

  it("decreases relative range when cable loss increases", () => {
    const lowLoss = computeBeamPreviewMetrics({ ...base, cableLossDb: 0.5 });
    const highLoss = computeBeamPreviewMetrics({ ...base, cableLossDb: 8 });

    expect(highLoss.rangeScore).toBeLessThan(lowLoss.rangeScore);
  });

  it("narrows beam width and increases range when gain increases", () => {
    const lowGain = computeBeamPreviewMetrics({ ...base, txGainDbi: 1, rxGainDbi: 1 });
    const highGain = computeBeamPreviewMetrics({ ...base, txGainDbi: 9, rxGainDbi: 9 });

    expect(highGain.rangeScore).toBeGreaterThan(lowGain.rangeScore);
    expect(highGain.beamWidthDeg).toBeLessThan(lowGain.beamWidthDeg);
  });

  it("modestly increases relative range when antenna height increases", () => {
    const low = computeBeamPreviewMetrics({ ...base, antennaHeightM: 2 });
    const high = computeBeamPreviewMetrics({ ...base, antennaHeightM: 24 });

    expect(high.rangeScore).toBeGreaterThan(low.rangeScore);
    expect(high.rangeScore - low.rangeScore).toBeLessThan(0.2);
  });

  it("clamps invalid and extreme values to stable display bounds", () => {
    const metrics = computeBeamPreviewMetrics({
      antennaHeightM: Number.NaN,
      txPowerDbm: Infinity,
      txGainDbi: 999,
      rxGainDbi: -999,
      cableLossDb: 999,
    });

    expect(metrics.rangeScore).toBeGreaterThanOrEqual(0.16);
    expect(metrics.rangeScore).toBeLessThanOrEqual(0.96);
    expect(metrics.beamWidthDeg).toBeGreaterThanOrEqual(32);
    expect(metrics.beamWidthDeg).toBeLessThanOrEqual(150);
    expect(metrics.bands).toHaveLength(4);
  });
});
