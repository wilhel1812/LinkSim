import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import {
  captureBasemapPaintSnapshot,
  resolveBasemapPaintUpdates,
  tintBasemapPaintValue,
} from "./basemapThemeTint";

describe("basemap theme palette tint", () => {
  it("moves Fiord blue paint to the selected theme hue instead of overlaying it", () => {
    expect(tintBasemapPaintValue("#38435C", "red", "dark")).toMatch(/^hsla\(356(?:\.\d+)?,/);
    expect(tintBasemapPaintValue("hsl(232, 33%, 34%)", "green", "dark")).toMatch(/^hsla\(140(?:\.\d+)?,/);
  });

  it("transforms color strings nested in MapLibre expressions", () => {
    expect(tintBasemapPaintValue(["interpolate", ["linear"], ["zoom"], 0, "#45516E", 12, "#ffffff"], "pink", "dark"))
      .toEqual(["interpolate", ["linear"], ["zoom"], 0, expect.stringMatching(/^hsla\(332(?:\.\d+)?,/), 12, "#ffffff"]);
  });

  it("preserves non-blue semantic colors and desaturates blue for neutral", () => {
    expect(tintBasemapPaintValue("#2ea864", "red", "dark")).toBe("#2ea864");
    expect(tintBasemapPaintValue("#38435C", "neutral", "dark")).toMatch(/^hsla\(210, 11(?:\.\d+)?%,/);
  });

  it("captures only base-map color paint and restores the upstream values when tinting is disabled", () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#45516E" } },
        { id: "roads", type: "line", paint: { "line-color": ["case", true, "#38435C", "#ffffff"], "line-width": 2 } },
        { id: "linksim-links", type: "line", paint: { "line-color": "#00c2ff" } },
      ],
    } as StyleSpecification;

    const snapshot = captureBasemapPaintSnapshot(style);
    expect(snapshot).toHaveLength(2);
    expect(resolveBasemapPaintUpdates(snapshot, false, "red", "dark")).toEqual(snapshot);
    expect(resolveBasemapPaintUpdates(snapshot, true, "red", "dark")[0]?.value).toMatch(/^hsla\(356(?:\.\d+)?,/);
  });
});
