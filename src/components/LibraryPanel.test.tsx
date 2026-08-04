// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  });
});

import { useAppStore } from "../store/appStore";
import { LibraryPanel } from "./LibraryPanel";

const currentUser = {
  id: "owner-1",
  username: "Owner User",
  bio: "",
  avatarUrl: "",
  isAdmin: false,
  isApproved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
};

describe("LibraryPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      currentUser,
      libraryRequest: { tab: "sites" },
      siteLibrary: [
        {
          id: "site-library-1",
          name: "Ridge Site",
          visibility: "private",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdByName: "Owner User",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 60.1, lon: 11.2 },
          groundElevationM: 100,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
      simulationPresets: [
        {
          id: "sim-1",
          name: "Valley Plan",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdByName: "Owner User",
          updatedAt: "2026-02-01T00:00:00.000Z",
          snapshot: {
            sites: [],
            links: [],
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

  it("keeps search visible and remembers separate search state for each tab", async () => {
    const user = userEvent.setup();
    render(<LibraryPanel initialTab="sites" isMobile={false} onClose={vi.fn()} readOnly={false} />);

    const sitesTab = screen.getByRole("tab", { name: "Sites" });
    const simulationsTab = screen.getByRole("tab", { name: "Simulations" });
    expect(sitesTab).toHaveAttribute("aria-selected", "true");

    const search = screen.getByRole("searchbox", { name: "Search Sites" });
    await user.type(search, "ridge");
    await user.click(simulationsTab);
    const simulationSearch = screen.getByRole("searchbox", { name: "Search Simulations" });
    expect(simulationSearch).toHaveValue("");
    await user.type(simulationSearch, "valley");

    await user.click(sitesTab);
    expect(screen.getByRole("searchbox", { name: "Search Sites" })).toHaveValue("ridge");
  });

  it("opens item details from the item body and keeps Add as a separate action", async () => {
    const user = userEvent.setup();
    render(<LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />);

    await user.click(screen.getByRole("button", { name: "Open Site details: Ridge Site" }));
    expect(useAppStore.getState().mapEditor).toMatchObject({
      kind: "site",
      resourceId: "site-library-1",
      origin: { kind: "library", tab: "sites" },
    });
    expect(useAppStore.getState().libraryRequest).toEqual({ tab: "sites" });
  });

  it("preserves Save a copy in the Simulations tab", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ selectedScenarioId: "sim-1", libraryRequest: { tab: "simulations" } });
    render(<LibraryPanel initialTab="simulations" isMobile onClose={vi.fn()} readOnly={false} />);

    await user.click(screen.getByRole("button", { name: "Save a copy" }));

    expect(useAppStore.getState().mapEditor).toMatchObject({
      kind: "simulation",
      isNew: true,
      label: "Save a copy",
      origin: { kind: "library", tab: "simulations" },
      simulationSeed: { copyCurrentSimulation: true },
    });
  });

  it("hides Site bulk selection on mobile and keeps it on desktop", () => {
    const mobile = render(
      <LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />,
    );
    expect(screen.queryByRole("checkbox", { name: "Select Ridge Site" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select filtered/i })).not.toBeInTheDocument();
    mobile.unmount();

    render(<LibraryPanel initialTab="sites" isMobile={false} onClose={vi.fn()} readOnly={false} />);
    expect(screen.getByRole("checkbox", { name: "Select Ridge Site" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select filtered/i })).toBeInTheDocument();
  });

  it("keeps search outside the advanced filter panel", async () => {
    const user = userEvent.setup();
    render(<LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />);

    expect(screen.getByRole("searchbox", { name: "Search Sites" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Filter and sort/i }));
    const dialog = screen.getByRole("dialog", { name: "Filter and sort Sites" });
    expect(within(dialog).getByRole("radio", { name: "Recently created" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Sites" })).toBeVisible();
  });
});
