// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkProfileEmptyState, profileAntennaSignature } from "./LinkProfileChart";
import type { Site } from "../types/radio";

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

const guidance =
  "Select one Site for Panorama, or select exactly two Sites or choose a saved Path for Path Profile and LOS/Fresnel analysis.";

describe("LinkProfileEmptyState", () => {
  it("keeps a titleless toolbar at the top and supplies guidance for Panorama and Path Profile modes", () => {
    const { container } = render(
      <LinkProfileEmptyState rowControls={<button type="button">Hide Profile</button>} />,
    );

    expect(screen.queryByText("Path Profile")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Profile" })).toBeInTheDocument();
    expect(screen.getByText(guidance)).toHaveClass("chart-panel-empty-message");
    expect(container.querySelector(".chart-panel")).not.toHaveClass("chart-panel-empty");
    expect(screen.queryByRole("button", { name: "Reverse path direction for this view" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full screen" })).not.toBeInTheDocument();
  });

  it("keys profile segment state by both endpoint antenna patterns", () => {
    const endpoint = (id: string): Site => ({
      id,
      name: id,
      position: { lat: 60, lon: 10 },
      groundElevationM: 100,
      antennaHeightM: 10,
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
      antennaMode: "directional",
      antennaAzimuthDeg: 10,
      antennaTiltDeg: 2,
      antennaHorizontalBeamwidthDeg: 60,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });
    const from = endpoint("from");
    const to = endpoint("to");
    const signature = profileAntennaSignature(from, to);

    expect(profileAntennaSignature({ ...from, antennaAzimuthDeg: 20 }, to)).not.toBe(signature);
    expect(profileAntennaSignature(from, { ...to, antennaTiltDeg: 5 })).not.toBe(signature);
  });
});
