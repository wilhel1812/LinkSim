import { describe, expect, it } from "vitest";
import {
  buildDriftingCloudPixels,
  loadingOverlayCoordinates,
  resolveDriftingCloudPhase,
  resolveLoadingOverlayDimensions,
  resolveSimulationOverlayTransition,
} from "./simulationLoadingOverlay";

const bounds = {
  minLat: 59.7,
  maxLat: 60.1,
  minLon: 10.4,
  maxLon: 11.2,
};

describe("simulation loading overlay", () => {
  it("uses the same geographic corner order as the finished image overlay", () => {
    expect(loadingOverlayCoordinates(bounds)).toEqual([
      [10.4, 60.1],
      [11.2, 60.1],
      [11.2, 59.7],
      [10.4, 59.7],
    ]);
  });

  it("keeps the animated canvas bounded while preserving the geographic aspect ratio", () => {
    expect(resolveLoadingOverlayDimensions(bounds)).toEqual({
      width: 192,
      height: 191,
    });
    expect(
      resolveLoadingOverlayDimensions({
        minLat: 59,
        maxLat: 61,
        minLon: 10,
        maxLon: 10.25,
      }),
    ).toEqual({
      width: 48,
      height: 192,
    });
  });

  it("clips every animated pixel through the finished overlay point mask", () => {
    const pointMask = (lat: number, lon: number) => lat >= 59.85 && lon <= 10.8;
    const frame = buildDriftingCloudPixels({
      bounds,
      width: 8,
      height: 6,
      phase: 0.75,
      pointMask,
    });

    for (let row = 0; row < frame.height; row += 1) {
      for (let column = 0; column < frame.width; column += 1) {
        const offset = (row * frame.width + column) * 4;
        const lat = frame.latByRow[row];
        const lon = frame.lonByColumn[column];
        const alpha = frame.pixels[offset + 3];
        expect(alpha > 0).toBe(pointMask(lat, lon));
      }
    }
  });

  it("freezes the cloud field for reduced motion", () => {
    expect(resolveDriftingCloudPhase(4_250, true)).toBe(0);
    expect(resolveDriftingCloudPhase(0, false)).toBe(0);
    expect(resolveDriftingCloudPhase(2_400, false)).toBeCloseTo(Math.PI * 2);
  });

  it("crossfades the completed overlay fully into and back out of the clouds", () => {
    expect(resolveSimulationOverlayTransition(true)).toEqual({
      coverageOpacity: 0,
      loadingOpacity: 0.68,
      durationMs: 350,
    });
    expect(resolveSimulationOverlayTransition(false)).toEqual({
      coverageOpacity: 0.68,
      loadingOpacity: 0,
      durationMs: 500,
    });
  });
});
