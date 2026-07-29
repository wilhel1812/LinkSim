// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mapMock = vi.hoisted(() => {
  const state = {
    layerPresent: false,
    sourcePresent: false,
  };
  const source = {
    setCoordinates: vi.fn(),
  };
  const map = {
    addLayer: vi.fn(() => {
      state.layerPresent = true;
    }),
    addSource: vi.fn(() => {
      state.sourcePresent = true;
    }),
    getLayer: vi.fn(() => (state.layerPresent ? {} : undefined)),
    getSource: vi.fn(() => (state.sourcePresent ? source : undefined)),
    isStyleLoaded: vi.fn(() => true),
    off: vi.fn(),
    on: vi.fn(),
    removeLayer: vi.fn(() => {
      state.layerPresent = false;
    }),
    removeSource: vi.fn(() => {
      state.sourcePresent = false;
    }),
    setPaintProperty: vi.fn(),
  };
  return { map, source, state };
});

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({
    current: {
      getMap: () => mapMock.map,
    },
  }),
}));

import { SimulationLoadingOverlay } from "./SimulationLoadingOverlay";

const bounds = {
  minLat: 59.7,
  maxLat: 60.1,
  minLon: 10.4,
  maxLon: 11.2,
};

describe("SimulationLoadingOverlay", () => {
  const putImageData = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mapMock.state.layerPresent = false;
    mapMock.state.sourcePresent = false;
    Object.values(mapMock.map).forEach((value) => {
      if (typeof value === "function" && "mockClear" in value) {
        value.mockClear();
      }
    });
    mapMock.source.setCoordinates.mockClear();
    putImageData.mockClear();
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        putImageData,
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("crossfades into clouds and keeps them mounted through the exit transition", () => {
    const onCloudReady = vi.fn();
    const onCloudEntered = vi.fn();
    const onCloudExited = vi.fn();
    const { rerender } = render(
      <SimulationLoadingOverlay
        bounds={bounds}
        handoffKey="heatmap"
        loading
        onCloudEntered={onCloudEntered}
        onCloudExited={onCloudExited}
        onCloudReady={onCloudReady}
        pointMask={() => true}
      />,
    );

    expect(mapMock.map.addSource).toHaveBeenCalledTimes(1);
    expect(mapMock.map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        paint: expect.objectContaining({
          "raster-opacity": 0,
        }),
      }),
    );

    act(() => vi.advanceTimersByTime(16));

    expect(onCloudReady).toHaveBeenCalledWith("heatmap");
    expect(mapMock.map.setPaintProperty).toHaveBeenCalledWith(
      "simulation-loading-overlay-layer",
      "raster-opacity-transition",
      { duration: 350 },
    );
    expect(mapMock.map.setPaintProperty).toHaveBeenCalledWith(
      "simulation-loading-overlay-layer",
      "raster-opacity",
      0.68,
    );

    rerender(
      <SimulationLoadingOverlay
        bounds={bounds}
        handoffKey="heatmap"
        loading={false}
        onCloudEntered={onCloudEntered}
        onCloudExited={onCloudExited}
        onCloudReady={onCloudReady}
        pointMask={() => true}
      />,
    );

    expect(onCloudEntered).not.toHaveBeenCalled();
    expect(mapMock.map.setPaintProperty).not.toHaveBeenCalledWith(
      "simulation-loading-overlay-layer",
      "raster-opacity-transition",
      { duration: 500 },
    );

    act(() => vi.advanceTimersByTime(349));
    expect(onCloudEntered).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCloudEntered).toHaveBeenCalledWith("heatmap");
    expect(mapMock.map.setPaintProperty).toHaveBeenCalledWith(
      "simulation-loading-overlay-layer",
      "raster-opacity-transition",
      { duration: 500 },
    );
    expect(mapMock.map.setPaintProperty).toHaveBeenCalledWith(
      "simulation-loading-overlay-layer",
      "raster-opacity",
      0,
    );

    act(() => vi.advanceTimersByTime(499));
    expect(mapMock.map.removeLayer).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mapMock.map.removeLayer).toHaveBeenCalledWith(
      "simulation-loading-overlay-layer",
    );
    expect(mapMock.map.removeSource).toHaveBeenCalledWith(
      "simulation-loading-overlay-source",
    );
    expect(onCloudExited).toHaveBeenCalledWith("heatmap");
  });

  it("renders one static cloud frame for reduced motion", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    render(
      <SimulationLoadingOverlay
        bounds={bounds}
        handoffKey="heatmap"
        loading
        pointMask={() => true}
      />,
    );

    act(() => vi.advanceTimersByTime(16));
    expect(putImageData).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(500));
    expect(putImageData).toHaveBeenCalledTimes(1);
  });

  it("reuses an entered cloud without replaying its 350 ms entrance", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const onCloudEntered = vi.fn();
    const pointMask = () => true;
    const { rerender } = render(
      <SimulationLoadingOverlay
        bounds={bounds}
        handoffKey="relay"
        loading
        onCloudEntered={onCloudEntered}
        pointMask={pointMask}
      />,
    );

    act(() => vi.advanceTimersByTime(16));
    act(() => vi.advanceTimersByTime(350));
    expect(onCloudEntered).toHaveBeenCalledWith("relay");

    rerender(
      <SimulationLoadingOverlay
        bounds={bounds}
        handoffKey="heatmap"
        loading
        onCloudEntered={onCloudEntered}
        pointMask={pointMask}
      />,
    );
    act(() => vi.advanceTimersByTime(16));

    expect(onCloudEntered).toHaveBeenCalledWith("heatmap");
  });
});
