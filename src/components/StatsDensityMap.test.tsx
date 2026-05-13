// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mockFitBounds = vi.fn();

vi.mock("react-map-gl/maplibre", () => ({
  default: ({
    children,
    onClick,
    onLoad,
    onMouseMove,
  }: {
    children: ReactNode;
    onClick?: (event: unknown) => void;
    onLoad?: (event: unknown) => void;
    onMouseMove?: (event: unknown) => void;
  }) => {
    const event = {
      features: [
        {
          geometry: { type: "Point", coordinates: [10.5, 60.5] },
          properties: { count: 5, label: "60 degrees N, 10 degrees E" },
        },
      ],
    };
    return (
      <div data-testid="mock-map">
        <button onClick={() => onLoad?.({ target: { fitBounds: mockFitBounds } })} type="button">Load map</button>
        <button onClick={() => onMouseMove?.(event)} type="button">Hover bin</button>
        <button onClick={() => onClick?.(event)} type="button">Click bin</button>
        {children}
      </div>
    );
  },
  Layer: () => <div data-testid="mock-layer" />,
  Popup: ({ children, className, latitude, longitude }: { children: ReactNode; className?: string; latitude: number; longitude: number }) => (
    <div className={className} data-latitude={latitude} data-longitude={longitude} data-testid="mock-popup">
      {children}
    </div>
  ),
  Source: ({ children }: { children: ReactNode }) => <div data-testid="mock-source">{children}</div>,
}));

import { StatsDensityMap } from "./StatsDensityMap";

describe("StatsDensityMap", () => {
  it("uses centered controls and a shared surface hover popup anchored to the bin center", async () => {
    render(
      <StatsDensityMap
        accentColor="var(--accent)"
        bins={[{ latBand: 60, lonBand: 10, count: 5 }]}
        surfaceColor="var(--surface)"
        theme="light"
      />,
    );

    expect(screen.getByLabelText("Zoom out Site density map").closest(".stats-map-controls")).toHaveClass("map-controls");
    expect(screen.getByText("CARTO").closest(".stats-map-attribution")).toHaveClass("floating-attribution-pill");

    await userEvent.click(screen.getByRole("button", { name: "Hover bin" }));

    const popup = screen.getByTestId("mock-popup");
    expect(popup).toHaveClass("stats-map-popup-shell");
    expect(popup).toHaveAttribute("data-longitude", "10.5");
    expect(popup).toHaveAttribute("data-latitude", "60.5");
    expect(screen.getByText("5 Sites").closest(".stats-map-popup")).toHaveClass("ui-surface-pill", "has-pointer-tail");
  });
});
