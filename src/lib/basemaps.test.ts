import { describe, expect, it } from "vitest";
import { getCartoFallbackStyle, resolveBasemapSelection } from "./basemaps";

describe("npolar basemap resolution", () => {
  it.each(["topographic", "satellite", "orthophoto"] as const)(
    "resolves %s preset without fallback",
    (preset) => {
      const result = resolveBasemapSelection("npolar", preset, "light", "blue");
      expect(result.provider).toBe("npolar");
      expect(result.fallbackReason).toBeNull();
      expect(result.presetId).toBe(preset);
    },
  );
});

describe("basemap fallback style", () => {
  it("uses CARTO default Normal themed style when provider fails", () => {
    const expected = resolveBasemapSelection("carto", "normal-themed", "light", "blue").style;
    const fallback = getCartoFallbackStyle("light", "blue");
    expect(fallback).toEqual(expected);
  });

  it("adapts fallback style to dark theme", () => {
    const darkFallback = getCartoFallbackStyle("dark", "blue");
    const darkStyle = darkFallback as { sources?: { cartoRaster?: { tiles?: string[] } } };
    const tiles = darkStyle.sources?.cartoRaster?.tiles ?? [];
    expect(tiles.some((tile) => tile.includes("dark_all"))).toBe(true);
  });
});
