// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mapMock = vi.hoisted(() => ({
  easeTo: vi.fn(),
  markerProps: [] as Array<{ latitude?: number; longitude?: number }>,
  latestProps: null as null | {
    onMove?: (event: { originalEvent?: unknown; viewState: { longitude: number; latitude: number; zoom: number } }) => void;
  },
}));

vi.hoisted(() => {
  const data = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", localStorageMock);
});

vi.mock("react-map-gl/maplibre", async () => {
  const ReactMock = await vi.importActual<typeof import("react")>("react");
  return {
    default: ReactMock.forwardRef((
      props: {
        children?: React.ReactNode;
        onMove?: (event: { originalEvent?: unknown; viewState: { longitude: number; latitude: number; zoom: number } }) => void;
      },
      ref: React.ForwardedRef<{ easeTo: typeof mapMock.easeTo; queryRenderedFeatures: () => unknown[] }>,
    ) => {
      mapMock.latestProps = props;
      ReactMock.useImperativeHandle(ref, () => ({
        easeTo: mapMock.easeTo,
        queryRenderedFeatures: () => [],
      }));
      return <div data-testid="mock-map">{props.children}</div>;
    }),
    Layer: () => null,
    Marker: ({
      children,
      latitude,
      longitude,
    }: {
      children?: React.ReactNode;
      latitude?: number;
      longitude?: number;
    }) => {
      mapMock.markerProps.push({ latitude, longitude });
      return <div>{children}</div>;
    },
    Source: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("../lib/meshtasticMqtt", () => ({
  fetchMeshmapNodes: vi.fn(async () => ({
    fromCache: false,
    networkError: false,
    nodes: [
      {
        nodeId: "mqtt-alpha",
        shortName: "MQA",
        longName: "MQTT Alpha",
        hwModel: "T-Beam",
        lat: 60.55,
        lon: 11.55,
        updatedAt: 1,
      },
    ],
  })),
}));

const watchPosition = vi.fn();
const clearWatch = vi.fn();

const installGeolocation = () => {
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition,
      clearWatch,
    },
  });
};

const position = (latitude: number, longitude: number, accuracy: number, timestamp = 1): GeolocationPosition => ({
  coords: {
    latitude,
    longitude,
    accuracy,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    toJSON: () => ({ latitude, longitude, accuracy }),
  },
  timestamp,
  toJSON: () => ({ coords: { latitude, longitude, accuracy }, timestamp }),
});

import { useAppStore } from "../store/appStore";
import { useCoverageStore } from "../store/coverageStore";
import { MapView } from "./MapView";

const originalCancelTerrainLoad = useAppStore.getState().cancelTerrainLoad;

const renderMapView = (props: Partial<React.ComponentProps<typeof MapView>> = {}) =>
  render(
    <MapView
      canPersist
      isMapExpanded={false}
      onToggleMapExpanded={() => undefined}
      showInspector={false}
      {...props}
    />,
  );

const openVisibleSiteSources = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Simulation/ }));
  return screen.findByRole("dialog", { name: "Visible site sources" });
};

