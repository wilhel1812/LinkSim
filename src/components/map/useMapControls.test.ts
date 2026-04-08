import { describe, expect, it } from "vitest";
import { computeNextZoom } from "./useMapControls";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

describe("computeNextZoom", () => {
  it("increments within bounds", () => {
    expect(computeNextZoom(8, 1, 15, clamp)).toBe(9);
  });

  it("clamps to min zoom", () => {
    expect(computeNextZoom(2, -4, 15, clamp)).toBe(2);
  });

  it("clamps to provider max zoom", () => {
    expect(computeNextZoom(14.5, 2, 15, clamp)).toBe(15);
  });
});
