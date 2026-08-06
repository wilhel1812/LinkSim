// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Network, RadioSystem, Site, SrtmTile } from "../types/radio";
import { resolveRequiredOverlayTerrainTileKeys } from "../lib/simulationOverlayRadius";

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
    beforeLayerId?: string;
    handoffKey?: string | null;
    loading?: boolean;
    onCloudEntered?: (requestKey: string) => void;
    onCloudExited?: (requestKey: string) => void;
    onCloudReady?: (requestKey: string) => void;
  },
}));

const layerMock = vi.hoisted(() => ({
  coveragePaint: null as null | Record<string, unknown>,
  props: [] as Array<{ beforeId?: string; id?: string }>,
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
  buildAdaptiveCoverageOverlayPixelsAsync: overlayMock.buildCoverage,
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
    Layer: (props: { beforeId?: string; id?: string; paint?: Record<string, unknown> }) => {
      layerMock.props.push(props);
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

vi.mock("../lib/meshtasticMqtt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/meshtasticMqtt")>()),
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

const system: RadioSystem = {
  id: "system-a",
  name: "System A",
  txPowerDbm: 30,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
  antennaHeightM: 8,
};

const network: Network = {
  id: "network-a",
  name: "Network A",
  frequencyMHz: 869.618,
  bandwidthKhz: 250,
  spreadFactor: 11,
  codingRate: 5,
  memberships: [{ siteId: site.id, systemId: system.id }],
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
    layerMock.props = [];
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({})),
    });
    useAppStore.setState({
      sites: [site],
      systems: [system],
      networks: [network],
      selectedNetworkId: network.id,
      links: [],
      selectedSiteId: site.id,
      selectedSiteIds: [site.id],
      selectedLinkId: "",
      mapOverlayMode: "heatmap",
      selectedCoverageResolution: "24",
      selectedOverlayRadiusOption: "20",
      srtmTiles: [],
      terrainLoadEpoch: 0,
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
    expect(loadingOverlayMock.props?.beforeLayerId).toBe("link-lines-casing");
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
    expect(layerMock.props.find((props) => props.id === "coverage-overlay-layer")?.beforeId).toBe(
      "link-lines-casing",
    );
    expect(
      screen.getByTestId("links").compareDocumentPosition(screen.getByTestId("coverage-overlay-source")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("shows the actual Mesh Extension analysis grid in the existing resolution selector", async () => {
    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector
      />,
    );

    const resolutionSelect = screen.getByLabelText("Simulation Resolution") as HTMLSelectElement;
    const heatmapLabel = resolutionSelect.options[0].textContent ?? "";
    expect(heatmapLabel).toContain("158×158");
    expect(heatmapLabel).toContain("~25k grid points");
    expect(heatmapLabel).not.toContain("samples");

    act(() => useAppStore.getState().setMapOverlayMode("mesh-extension"));
    await waitFor(() => {
      const meshLabel = (screen.getByLabelText("Simulation Resolution") as HTMLSelectElement).options[0].textContent ?? "";
      expect(meshLabel).not.toBe(heatmapLabel);
      expect(meshLabel).toContain("~576 grid points");
    });
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

  it("retries unchanged cold-start terrain geometry after startup cancels its epoch", async () => {
    const recommendAndFetchTerrainForCurrentArea = vi.fn(async () => {
      const currentEpoch = useAppStore.getState().terrainLoadEpoch;
      useAppStore.setState({
        isTerrainFetching: true,
        terrainLoadEpoch: currentEpoch + 1,
      });
    });
    useAppStore.setState({
      isTerrainFetching: false,
      terrainLoadEpoch: 0,
      recommendAndFetchTerrainForCurrentArea,
    });

    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await waitFor(() =>
      expect(recommendAndFetchTerrainForCurrentArea).toHaveBeenCalledTimes(1),
    );
    act(() => {
      useAppStore.setState({
        isTerrainFetching: false,
        terrainLoadEpoch: 2,
      });
    });

    await waitFor(() =>
      expect(recommendAndFetchTerrainForCurrentArea).toHaveBeenCalledTimes(2),
    );
  });

  it("retries only the remaining terrain after a partial load and stops after no progress", async () => {
    const requiredKeys = resolveRequiredOverlayTerrainTileKeys([site], 20);
    expect(requiredKeys.length).toBeGreaterThan(1);
    const tileForKey = (key: string): SrtmTile => ({
      key,
      latStart: 0,
      lonStart: 0,
      size: 2,
      width: 2,
      height: 2,
      arcSecondSpacing: 1,
      elevations: new Int16Array([0, 0, 0, 0]),
      sourceId: "copernicus30",
    });
    const recommendAndFetchTerrainForCurrentArea = vi.fn(async () => {
      const currentEpoch = useAppStore.getState().terrainLoadEpoch;
      useAppStore.setState({
        isTerrainFetching: true,
        terrainLoadEpoch: currentEpoch + 1,
      });
    });
    useAppStore.setState({ recommendAndFetchTerrainForCurrentArea });

    render(
      <MapView
        canPersist
        isMapExpanded={false}
        onToggleMapExpanded={() => undefined}
        showInspector={false}
      />,
    );

    await waitFor(() => expect(recommendAndFetchTerrainForCurrentArea).toHaveBeenCalledTimes(1));
    act(() => {
      useAppStore.setState({
        isTerrainFetching: false,
        srtmTiles: [tileForKey(requiredKeys[0])],
      });
    });
    await waitFor(() => expect(recommendAndFetchTerrainForCurrentArea).toHaveBeenCalledTimes(2));

    act(() => useAppStore.setState({ isTerrainFetching: false }));
    await act(async () => undefined);
    expect(recommendAndFetchTerrainForCurrentArea).toHaveBeenCalledTimes(2);
  });

  it("opts out before an expensive initial automatic calculation starts", async () => {
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
    expect(useCoverageStore.getState().autoCalculateEnabled).toBe(false);
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