describe("MapView user location flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapMock.latestProps = null;
    mapMock.markerProps = [];
    installGeolocation();
    watchPosition.mockReturnValue(42);
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({})),
    });
    useAppStore.setState({
      cancelTerrainLoad: originalCancelTerrainLoad,
      sites: [],
      links: [],
      selectedSiteId: "",
      selectedSiteIds: [],
      selectedLinkId: "",
      selectedCoverageResolution: "24",
      selectedOverlayRadiusOption: "20",
      mapViewport: { center: { lat: 59.9, lon: 10.75 }, zoom: 8 },
    });
    useCoverageStore.setState({
      coverageSamples: [],
      isSimulationRecomputing: false,
      simulationProgress: 0,
      simulationRunToken: "",
      completedCoverageRunToken: "",
      autoCalculateEnabled: true,
      automaticLockNoticeShown: false,
      calculationCycleSource: null,
    });
  });

  it("switches between automatic, manual start, and manual stop controls", () => {
    const cancelTerrainLoad = vi.fn();
    useAppStore.setState({ cancelTerrainLoad });
    renderMapView({ showInspector: true });

    const autoToggle = screen.getByRole("button", { name: "Turn off automatic calculation" });
    expect(autoToggle).toHaveClass("is-on");
    expect(within(autoToggle).getByText("Auto calculate")).toBeInTheDocument();
    expect(autoToggle.querySelector(".lucide-toggle-right")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start calculation" })).not.toBeInTheDocument();

    fireEvent.click(autoToggle);

    const startButton = screen.getByRole("button", { name: "Start calculation" });
    expect(startButton).toHaveClass("is-start");
    expect(within(startButton).getByText("Start")).toBeInTheDocument();
    expect(startButton.querySelector(".lucide-play")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on automatic calculation" }).querySelector(".lucide-toggle-left")).toBeInTheDocument();

    fireEvent.click(startButton);
    const stopButton = screen.getByRole("button", { name: "Stop calculation" });
    expect(stopButton).toHaveClass("is-stop");
    expect(within(stopButton).getByText("Stop")).toBeInTheDocument();
    expect(stopButton.querySelector(".lucide-square")).toBeInTheDocument();

    fireEvent.click(stopButton);
    expect(screen.getByRole("button", { name: "Start calculation" })).toBeInTheDocument();
    expect(useCoverageStore.getState().autoCalculateEnabled).toBe(false);
    expect(cancelTerrainLoad).toHaveBeenCalledTimes(1);
  });

  it("locks automatic calculation at 4x while preserving manual Start", async () => {
    const onPublishNotice = vi.fn();
    renderMapView({ showInspector: true, onPublishNotice });

    act(() => useAppStore.setState({ selectedCoverageResolution: "84" }));

    const lockedToggle = await screen.findByRole("button", {
      name: "Automatic calculation unavailable at 100 km or 4x and above",
    });
    expect(lockedToggle).toBeDisabled();
    expect(lockedToggle).toHaveClass("is-off");
    expect(screen.getByRole("button", { name: "Start calculation" })).toBeInTheDocument();
    expect(onPublishNotice).toHaveBeenCalledWith({
      id: "automatic-calculation-locked",
      message: "Auto calculate was turned off for 100 km or 4x and above. Press Start to calculate.",
      tone: "info",
      persistent: false,
    });

    act(() => useAppStore.setState({ selectedCoverageResolution: "24" }));
    act(() => useAppStore.setState({ selectedOverlayRadiusOption: "100" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start calculation" })).toBeInTheDocument());
    expect(onPublishNotice).toHaveBeenCalledTimes(1);
  });

  it("starts and stops live geolocation from the map control", () => {
    renderMapView();

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
    expect(screen.getByRole("button", { name: "Use my location" })).toHaveClass("is-selected");

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(screen.queryByRole("button", { name: /User location/i })).not.toBeInTheDocument();
  });

  it("renders the resolved Site icon inside the accessible map marker", () => {
    useAppStore.setState({
      mapOverlayMode: "none",
      sites: [
        {
          id: "site-ship",
          name: "Harbour node",
          position: { lat: 59.9, lon: 10.75 },
          groundElevationM: 2,
          antennaHeightM: 2,
          txPowerDbm: 22,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
          iconKey: "ship",
        },
      ],
    });

    renderMapView();

    const marker = screen.getByRole("button", { name: "Harbour node" });
    expect(marker.querySelector(".lucide-ship")).toBeInTheDocument();
    expect(marker.querySelector(".lucide-ship")).toHaveAttribute("aria-hidden", "true");
  });

  it("centers on the first location update and stops following after user pan", () => {
    renderMapView();
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    const success = watchPosition.mock.calls[0]?.[0] as PositionCallback;

    act(() => {
      success(position(60.12345, 11.23456, 18));
    });

    expect(mapMock.easeTo).toHaveBeenCalledWith({
      center: [11.23456, 60.12345],
      zoom: 12,
      offset: [-25, 0],
      duration: 900,
      essential: true,
    });

    act(() => {
      mapMock.latestProps?.onMove?.({
        originalEvent: {},
        viewState: { latitude: 61, longitude: 12, zoom: 10 },
      });
      success(position(62, 13, 24, 2));
    });

    expect(mapMock.easeTo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /User location/i })).toHaveClass("user-location-marker");
    expect(screen.getByRole("button", { name: /User location/i })).not.toHaveClass("map-site-surface");
  });

  it("turns off fit when location starts and keeps tracking without following after manual fit", () => {
    renderMapView();
    const fitControl = screen.getByRole("button", { name: "Fit map to sites" });
    expect(fitControl).toHaveClass("is-selected");

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(fitControl).not.toHaveClass("is-selected");
    const success = watchPosition.mock.calls[0]?.[0] as PositionCallback;

    act(() => {
      success(position(60.12345, 11.23456, 18));
    });
    expect(mapMock.easeTo).toHaveBeenCalledTimes(1);

    fireEvent.click(fitControl);
    expect(fitControl).toHaveClass("is-selected");

    act(() => {
      success(position(62, 13, 24, 2));
    });

    expect(mapMock.easeTo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /User location/i })).toHaveClass("user-location-marker");
  });

  it("reuses the existing temporary site draft path when the marker is clicked", () => {
    renderMapView();
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    const success = watchPosition.mock.calls[0]?.[0] as PositionCallback;

    act(() => {
      success(position(60.5, 11.5, 12));
    });

    expect(screen.queryByText("New Site")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /User location/i }));

    expect(screen.getByText("New Site")).toBeInTheDocument();
  });

  it("does not create a temporary site from the marker in read-only mode", () => {
    renderMapView({ canPersist: false, readOnly: true });
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    const success = watchPosition.mock.calls[0]?.[0] as PositionCallback;

    act(() => {
      success(position(60.5, 11.5, 12));
    });

    fireEvent.click(screen.getByRole("button", { name: /User location/i }));

    expect(screen.queryByText("New Site")).not.toBeInTheDocument();
  });

  it("opens visible site sources in the shared card popover", async () => {
    renderMapView({ showInspector: true });

    fireEvent.click(screen.getByText("Map"));
    const popover = await openVisibleSiteSources();
    const surface = popover.closest(".ui-surface-pill");

    expect(surface).toHaveClass("is-card");
    expect(surface).toHaveClass("has-pointer-tail");
    expect(surface).toHaveClass("visible-site-sources-popover");
    expect(within(popover).getByLabelText("Library")).not.toBeChecked();
    expect(within(popover).getByLabelText("MQTT")).not.toBeChecked();
  });

  it("keeps Library visible when MQTT is also enabled", async () => {
    useAppStore.setState({
      siteLibrary: [
        {
          id: "lib-alpha",
          name: "Library Alpha",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
    });
    renderMapView({ showInspector: true });

    fireEvent.click(screen.getByText("Map"));
    const popover = await openVisibleSiteSources();
    fireEvent.click(within(popover).getByLabelText("Library"));
    expect(screen.getByRole("button", { name: "Library Alpha" })).toBeInTheDocument();

    fireEvent.click(within(popover).getByLabelText("MQTT"));

    expect(screen.getByRole("button", { name: "Library Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulation + Library + MQTT" })).toBeInTheDocument();
    await waitFor(() => {
      expect(useAppStore.getState().discoveryLibraryVisible).toBe(true);
      expect(useAppStore.getState().discoveryMqttVisible).toBe(true);
    });
  });

  it("clears selected library discovery actions when Library is disabled", async () => {
    useAppStore.setState({
      siteLibrary: [
        {
          id: "lib-alpha",
          name: "Library Alpha",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
    });
    renderMapView({ showInspector: true });

    fireEvent.click(screen.getByText("Map"));
    const popover = await openVisibleSiteSources();
    fireEvent.click(within(popover).getByLabelText("Library"));
    fireEvent.click(screen.getByRole("button", { name: "Library Alpha" }));
    expect(screen.getByRole("button", { name: "Add to Simulation" })).toBeInTheDocument();

    fireEvent.click(within(popover).getByLabelText("Library"));

    expect(screen.queryByRole("button", { name: "Library Alpha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Simulation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulation only" })).toBeInTheDocument();
  });

  it("explains why library sites cannot be added in read-only mode", async () => {
    useAppStore.setState({
      siteLibrary: [
        {
          id: "lib-alpha",
          name: "Library Alpha",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
    });
    renderMapView({ canPersist: false, readOnly: true, showInspector: true });

    fireEvent.click(screen.getByText("Map"));
    const popover = await openVisibleSiteSources();
    fireEvent.click(within(popover).getByLabelText("Library"));
    fireEvent.click(screen.getByRole("button", { name: "Library Alpha" }));

    expect(screen.queryByRole("button", { name: "Add to Simulation" })).not.toBeInTheDocument();
    expect(screen.getByText("Read-only: you need edit permission to add sites to this simulation.")).toBeInTheDocument();
  });

  it("shows private library sites that are already accessible", async () => {
    useAppStore.setState({
      siteLibrary: [
        {
          id: "lib-private",
          name: "Private Hill",
          visibility: "private",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
    });
    renderMapView({ showInspector: true });

    fireEvent.click(screen.getByText("Map"));
    const popover = await openVisibleSiteSources();
    fireEvent.click(within(popover).getByLabelText("Library"));

    expect(screen.getByRole("button", { name: "Private Hill" })).toBeInTheDocument();
  });

  it("explains why selected simulation sites cannot be edited in read-only mode", () => {
    useAppStore.setState({
      sites: [
        {
          id: "site-alpha",
          name: "Site Alpha",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
      selectedSiteId: "site-alpha",
      selectedSiteIds: ["site-alpha"],
      mapOverlayMode: "none",
    });
    renderMapView({ canPersist: false, readOnly: true, showInspector: true });

    expect(
      screen.getByText("Read-only: you need edit permission to move or edit sites in this simulation."),
    ).toBeInTheDocument();
  });

  it("uses the existing simulation marker as the editor marker when editing its library site", () => {
    useAppStore.setState({
      sites: [
        {
          id: "site-alpha",
          name: "Alpha Site",
          libraryEntryId: "lib-alpha",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
      selectedSiteId: "site-alpha",
      selectedSiteIds: ["site-alpha"],
      mapEditor: {
        kind: "site",
        resourceId: "lib-alpha",
        isNew: false,
        label: "Alpha Site",
        anchorRect: { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 },
      },
      mapEditorSiteDraft: { lat: 61.25, lon: 12.75, groundElevationM: 130 },
    });

    renderMapView();

    expect(screen.getAllByRole("button", { name: "Alpha Site" })).toHaveLength(1);
    expect(mapMock.markerProps).toEqual(
      expect.arrayContaining([expect.objectContaining({ latitude: 61.25, longitude: 12.75 })]),
    );
  });

  it("publishes plain location failure notifications", () => {
    const onPublishNotice = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
    renderMapView({ onPublishNotice });

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(onPublishNotice).toHaveBeenCalledWith({
      id: "user-location",
      message: "Your browser does not support location services.",
      tone: "error",
      persistent: false,
    });

    installGeolocation();
    watchPosition.mockImplementationOnce((_success, error) => {
      error({
        code: 1,
        message: "User denied Geolocation",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
      return 7;
    });

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(onPublishNotice).toHaveBeenLastCalledWith({
      id: "user-location",
      message: "Location permission was denied.",
      tone: "error",
      persistent: false,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[user-location] geolocation watch failed",
      expect.objectContaining({ code: 1 }),
    );
  });
});
