import { describe, expect, it } from "vitest";
import { buildProfileChartSvgProps } from "./profileChartSvg";

describe("buildProfileChartSvgProps", () => {
  it("returns explicit width/height in fixed pixel coordinates", () => {
    expect(buildProfileChartSvgProps(960, 240)).toEqual({
      width: 960,
      height: 240,
    });
  });

  it("normalizes non-finite sizes to safe minimums", () => {
    expect(buildProfileChartSvgProps(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      width: 1,
      height: 1,
    });
  });
});
