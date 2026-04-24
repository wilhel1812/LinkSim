// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mapMock = vi.hoisted(() => ({
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

vi.mock("react-map-gl/maplibre", () => {
  return {
    default: (
      props: {
        children?: React.ReactNode;
        onMove?: (event: { originalEvent?: unknown; viewState: { longitude: number; latitude: number; zoom: number } }) => void;
      },
    ) => {
      mapMock.latestProps = props;
      return <div data-testid="mock-map">{props.children}</div>;
    },
    Layer: () => null,
    Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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

    expect(useAppStore.getState().mapViewport).toMatchObject({
      center: { lat: 60.12345, lon: 11.23456 },
      zoom: 12,
    });

    act(() => {
      mapMock.latestProps?.onMove?.({
        originalEvent: {},
        viewState: { latitude: 61, longitude: 12, zoom: 10 },
      });
      success(position(62, 13, 24, 2));
    });

    expect(useAppStore.getState().mapViewport).toMatchObject({
      center: { lat: 60.12345, lon: 11.23456 },
      zoom: 12,
    });
    expect(screen.getByRole("button", { name: /User location/i })).toHaveTextContent("User Location");
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
