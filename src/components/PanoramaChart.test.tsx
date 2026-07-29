// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { Profiler, StrictMode, type ProfilerOnRenderCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  buildPanorama: vi.fn(),
  schedulers: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  store: {
    sites: [
      {
        id: "site-1",
        name: "Test site",
        position: { lat: 59.91, lon: 10.75 },
        groundElevationM: 100,
        antennaHeightM: 10,
        txPowerDbm: 20,
        txGainDbi: 2,
        rxGainDbi: 2,
        cableLossDb: 1,
      },
    ],
    links: [],
    selectedSiteIds: ["site-1"],
    selectedNetworkId: "network-1",
    networks: [
      {
        id: "network-1",
        name: "Test network",
        frequencyMHz: 868,
      },
    ],
    srtmTiles: [],
    propagationEnvironment: {
      atmosphericBendingNUnits: 301,
      clutterHeightM: 0,
    },
    rxSensitivityTargetDbm: -120,
    environmentLossDb: 0,
    siteDragPreview: {},
    siteLibrary: [],
    discoveryLibraryVisible: false,
    discoveryMqttVisible: false,
    mapDiscoveryMqttNodes: [],
    terrainLoadEpoch: 1,
  },
}));

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  });
});

vi.mock("../store/appStore", () => ({
  useAppStore: (selector: (state: typeof testState.store) => unknown) => selector(testState.store),
}));

vi.mock("../hooks/useThemeVariant", () => ({
  useThemeVariant: () => ({ theme: "light" }),
}));

vi.mock("../lib/panoramaPeaks", () => ({
  loadPanoramaPeaks: vi.fn(async () => []),
}));

vi.mock("../lib/panorama", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/panorama")>();
  return {
    ...actual,
    buildPanorama: testState.buildPanorama,
  };
});

vi.mock("../lib/latestOnlyTaskScheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/latestOnlyTaskScheduler")>();
  return {
    ...actual,
    createLatestOnlyTaskScheduler: () => {
      const scheduler = actual.createLatestOnlyTaskScheduler();
      const tracked = {
        ...scheduler,
        dispose: vi.fn(scheduler.dispose),
      };
      testState.schedulers.push(tracked);
      return tracked;
    },
  };
});

import { PanoramaChart } from "./PanoramaChart";

const panoramaResult = (detail: boolean) => ({
  rays: [
    {
      azimuthDeg: detail ? 170 : 0,
      maxDistanceKm: 50,
      horizonDistanceKm: 10,
      horizonLat: 59.92,
      horizonLon: 10.75,
      horizonTerrainM: 120,
      horizonAngleDeg: 1,
      clutterHorizonDistanceKm: 10,
      clutterHorizonAngleDeg: 1,
      samples: [
        {
          distanceKm: 1,
          lat: 59.911,
          lon: 10.75,
          terrainM: 105,
          angleDeg: 0.5,
          maxAngleBeforeDeg: 0,
        },
        {
          distanceKm: 10,
          lat: 59.92,
          lon: 10.75,
          terrainM: 120,
          angleDeg: 1,
          maxAngleBeforeDeg: 0.5,
        },
      ],
    },
    {
      azimuthDeg: detail ? 190 : 359,
      maxDistanceKm: 50,
      horizonDistanceKm: 11,
      horizonLat: 59.92,
      horizonLon: 10.76,
      horizonTerrainM: 125,
      horizonAngleDeg: 1.1,
      clutterHorizonDistanceKm: 11,
      clutterHorizonAngleDeg: 1.1,
      samples: [
        {
          distanceKm: 1,
          lat: 59.911,
          lon: 10.751,
          terrainM: 106,
          angleDeg: 0.6,
          maxAngleBeforeDeg: 0,
        },
        {
          distanceKm: 11,
          lat: 59.92,
          lon: 10.76,
          terrainM: 125,
          angleDeg: 1.1,
          maxAngleBeforeDeg: 0.6,
        },
      ],
    },
  ],
  nodes: [],
  minAngleDeg: 0,
  maxAngleDeg: 2,
  radiusPolicyKm: 50,
  coverageCenterDeg: detail ? 180 : 0,
  coverageSpanDeg: detail ? 90 : 360,
});

const renderChart = (wrapper?: "strict", onRender?: ProfilerOnRenderCallback) => {
  const chart = (
    <Profiler id="panorama" onRender={onRender ?? (() => undefined)}>
      <PanoramaChart isExpanded={false} onToggleExpanded={() => undefined} />
    </Profiler>
  );
  return render(wrapper === "strict" ? <StrictMode>{chart}</StrictMode> : chart);
};

describe("PanoramaChart scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.schedulers.length = 0;
    testState.buildPanorama.mockImplementation((input) =>
      panoramaResult(input.options.windowCenterDeg != null),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 300,
      top: 0,
      right: 800,
      bottom: 300,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const context = new Proxy(
      {},
      {
        get: () => vi.fn(),
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders async base/detail results immediately without changing panorama controls", async () => {
    renderChart();

    expect(await screen.findByRole("img", { name: "Panorama" })).toBeInTheDocument();
    expect(testState.buildPanorama).toHaveBeenCalledTimes(2);
  });

  it("settles after the base/detail cache is populated instead of repeatedly rendering", async () => {
    let renderCount = 0;
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => Math.min(++now, 20));

    renderChart(undefined, () => {
      renderCount += 1;
    });

    expect(await screen.findByRole("img", { name: "Panorama" })).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testState.buildPanorama).toHaveBeenCalledTimes(2);
    expect(renderCount).toBeLessThanOrEqual(6);
  });

  it("reuses cached panorama results without rebuilding or entering another render cycle", async () => {
    let renderCount = 0;
    const view = renderChart(undefined, () => {
      renderCount += 1;
    });
    expect(await screen.findByRole("img", { name: "Panorama" })).toBeInTheDocument();

    testState.store.links = [];
    view.rerender(
      <Profiler id="panorama" onRender={() => {
        renderCount += 1;
      }}>
        <PanoramaChart isExpanded={false} onToggleExpanded={() => undefined} />
      </Profiler>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testState.buildPanorama).toHaveBeenCalledTimes(2);
    expect(renderCount).toBeLessThanOrEqual(8);
  });

  it("recreates disposed schedulers during StrictMode replay and still renders", async () => {
    renderChart("strict");

    expect(await screen.findByRole("img", { name: "Panorama" })).toBeInTheDocument();
    expect(testState.schedulers.some((scheduler) => scheduler.dispose.mock.calls.length > 0)).toBe(true);
  });

  it("disposes both live schedulers on unmount", async () => {
    const view = renderChart();
    expect(await screen.findByRole("img", { name: "Panorama" })).toBeInTheDocument();

    view.unmount();

    expect(testState.schedulers).toHaveLength(2);
    expect(testState.schedulers.every((scheduler) => scheduler.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("does not publish work that is canceled before the scheduler starts it", async () => {
    const view = renderChart();
    view.unmount();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testState.buildPanorama).not.toHaveBeenCalled();
    expect(testState.schedulers.every((scheduler) => scheduler.dispose.mock.calls.length === 1)).toBe(true);
  });
});
