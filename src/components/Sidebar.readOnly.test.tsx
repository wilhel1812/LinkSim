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
    localStorage.clear();
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
      selectedScenarioId: "sim-alpha",
      selectedFrequencyPresetId: "meshcore-us-narrow-910525-sf7-bw625-cr5",
      autoPropagationEnvironment: true,
      siteLibrary: [],
      simulationPresets: [
        {
          id: "sim-alpha",
          name: "Alpha Simulation",
          description: "Shared simulation",
          visibility: "shared",
          sharedWith: [],
          effectiveRole: "viewer",
          ownerUserId: "owner-1",
          updatedAt: "2026-01-02T00:00:00.000Z",
          snapshot: {
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
            systems: [],
            networks: [],
            selectedSiteId: "",
            selectedLinkId: "",
            selectedNetworkId: "",
            selectedCoverageResolution: "24",
            propagationModel: "ITM",
            selectedFrequencyPresetId: "custom",
            rxSensitivityTargetDbm: -120,
            environmentLossDb: 0,
            propagationEnvironment: useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true,
            terrainDataset: "copernicus30",
          },
        },
      ],
    });
  });

  it("replaces read-only row edit buttons with view details actions", async () => {
    render(<Sidebar readOnly />);

    const simulationSection = screen.getByText(/Simulation:/).closest("section");
    expect(simulationSection).not.toBeNull();
    expect(within(simulationSection as HTMLElement).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    await userEvent.click(within(simulationSection as HTMLElement).getByRole("button", { name: "Save a copy" }));

    expect(useAppStore.getState().mapEditor).toMatchObject({
      kind: "simulation",
      resourceId: null,
      isNew: true,
      label: "Save a copy",
      simulationSeed: {
        copyCurrentSimulation: true,
        name: "Alpha Simulation Copy",
        description: "Shared simulation",
        autoPropagationEnvironment: true,
      },
    });

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
      readOnly: true,
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
      readOnly: true,
    });
  });

  it("routes the Simulation Library entry to the unified Library", async () => {
    render(<Sidebar readOnly />);

    const simulationSection = screen.getByText(/Simulation:/).closest("section");
    expect(simulationSection).not.toBeNull();
    await userEvent.click(within(simulationSection as HTMLElement).getByRole("button", { name: "Library" }));

    expect(useAppStore.getState().libraryRequest).toEqual({ tab: "simulations" });
  });

  it("renders accessible icon-only legal and community footer links", () => {
    render(<Sidebar readOnly />);

    const discordLink = screen.getByRole("link", { name: "Discord" });
    expect(discordLink.parentElement).toHaveClass("sidebar-footer-icon-links");
    expect(discordLink).toHaveAttribute(
      "href",
      "https://discord.gg/Sg2FN7EJW",
    );
    for (const label of ["Terms", "Privacy", "GitHub", "Matrix", "Discord"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("title", label);
      expect(link).toHaveTextContent("");
    }
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

  it("warns writable shared-simulation editors about every referenced private site", () => {
    const state = useAppStore.getState();
    const privateTooltip =
      "This Site is Private in the Library, but is visible to anyone who can access this Shared Simulation.";
    const warning =
      "This Simulation is Shared and includes Private Sites. Those Sites are visible to anyone who can access this Simulation.";
    useAppStore.setState({
      sites: state.sites.map((site, index) => ({
        ...site,
        libraryEntryId: index === 0 ? "private-owned-elsewhere" : "shared-site",
      })),
      siteLibrary: [
        {
          id: "private-owned-elsewhere",
          name: "Private Elsewhere",
          visibility: "private",
          ownerUserId: "another-owner",
          effectiveRole: "viewer",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "shared-site",
          name: "Shared Site",
          visibility: "shared",
          ownerUserId: "another-owner",
          effectiveRole: "viewer",
          position: { lat: 60.6, lon: 11.6 },
          groundElevationM: 130,
          antennaHeightM: 4,
          txPowerDbm: 21,
          txGainDbi: 3,
          rxGainDbi: 3,
          cableLossDb: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      simulationPresets: state.simulationPresets.map((simulation) => ({
        ...simulation,
        effectiveRole: "editor",
        snapshot: {
          ...simulation.snapshot,
          sites: state.sites.map((site, index) => ({
            ...site,
            libraryEntryId: index === 0 ? "private-owned-elsewhere" : "shared-site",
          })),
        },
      })),
    });

    const view = render(<Sidebar />);
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: privateTooltip })).toBeInTheDocument();

    view.unmount();
    render(<Sidebar readOnly />);
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: privateTooltip })).not.toBeInTheDocument();
  });
});
