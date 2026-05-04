// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    default: ({ children }: { children?: React.ReactNode }) => <div data-testid="mock-map">{children}</div>,
    Layer: () => null,
    Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Source: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("./UserAdminPanel", () => ({
  UserAdminPanel: () => null,
}));

import { useAppStore } from "../store/appStore";
import { Sidebar } from "./Sidebar";

describe("Sidebar read-only simulation site actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      links: [],
      selectedSiteId: "site-alpha",
      selectedSiteIds: ["site-alpha"],
      selectedLinkId: "",
      siteLibrary: [],
    });
  });

  it("does not expose selected-site editing when the simulation is read-only", () => {
    render(<Sidebar readOnly />);

    const sitesSection = screen.getByText("Sites").closest("section");
    expect(sitesSection).not.toBeNull();
    expect(within(sitesSection as HTMLElement).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(
      within(sitesSection as HTMLElement).getByText(
        "Read-only: you need edit permission to add or edit sites in this simulation.",
      ),
    ).toBeInTheDocument();
  });
});
