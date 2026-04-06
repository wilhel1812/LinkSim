import { describe, expect, it } from "vitest";
import { buildProfileChartSvgProps } from "./profileChartSvg";

describe("buildProfileChartSvgProps", () => {
  it("returns explicit width/height to avoid browser default SVG sizing", () => {
    expect(buildProfileChartSvgProps(960, 240)).toEqual({
      width: 960,
      height: 240,
      viewBox: "0 0 960 240",
      preserveAspectRatio: "none",
    });
  });

  it("normalizes non-finite sizes to safe minimums", () => {
    expect(buildProfileChartSvgProps(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      width: 1,
      height: 1,
      viewBox: "0 0 1 1",
      preserveAspectRatio: "none",
    });
  });
});
