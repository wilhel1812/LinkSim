// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mapMock = vi.hoisted(() => ({
  getLayer: vi.fn((id: string) => id === "background" || id === "water"),
  getStyle: vi.fn(() => ({
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#45516E" } },
      { id: "water", type: "fill", paint: { "fill-color": "#38435C" } },
      { id: "linksim-links", type: "line", paint: { "line-color": "#00c2ff" } },
    ],
  })),
  isStyleLoaded: vi.fn(() => true),
  listeners: new Map<string, () => void>(),
  off: vi.fn((event: string) => mapMock.listeners.delete(event)),
  on: vi.fn((event: string, listener: () => void) => mapMock.listeners.set(event, listener)),
  setPaintProperty: vi.fn(),
}));

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: { getMap: () => mapMock } }),
}));

import { BasemapThemeTint } from "./BasemapThemeTint";

describe("BasemapThemeTint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapMock.listeners.clear();
  });

  it("retints upstream base layers, excludes LinkSim overlays, and restores originals", () => {
    const view = render(<BasemapThemeTint colorTheme="red" enabled theme="dark" />);

    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("water", "fill-color", expect.stringMatching(/^hsla\(356(?:\.\d+)?,/));
    expect(mapMock.setPaintProperty).not.toHaveBeenCalledWith("linksim-links", "line-color", expect.anything());

    mapMock.setPaintProperty.mockClear();
    view.rerender(<BasemapThemeTint colorTheme="red" enabled={false} theme="dark" />);
    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("background", "background-color", "#45516E");
    expect(mapMock.setPaintProperty).toHaveBeenCalledWith("water", "fill-color", "#38435C");
  });
});
