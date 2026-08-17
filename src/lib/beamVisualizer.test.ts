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

  it("restores illustrative omnidirectional side-view narrowing as gain increases", () => {
    const lowGain = computeBeamPreviewMetrics({ ...base, txGainDbi: 1, rxGainDbi: 1 });
    const highGain = computeBeamPreviewMetrics({ ...base, txGainDbi: 9, rxGainDbi: 9 });

    expect(highGain.rangeScore).toBeGreaterThan(lowGain.rangeScore);
    expect(highGain.beamWidthDeg).toBe(lowGain.beamWidthDeg);
    expect(highGain.verticalBeamWidthDeg).toBeLessThan(lowGain.verticalBeamWidthDeg);
  });

  it("uses explicit horizontal and vertical widths for directional antennas", () => {
    const metrics = computeBeamPreviewMetrics({
      ...base,
      antennaMode: "directional",
      antennaAzimuthDeg: 123,
      antennaTiltDeg: -8,
      antennaHorizontalBeamwidthDeg: 70,
      antennaVerticalBeamwidthDeg: 25,
      antennaMaxAttenuationDb: 22,
    });
    expect(metrics.beamWidthDeg).toBe(70);
    expect(metrics.verticalBeamWidthDeg).toBe(25);
    expect(metrics.maxAttenuationDb).toBe(22);
    expect(metrics.azimuthDeg).toBe(123);
    expect(metrics.tiltDeg).toBe(-8);
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
    expect(metrics.beamWidthDeg).toBe(360);
    expect(metrics.bands).toHaveLength(4);
  });
});
