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

  it("keeps search visible and remembers separate search state for each section", async () => {
    const user = userEvent.setup();
    render(<LibraryPanel initialTab="sites" isMobile={false} onClose={vi.fn()} readOnly={false} />);

    const sectionNav = screen.getByRole("navigation", { name: "Library sections" });
    const sitesSection = within(sectionNav).getByRole("button", { name: "Sites" });
    const simulationsSection = within(sectionNav).getByRole("button", { name: "Simulations" });
    expect(sitesSection).toHaveAttribute("aria-current", "page");

    const search = screen.getByRole("searchbox", { name: "Search Sites" });
    await user.type(search, "ridge");
    await user.click(simulationsSection);
    const simulationSearch = screen.getByRole("searchbox", { name: "Search Simulations" });
    expect(simulationSearch).toHaveValue("");
    await user.type(simulationSearch, "valley");

    await user.click(sitesSection);
    expect(screen.getByRole("searchbox", { name: "Search Sites" })).toHaveValue("ridge");
  });

  it("uses the Settings-style mobile section list without losing section state", async () => {
    const user = userEvent.setup();
    render(<LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />);

    const search = screen.getByRole("searchbox", { name: "Search Sites" });
    await user.type(search, "ridge");
    await user.click(screen.getByRole("button", { name: "Open Library sections" }));

    expect(screen.queryByRole("searchbox", { name: "Search Sites" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Simulations/i }));
    expect(screen.getByRole("searchbox", { name: "Search Simulations" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open Library sections" }));
    await user.click(screen.getByRole("button", { name: /Sites/i }));
    expect(screen.getByRole("searchbox", { name: "Search Sites" })).toHaveValue("ridge");
  });

  it("restores each section's results scroll position after using the mobile menu", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />,
    );

    const sitesList = container.querySelector<HTMLElement>(".library-unified-list");
    expect(sitesList).not.toBeNull();
    if (!sitesList) return;
    sitesList.scrollTop = 120;
    await user.click(screen.getByRole("button", { name: "Open Library sections" }));
    await user.click(screen.getByRole("button", { name: /Simulations/i }));

    const simulationsList = container.querySelector<HTMLElement>(".library-unified-list");
    expect(simulationsList).not.toBeNull();
    if (!simulationsList) return;
    simulationsList.scrollTop = 48;
    await user.click(screen.getByRole("button", { name: "Open Library sections" }));
    await user.click(screen.getByRole("button", { name: /Sites/i }));

    expect(container.querySelector<HTMLElement>(".library-unified-list")?.scrollTop).toBe(120);
  });

  it("opens Site details from an explicit button and keeps Add separate", async () => {
    const user = userEvent.setup();
    render(<LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />);

    expect(screen.queryByRole("button", { name: "Open Site details: Ridge Site" })).not.toBeInTheDocument();
    expect(screen.getByText("Ridge Site").closest("button")).toBeNull();
    const detailsButton = screen.getByRole("button", { name: "Details for Ridge Site" });
    expect(detailsButton.className).toBe(screen.getByRole("button", { name: "Add Ridge Site" }).className);
    await user.click(detailsButton);
    expect(useAppStore.getState().mapEditor).toMatchObject({
      kind: "site",
      resourceId: "site-library-1",
      origin: { kind: "library", tab: "sites" },
    });
    expect(useAppStore.getState().libraryRequest).toEqual({ tab: "sites" });
  });

  it("uses explicit Details and Open actions for Simulations", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LibraryPanel initialTab="simulations" isMobile onClose={onClose} readOnly={false} />);

    const detailsButton = screen.getByRole("button", { name: "Details for Valley Plan" });
    const openButton = screen.getByRole("button", { name: "Open Valley Plan" });
    expect(detailsButton.className).toBe(openButton.className);
    await user.click(openButton);

    expect(useAppStore.getState().selectedScenarioId).toBe("sim-1");
    expect(onClose).toHaveBeenCalledOnce();
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

  it("hides Site bulk selection on mobile and reveals desktop actions after selection", async () => {
    const user = userEvent.setup();
    const mobile = render(
      <LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />,
    );
    expect(screen.queryByRole("checkbox", { name: "Select Ridge Site" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select filtered/i })).not.toBeInTheDocument();
    mobile.unmount();

    render(<LibraryPanel initialTab="sites" isMobile={false} onClose={vi.fn()} readOnly={false} />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Ridge Site" });
    expect(checkbox).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select filtered/i })).not.toBeInTheDocument();

    await user.click(checkbox);
    expect(screen.getByRole("button", { name: /Select filtered/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("button", { name: /Select filtered/i })).not.toBeInTheDocument();
  });

  it("omits Manual item labels while retaining MQTT badges and source filtering", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      siteLibrary: [
        ...useAppStore.getState().siteLibrary,
        {
          ...useAppStore.getState().siteLibrary[0],
          id: "site-library-2",
          name: "MQTT Ridge",
          sourceMeta: { sourceType: "mqtt-feed", sourceUrl: "mqtt://feed-1" },
        },
      ],
    });
    render(<LibraryPanel initialTab="sites" isMobile onClose={vi.fn()} readOnly={false} />);

    expect(screen.queryByText("Manual")).not.toBeInTheDocument();
    expect(screen.getByText("MQTT")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Filter and sort Sites/i }));
    expect(within(screen.getByRole("dialog", { name: "Filter and sort Sites" })).getByText("Manual")).toBeVisible();
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
