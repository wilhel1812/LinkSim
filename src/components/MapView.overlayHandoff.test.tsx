// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Site } from "../types/radio";

const overlayMock = vi.hoisted(() => {
  const requests: Array<{
    resolve: (value: { width: number; height: number; pixels: Uint8ClampedArray }) => void;
  }> = [];
  return {
    requests,
    buildCoverage: vi.fn(
      () =>
        new Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>((resolve) => {
          requests.push({ resolve });
        }),
    ),
    encodedRasterCount: 0,
  };
});

const loadingOverlayMock = vi.hoisted(() => ({
  props: null as null | {
    handoffKey?: string | null;
    loading?: boolean;
    onCloudEntered?: (requestKey: string) => void;
    onCloudExited?: (requestKey: string) => void;
    onCloudReady?: (requestKey: string) => void;
  },
}));

const layerMock = vi.hoisted(() => ({
  coveragePaint: null as null | Record<string, unknown>,
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

vi.mock("../lib/overlayRaster", () => ({
  buildCoverageOverlayPixelsAsync: overlayMock.buildCoverage,
  buildMeshExtensionOverlayPixelsAsync: vi.fn(),
  buildRelayCandidateOverlayPixelsAsync: vi.fn(),
  buildSourcePassFailOverlayPixelsAsync: vi.fn(),
  buildTerrainShadeOverlayPixelsAsync: vi.fn(async () => null),
  overlayPixelsToDataUrl: vi.fn(() => ({
    coordinates: [
      [10, 61],
      [11, 61],
      [11, 60],
      [10, 60],
    ],
    url: `data:image/mock-${++overlayMock.encodedRasterCount}`,
  })),
  OverlayTaskCancelledError: class OverlayTaskCancelledError extends Error {},
}));

vi.mock("./SimulationLoadingOverlay", () => ({
  SimulationLoadingOverlay: (
    props: NonNullable<typeof loadingOverlayMock.props>,
  ) => {
    loadingOverlayMock.props = props;
    return <div data-testid="simulation-loading-overlay" />;
  },
}));

vi.mock("react-map-gl/maplibre", async () => {
  const ReactMock = await vi.importActual<typeof import("react")>("react");
  return {
    default: ReactMock.forwardRef(
      (
        props: { children?: React.ReactNode },
        ref: React.ForwardedRef<{ easeTo: () => void; queryRenderedFeatures: () => unknown[] }>,
      ) => {
        ReactMock.useImperativeHandle(ref, () => ({
          easeTo: () => undefined,
          queryRenderedFeatures: () => [],
        }));
        return <div>{props.children}</div>;
      },
    ),
    Layer: (props: { id?: string; paint?: Record<string, unknown> }) => {
      if (props.id === "coverage-overlay-layer") {
        layerMock.coveragePaint = props.paint ?? null;
      }
      return null;
    },
    Marker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Source: ({
      children,
      id,
      url,
    }: {
      children?: React.ReactNode;
      id?: string;
      url?: string;
    }) => (
      <div data-source-id={id} data-testid={id} data-url={url}>
        {children}
      </div>
    ),
    useMap: () => ({ current: undefined }),
  };
});

vi.mock("../lib/meshtasticMqtt", () => ({
  fetchMeshmapNodes: vi.fn(async () => ({
    fromCache: false,
    networkError: false,
    nodes: [],
  })),
}));

import { useAppStore } from "../store/appStore";
import { useCoverageStore } from "../store/coverageStore";
import { MapView } from "./MapView";

const recomputeCoverageAction = useCoverageStore.getState().recomputeCoverage;

const site: Site = {
  id: "site-a",
  name: "Site A",
  position: { lat: 60.4, lon: 10.7 },
  groundElevationM: 120,
  antennaHeightM: 8,
  txPowerDbm: 30,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const resolveNextRaster = async () => {
  await waitFor(() => expect(overlayMock.requests.length).toBeGreaterThan(0));
  const request = overlayMock.requests.shift();
  if (!request) throw new Error("Expected a pending overlay raster request");
  await act(async () => {
    request.resolve({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([255, 0, 0, 255]),
    });
  });
};

describe("MapView overlay handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overlayMock.requests.length = 0;
    overlayMock.encodedRasterCount = 0;
    loadingOverlayMock.props = null;
    layerMock.coveragePaint = null;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({})),
    });
    useAppStore.setState({
      sites: [site],
      links: [],
      selectedSiteId: site.id,
      selectedSiteIds: [site.id],
      selectedLinkId: "",
      mapOverlayMode: "heatmap",
      selectedCoverageResolution: "24",
      selectedOverlayRadiusOption: "20",
      srtmTiles: [],
      isTerrainFetching: false,
      isTerrainRecommending: false,
      recommendAndFetchTerrainForCurrentArea: vi.fn(async () => undefined),
    });
    useCoverageStore.setState({
      coverageSamples: [
        {
          lat: site.position.lat,
          lon: site.position.lon,
          valueDbm: -80,
        },
      ],
      isSimulationRecomputing: false,
      autoCalculateEnabled: true,
      calculationCycleSource: null,
      recomputeCoverage: recomputeCoverageAction,
    });
  });

  it("keeps the displayed raster mounted until the replacement cloud is ready", async () => {
    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await resolveNextRaster();
    await waitFor(() => expect(loadingOverlayMock.props?.handoffKey).toBeTruthy());
    const firstKey = loadingOverlayMock.props?.handoffKey;
    expect(firstKey).toBeTruthy();
    act(() => loadingOverlayMock.props?.onCloudReady?.(firstKey!));
    act(() => loadingOverlayMock.props?.onCloudEntered?.(firstKey!));
    await waitFor(() =>
      expect(screen.getByTestId("coverage-overlay-source")).toHaveAttribute(
        "data-url",
        "data:image/mock-1",
      ),
    );
    act(() => loadingOverlayMock.props?.onCloudExited?.(firstKey!));

    act(() => useAppStore.getState().setMapOverlayMode("contours"));
    await waitFor(() => expect(overlayMock.requests.length).toBeGreaterThan(0));

    expect(screen.getByTestId("coverage-overlay-source")).toHaveAttribute(
      "data-url",
      "data:image/mock-1",
    );
    const replacementKey = loadingOverlayMock.props?.handoffKey;
    expect(replacementKey).toBeTruthy();
    expect(replacementKey).not.toBe(firstKey);
    expect(layerMock.coveragePaint?.["raster-opacity"]).toBe(0);

    act(() => loadingOverlayMock.props?.onCloudReady?.(replacementKey!));
    expect(screen.getByTestId("coverage-overlay-source")).toHaveAttribute(
      "data-url",
      "data:image/mock-1",
    );
  });

  it("starts the initial automatic calculation without waiting for interaction", async () => {
    const recomputeCoverage = vi.fn();
    useCoverageStore.setState({
      coverageSamples: [],
      completedCoverageRunToken: "",
      isSimulationRecomputing: false,
      recomputeCoverage,
    });

    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await waitFor(() => expect(recomputeCoverage).toHaveBeenCalledTimes(1));
  });

  it("starts clouds while cold-start terrain loads before Pass/Fail is raster-ready", async () => {
    useAppStore.setState({
      mapOverlayMode: "passfail",
      isTerrainFetching: true,
    });

    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await waitFor(() => expect(loadingOverlayMock.props?.loading).toBe(true));
    expect(loadingOverlayMock.props?.handoffKey).toBeTruthy();
    expect(overlayMock.buildCoverage).not.toHaveBeenCalled();
  });

  it("does not auto-start a manually locked initial calculation", async () => {
    const recomputeCoverage = vi.fn();
    useAppStore.setState({ selectedCoverageResolution: "84" });
    useCoverageStore.setState({
      coverageSamples: [],
      completedCoverageRunToken: "",
      isSimulationRecomputing: false,
      recomputeCoverage,
    });

    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await act(async () => undefined);
    expect(recomputeCoverage).not.toHaveBeenCalled();
  });

  it("does not replay clouds when a completed signature is observed again", async () => {
    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await resolveNextRaster();
    await waitFor(() => expect(loadingOverlayMock.props?.handoffKey).toBeTruthy());
    const requestKey = loadingOverlayMock.props?.handoffKey;
    act(() => loadingOverlayMock.props?.onCloudReady?.(requestKey!));
    act(() => loadingOverlayMock.props?.onCloudEntered?.(requestKey!));
    await waitFor(() =>
      expect(screen.getByTestId("coverage-overlay-source")).toHaveAttribute(
        "data-url",
        "data:image/mock-1",
      ),
    );
    act(() => loadingOverlayMock.props?.onCloudExited?.(requestKey!));
    await waitFor(() => expect(loadingOverlayMock.props?.loading).toBe(false));

    act(() =>
      useCoverageStore.setState({
        calculationCycleSource: "auto",
        completedCoverageRunToken: "repeat-completion",
      }),
    );

    await waitFor(() => expect(loadingOverlayMock.props?.loading).toBe(false));
    expect(overlayMock.buildCoverage).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("coverage-overlay-source")).toHaveAttribute(
      "data-url",
      "data:image/mock-1",
    );
  });

  it("still bridges a deliberate recalculation of the displayed signature", async () => {
    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await resolveNextRaster();
    await waitFor(() => expect(loadingOverlayMock.props?.handoffKey).toBeTruthy());
    const requestKey = loadingOverlayMock.props?.handoffKey;
    act(() => loadingOverlayMock.props?.onCloudReady?.(requestKey!));
    act(() => loadingOverlayMock.props?.onCloudEntered?.(requestKey!));
    await waitFor(() =>
      expect(screen.getByTestId("coverage-overlay-source")).toHaveAttribute(
        "data-url",
        "data:image/mock-1",
      ),
    );
    act(() => loadingOverlayMock.props?.onCloudExited?.(requestKey!));
    await waitFor(() => expect(loadingOverlayMock.props?.loading).toBe(false));

    act(() =>
      useCoverageStore.setState({
        calculationCycleSource: "manual",
        isSimulationRecomputing: true,
      }),
    );
    await waitFor(() => expect(loadingOverlayMock.props?.loading).toBe(true));

    act(() =>
      useCoverageStore.setState({
        completedCoverageRunToken: "manual-repeat",
        isSimulationRecomputing: false,
      }),
    );
    expect(loadingOverlayMock.props?.loading).toBe(true);
    act(() => loadingOverlayMock.props?.onCloudEntered?.(requestKey!));
    await waitFor(() => expect(loadingOverlayMock.props?.loading).toBe(false));
  });
});
