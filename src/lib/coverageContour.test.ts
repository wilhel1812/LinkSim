import { describe, expect, it } from "vitest";
import { buildCoverageTargetContourFeatures } from "./coverageContour";
import type { CoverageSampleLite } from "./overlayRaster";

const grid = (values: number[]): CoverageSampleLite[] => [
  { lat: 0, lon: 0, valueDbm: values[0] },
  { lat: 0, lon: 1, valueDbm: values[1] },
  { lat: 1, lon: 0, valueDbm: values[2] },
  { lat: 1, lon: 1, valueDbm: values[3] },
];

describe("buildCoverageTargetContourFeatures", () => {
  it("returns no line when all samples are below target", () => {
    const contour = buildCoverageTargetContourFeatures(grid([-130, -129, -128, -127]), -120);
    expect(contour.features).toHaveLength(0);
  });

  it("returns no line when all samples are above target", () => {
    const contour = buildCoverageTargetContourFeatures(grid([-110, -109, -108, -107]), -120);
    expect(contour.features).toHaveLength(0);
  });

  it("creates a vertical contour where values cross the target", () => {
    const contour = buildCoverageTargetContourFeatures(grid([-130, -110, -130, -110]), -120);

    expect(contour.features).toHaveLength(1);
    expect(contour.features[0].geometry.coordinates).toEqual([
      [0.5, 0],
      [0.5, 1],
    ]);
  });

  it("stitches adjacent contour segments into a continuous line", () => {
    const samples: CoverageSampleLite[] = [
      { lat: 0, lon: 0, valueDbm: -130 },
      { lat: 0, lon: 1, valueDbm: -110 },
      { lat: 0, lon: 2, valueDbm: -110 },
      { lat: 1, lon: 0, valueDbm: -130 },
      { lat: 1, lon: 1, valueDbm: -110 },
      { lat: 1, lon: 2, valueDbm: -110 },
      { lat: 2, lon: 0, valueDbm: -130 },
      { lat: 2, lon: 1, valueDbm: -110 },
      { lat: 2, lon: 2, valueDbm: -110 },
    ];

    const contour = buildCoverageTargetContourFeatures(samples, -120);

    expect(contour.features).toHaveLength(1);
    expect(contour.features[0].geometry.coordinates.length).toBeGreaterThan(3);
  });

  it("clips segments outside the supplied point mask", () => {
    const contour = buildCoverageTargetContourFeatures(
      grid([-130, -110, -130, -110]),
      -120,
      null,
      (lat) => lat <= 0.5,
    );

    expect(contour.features).toHaveLength(0);
  });
});
