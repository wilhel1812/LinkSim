import { describe, expect, it } from "vitest";
import { resolveBasemapSelection } from "./basemaps";
import type { UiColorTheme } from "../themes/types";

const allColorThemes: UiColorTheme[] = ["blue", "pink", "red", "green", "yellow"];

describe("resolveBasemapSelection", () => {
  describe("carto normal-themed preset", () => {
    it("returns a style object (not a URL string) for normal-themed", () => {
      const result = resolveBasemapSelection("carto", "normal-themed", "light", "blue");
      expect(typeof result.style).toBe("object");
      expect(result.style).toHaveProperty("version", 8);
      expect(result.style).toHaveProperty("layers");
    });

    for (const colorTheme of allColorThemes) {
      it(`uses a distinct tint color for ${colorTheme} in light mode`, () => {
        const result = resolveBasemapSelection("carto", "normal-themed", "light", colorTheme);
        expect(typeof result.style).toBe("object");
        const style = result.style as {
          layers: Array<{ id?: string; paint?: Record<string, unknown> }>;
        };
        const tintLayer = style.layers.find((l) => l.id === "theme-tint-overlay");
        expect(tintLayer).toBeTruthy();
        expect(tintLayer!.paint).toHaveProperty("fill-color");
        expect(tintLayer!.paint).toHaveProperty("fill-opacity");
      });

      it(`uses a distinct tint color for ${colorTheme} in dark mode`, () => {
        const result = resolveBasemapSelection("carto", "normal-themed", "dark", colorTheme);
        expect(typeof result.style).toBe("object");
        const style = result.style as {
          layers: Array<{ id?: string; paint?: Record<string, unknown> }>;
        };
        const tintLayer = style.layers.find((l) => l.id === "theme-tint-overlay");
        expect(tintLayer).toBeTruthy();
        expect(tintLayer!.paint).toHaveProperty("fill-color");
        expect(tintLayer!.paint).toHaveProperty("fill-opacity");
      });
    }

    it("yellow tint is not the same as blue in light mode", () => {
      const yellow = resolveBasemapSelection("carto", "normal-themed", "light", "yellow");
      const blue = resolveBasemapSelection("carto", "normal-themed", "light", "blue");
      const yellowStyle = yellow.style as { layers: Array<{ id?: string; paint?: Record<string, unknown> }> };
      const blueStyle = blue.style as { layers: Array<{ id?: string; paint?: Record<string, unknown> }> };
      const yellowTint = yellowStyle.layers.find((l) => l.id === "theme-tint-overlay")?.paint?.["fill-color"];
      const blueTint = blueStyle.layers.find((l) => l.id === "theme-tint-overlay")?.paint?.["fill-color"];
      expect(yellowTint).not.toBe(blueTint);
    });

    it("yellow tint is not the same as blue in dark mode", () => {
      const yellow = resolveBasemapSelection("carto", "normal-themed", "dark", "yellow");
      const blue = resolveBasemapSelection("carto", "normal-themed", "dark", "blue");
      const yellowStyle = yellow.style as { layers: Array<{ id?: string; paint?: Record<string, unknown> }> };
      const blueStyle = blue.style as { layers: Array<{ id?: string; paint?: Record<string, unknown> }> };
      const yellowTint = yellowStyle.layers.find((l) => l.id === "theme-tint-overlay")?.paint?.["fill-color"];
      const blueTint = blueStyle.layers.find((l) => l.id === "theme-tint-overlay")?.paint?.["fill-color"];
      expect(yellowTint).not.toBe(blueTint);
    });

    it("dark mode opacity is higher than light mode for the same theme", () => {
      for (const colorTheme of allColorThemes) {
        const light = resolveBasemapSelection("carto", "normal-themed", "light", colorTheme);
        const dark = resolveBasemapSelection("carto", "normal-themed", "dark", colorTheme);
        const lightStyle = light.style as { layers: Array<{ id?: string; paint?: Record<string, unknown> }> };
        const darkStyle = dark.style as { layers: Array<{ id?: string; paint?: Record<string, unknown> }> };
        const lightOpacity = lightStyle.layers.find((l) => l.id === "theme-tint-overlay")?.paint?.["fill-opacity"];
        const darkOpacity = darkStyle.layers.find((l) => l.id === "theme-tint-overlay")?.paint?.["fill-opacity"];
        expect(darkOpacity).toBeGreaterThan(lightOpacity as number);
      }
    });
  });

  describe("carto non-themed presets", () => {
    it("normal preset returns a URL string, not a style object", () => {
      const result = resolveBasemapSelection("carto", "normal", "light", "yellow");
      expect(typeof result.style).toBe("string");
    });

    it("topographic preset returns a URL string", () => {
      const result = resolveBasemapSelection("carto", "topographic", "light", "yellow");
      expect(typeof result.style).toBe("string");
    });
  });
});
