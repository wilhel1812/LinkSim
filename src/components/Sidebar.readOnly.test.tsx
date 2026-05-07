// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    default: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="mock-map">{children}</div>
    ),
    Layer: () => null,
    Marker: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
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
        {
          id: "site-beta",
          name: "Site Beta",
          position: { lat: 60.6, lon: 11.6 },
          groundElevationM: 130,
          antennaHeightM: 4,
          txPowerDbm: 21,
          txGainDbi: 3,
          rxGainDbi: 3,
          cableLossDb: 1,
        },
      ],
      links: [
        {
          id: "link-alpha",
          name: "Alpha Link",
          fromSiteId: "site-alpha",
          toSiteId: "site-beta",
          frequencyMHz: 868,
        },
      ],
      selectedSiteId: "site-alpha",
      selectedSiteIds: ["site-alpha"],
      selectedLinkId: "",
      siteLibrary: [],
    });
  });

  it("replaces read-only row edit buttons with view details actions", async () => {
    render(<Sidebar readOnly />);

    const sitesSection = screen.getByText("Sites").closest("section");
    expect(sitesSection).not.toBeNull();
    expect(
      within(sitesSection as HTMLElement).queryByRole("button", {
        name: "Edit site",
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(sitesSection as HTMLElement).getAllByRole("button", {
        name: /View site details/,
      })[0],
    );

    expect(useAppStore.getState().mapEditor).toMatchObject({
      kind: "site",
      resourceId: "site-alpha",
      isNew: false,
      label: "Site Alpha",
    });

    const linksSection = screen.getByText("Links").closest("section");
    expect(linksSection).not.toBeNull();
    expect(
      within(linksSection as HTMLElement).queryByRole("button", {
        name: "Edit link",
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(linksSection as HTMLElement).getByRole("button", {
        name: /View link details/,
      }),
    );

    expect(useAppStore.getState().mapEditor).toMatchObject({
      kind: "link",
      resourceId: "link-alpha",
      isNew: false,
      label: "Alpha Link",
    });
  });

  it("does not expose selected-site editing when the simulation is read-only", () => {
    render(<Sidebar readOnly />);

    const sitesSection = screen.getByText("Sites").closest("section");
    expect(sitesSection).not.toBeNull();
    expect(
      within(sitesSection as HTMLElement).queryByRole("button", {
        name: "Edit",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(sitesSection as HTMLElement).getByText(
        "Read-only: you need edit permission to add or edit sites in this simulation.",
      ),
    ).toBeInTheDocument();
  });
});
