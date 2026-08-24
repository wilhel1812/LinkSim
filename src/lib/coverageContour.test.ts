import { describe, expect, it } from "vitest";
import {
  buildCoverageTargetContourFeatures,
  buildDenseCoverageTargetContourFeatures,
  buildDenseCoverageTargetContourFeaturesAsync,
} from "./coverageContour";
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

  it("keeps contour segments valid when a grid vertex equals the target", () => {
    const contour = buildCoverageTargetContourFeatures(grid([-120, -110, -130, -110]), -120);

    expect(contour.features.length).toBeGreaterThan(0);
    expect(
      contour.features.every((feature) =>
        feature.geometry.coordinates.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))),
    ).toBe(true);
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

describe("buildDenseCoverageTargetContourFeatures", () => {
  it("creates a stitched contour directly from the canonical raster grid", () => {
    const contour = buildDenseCoverageTargetContourFeatures({
      height: 3,
      latByRow: new Float64Array([63.869006376704505, 63.42336981712888, 62.97069520171348]),
      lonByCol: new Float64Array([10, 11, 12]),
      targetDbm: -120,
      valuesDbm: new Float32Array([
        -130, -110, -100,
        -130, -110, -100,
        -130, -110, -100,
      ]),
      width: 3,
    });

    expect(contour.features).toHaveLength(1);
    expect(contour.features[0].geometry.coordinates.length).toBeGreaterThan(3);
    expect(contour.features[0].geometry.coordinates.every(([lon]) => lon === 10.5)).toBe(true);
    const endpointLats = [
      contour.features[0].geometry.coordinates[0][1],
      contour.features[0].geometry.coordinates.at(-1)?.[1] ?? Number.NaN,
    ].sort((left, right) => left - right);
    expect(endpointLats[0]).toBeCloseTo(62.97069520171348, 12);
    expect(endpointLats[1]).toBeCloseTo(63.869006376704505, 12);
  });

  it("returns no line when the dense signal grid never crosses the target", () => {
    const contour = buildDenseCoverageTargetContourFeatures({
      height: 2,
      latByRow: new Float64Array([1, 0]),
      lonByCol: new Float64Array([0, 1]),
      targetDbm: -120,
      valuesDbm: new Float32Array([-110, -109, -108, -107]),
      width: 2,
    });

    expect(contour.features).toHaveLength(0);
  });

  it("clips dense-grid segments through the supplied point mask", () => {
    const contour = buildDenseCoverageTargetContourFeatures({
      height: 2,
      latByRow: new Float64Array([1, 0]),
      lonByCol: new Float64Array([0, 1]),
      pointMask: (lat) => lat <= 0.5,
      targetDbm: -120,
      valuesDbm: new Float32Array([-130, -110, -130, -110]),
      width: 2,
    });

    expect(contour.features).toHaveLength(0);
  });

  it("keeps smoothing a long stitched contour cancellable by point count", async () => {
    const height = 256;
    const latByRow = Float64Array.from({ length: height }, (_, index) => height - index - 1);
    const valuesDbm = new Float32Array(height * 2);
    for (let row = 0; row < height; row += 1) {
      valuesDbm[row * 2] = -130;
      valuesDbm[row * 2 + 1] = -110;
    }
    const cancellation = new Error("cancel-during-smoothing");
    let smoothingTotal = 0;

    const promise = buildDenseCoverageTargetContourFeaturesAsync(
      {
        height,
        latByRow,
        lonByCol: new Float64Array([0, 1]),
        targetDbm: -120,
        valuesDbm,
        width: 2,
      },
      async (total, runner, progressStartPercent) => {
        if (progressStartPercent >= 91) smoothingTotal = total;
        for (let index = 0; index < total; index += 1) {
          if (progressStartPercent >= 91 && index === 10) throw cancellation;
          runner(index);
        }
      },
    );

    await expect(promise).rejects.toBe(cancellation);
    expect(smoothingTotal).toBeGreaterThan(100);
  });
});
