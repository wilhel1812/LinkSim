// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mapMock = vi.hoisted(() => {
  const createStyle = () => ({
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#45516E" } },
      { id: "water", type: "fill", paint: { "fill-color": "#38435C" } },
      { id: "linksim-links", type: "line", paint: { "line-color": "#00c2ff" } },
    ],
  });
  const state = { style: createStyle() };
  return {
    getLayer: vi.fn((id: string) => id === "background" || id === "water"),
    getStyle: vi.fn(() => state.style),
    isStyleLoaded: vi.fn(() => true),
    listeners: new Map<string, () => void>(),
    off: vi.fn((event: string) => mapMock.listeners.delete(event)),
    on: vi.fn((event: string, listener: () => void) => mapMock.listeners.set(event, listener)),
    resetStyle: () => { state.style = createStyle(); },
    setPaintProperty: vi.fn((layerId: string, property: string, value: unknown) => {
      const layer = state.style.layers.find((candidate) => candidate.id === layerId);
      if (layer) (layer.paint as Record<string, unknown>)[property] = value;
    }),
  };
});

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: { getMap: () => mapMock } }),
}));

import { BasemapThemeTint } from "./BasemapThemeTint";

describe("BasemapThemeTint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapMock.listeners.clear();
    mapMock.resetStyle();
  });

  it("preserves provider originals through StrictMode replay, retints later themes, and restores originals", () => {
    const view = render(<StrictMode><BasemapThemeTint colorTheme="red" enabled theme="dark" /></StrictMode>);

    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("water", "fill-color", expect.stringMatching(/^hsla\(356(?:\.\d+)?,/));
    expect(mapMock.setPaintProperty).not.toHaveBeenCalledWith("linksim-links", "line-color", expect.anything());

    mapMock.setPaintProperty.mockClear();
    view.rerender(<StrictMode><BasemapThemeTint colorTheme="green" enabled theme="dark" /></StrictMode>);
    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("water", "fill-color", expect.stringMatching(/^hsla\(140(?:\.\d+)?,/));

    mapMock.setPaintProperty.mockClear();
    view.rerender(<StrictMode><BasemapThemeTint colorTheme="green" enabled={false} theme="dark" /></StrictMode>);
    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("background", "background-color", "#45516E");
    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("water", "fill-color", "#38435C");
  });
});
