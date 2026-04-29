// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { MapView } from "./MapView";

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
      sites: [],
      links: [],
      selectedSiteId: "",
      selectedSiteIds: [],
      selectedLinkId: "",
      mapViewport: { center: { lat: 59.9, lon: 10.75 }, zoom: 8 },
    });
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

  it("explains why library sites cannot be added in read-only mode", () => {
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
    fireEvent.change(screen.getByLabelText("Visible Sites"), { target: { value: "library" } });
    fireEvent.click(screen.getByRole("button", { name: "Library Alpha" }));

    expect(screen.queryByRole("button", { name: "Add to Simulation" })).not.toBeInTheDocument();
    expect(screen.getByText("Read-only: you need edit permission to add sites to this simulation.")).toBeInTheDocument();
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
