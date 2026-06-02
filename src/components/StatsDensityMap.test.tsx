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
      point: { x: 120, y: 80 },
      features: [
        {
          geometry: { type: "Point", coordinates: [10.5, 60.5] },
          properties: { count: 5, label: "60 degrees N, 10 degrees E" },
        },
      ],
    };
    return (
      <div data-testid="mock-map">
        <button onClick={() => onLoad?.({ target: { fitBounds: mockFitBounds, project: () => ({ x: 120, y: 80 }) } })} type="button">Load map</button>
        <button onClick={() => onMouseMove?.(event)} type="button">Hover bin</button>
        <button onClick={() => onClick?.(event)} type="button">Click bin</button>
        {children}
      </div>
    );
  },
  Layer: () => <div data-testid="mock-layer" />,
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
    const attribution = screen.getByText("CARTO").closest(".stats-map-attribution");
    expect(attribution).toHaveClass("floating-attribution-pill");
    expect(attribution).toHaveTextContent("MapLibre");

    await userEvent.click(screen.getByRole("button", { name: "Hover bin" }));

    const popup = screen.getByText("5 Sites").closest(".stats-map-popup-shell");
    expect(popup).toHaveClass("stats-map-popup-shell");
    expect(popup).toHaveStyle({ left: "120px", top: "80px" });
    expect(screen.getByText("5 Sites").closest(".stats-map-popup")).toHaveClass("ui-surface-pill");
    expect(screen.getByText("5 Sites").closest(".stats-map-popup")).not.toHaveClass("has-pointer-tail");
  });
});
