import { describe, expect, it } from "vitest";
import { centerForScaledWindow, centerForScrollLeft, normalizeScrollLeftToMiddleCycle, scrollLeftForCenter } from "./panoramaViewport";

describe("panoramaViewport", () => {
  it("maps center azimuth to scroll left and back", () => {
    const cycle = 1800;
    const viewport = 600;
    const scroll = scrollLeftForCenter(270, cycle, viewport);
    expect(centerForScrollLeft(scroll, cycle, viewport)).toBeCloseTo(270);
  });

  it("normalizes scroll position back into the middle cycle", () => {
    const cycle = 1500;
    expect(normalizeScrollLeftToMiddleCycle(200, cycle)).toBeCloseTo(1700);
    expect(normalizeScrollLeftToMiddleCycle(2500, cycle)).toBeCloseTo(1000);
    expect(normalizeScrollLeftToMiddleCycle(900, cycle)).toBe(900);
  });

  it("keeps pinch focal azimuth stable while scaling span", () => {
    const center = centerForScaledWindow(180, 240, 120, 0.25);
    const focalBefore = 180 + (0.25 - 0.5) * 240;
    const focalAfter = center + (0.25 - 0.5) * 120;
    expect(((focalAfter - focalBefore) % 360 + 360) % 360).toBeCloseTo(0);
  });
});

