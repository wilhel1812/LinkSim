import { describe, expect, it } from "vitest";
import {
  cardinalLabelForAzimuth,
  chartXNormToAzimuthDeg,
  formatAzimuthTick,
  fovScaleToSpanDeg,
  normalizeFovScale,
  resolvePanoramaWindow,
  unwrapAzimuthForWindow,
} from "./panoramaView";

describe("panoramaView", () => {
  it("formats cardinal directions at exact compass quadrants", () => {
    expect(cardinalLabelForAzimuth(0)).toBe("N");
    expect(cardinalLabelForAzimuth(90)).toBe("E");
    expect(cardinalLabelForAzimuth(180)).toBe("S");
    expect(cardinalLabelForAzimuth(270)).toBe("W");
    expect(formatAzimuthTick(360)).toBe("N");
    expect(formatAzimuthTick(120)).toBe("120°");
  });

  it("resolves a centered 90 degree window for hover zoom", () => {
    const window = resolvePanoramaWindow(12, 90);
    expect(window.centerDeg).toBe(12);
    expect(window.startDeg).toBeCloseTo(-33);
    expect(window.endDeg).toBeCloseTo(57);
  });

  it("maps FOV scale to panorama span", () => {
    expect(normalizeFovScale(0.3)).toBe(1);
    expect(normalizeFovScale(5)).toBe(4);
    expect(fovScaleToSpanDeg(1)).toBe(360);
    expect(fovScaleToSpanDeg(4)).toBe(90);
    expect(fovScaleToSpanDeg(1.5)).toBeCloseTo(240);
  });

  it("maps chart x ratio directly to azimuth domain", () => {
    expect(chartXNormToAzimuthDeg(0)).toBe(0);
    expect(chartXNormToAzimuthDeg(0.5)).toBe(180);
    expect(chartXNormToAzimuthDeg(1)).toBe(360);
    expect(chartXNormToAzimuthDeg(-1)).toBe(0);
    expect(chartXNormToAzimuthDeg(2)).toBe(360);
  });

  it("unwraps azimuth around 360 boundaries against a local reference", () => {
    expect(unwrapAzimuthForWindow(355, 2)).toBeCloseTo(-5);
    expect(unwrapAzimuthForWindow(5, 358)).toBeCloseTo(365);
    expect(unwrapAzimuthForWindow(40, 80)).toBe(40);
  });
});
