// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/appStore";
import { fetchResourceChanges } from "../../lib/cloudUser";
import { MapEditorPanel } from "./MapEditorPanel";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const mock = {
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
  vi.stubGlobal("localStorage", mock);
  return { mock };
});

vi.mock("../../lib/cloudUser", async () => {
  const actual = await vi.importActual<typeof import("../../lib/cloudUser")>(
    "../../lib/cloudUser",
  );
  return {
    ...actual,
    fetchCollaboratorDirectory: vi.fn(async () => [
      {
        id: "owner-1",
        username: "Owner User",
        email: "owner@example.com",
        avatarUrl: "",
      },
      {
        id: "editor-1",
        username: "Editor User",
        email: "editor@example.com",
        avatarUrl: "",
      },
      {
        id: "collab-1",
        username: "Collaborator User",
        email: "collab@example.com",
        avatarUrl: "",
      },
    ]),
    fetchResourceChanges: vi.fn(async () => [
      {
        id: 7,
        action: "updated",
        changedAt: "2026-01-02T00:00:00.000Z",
        note: "Moved site",
        actorUserId: "editor-1",
        actorName: "Editor User",
        actorAvatarUrl: "",
        details: { diff: { name: { before: "Old", after: "Alpha Site" } } },
      },
    ]),
    fetchUserById: vi.fn(async (userId: string) => ({
      id: userId,
      username: userId === "owner-1" ? "Owner User" : "Editor User",
      email: `${userId}@example.com`,
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isApproved: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
    })),
    revertResourceChangeCopy: vi.fn(async () => undefined),
  };
});

vi.mock("../../lib/elevationService", () => ({
  fetchElevations: vi.fn(async () => [123]),
}));

vi.mock("../../lib/geocode", () => ({
  searchLocations: vi.fn(async () => []),
}));

const currentUser = {
  id: "owner-1",
  username: "Owner User",
  email: "owner@example.com",
  bio: "",
  avatarUrl: "",
  isAdmin: false,
  isApproved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
};

const anchorRect = {
  top: 100,
  right: 200,
  bottom: 120,
  left: 160,
  width: 40,
  height: 20,
};

describe("MapEditorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.mock.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(callback, 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    useAppStore.setState({
      currentUser,
      siteLibrary: [
        {
          id: "site-lib-1",
          name: "Alpha Site",
          description: "Ridge",
          visibility: "shared",
          sharedWith: [{ userId: "collab-1", role: "viewer" }],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdByUserId: "owner-1",
          createdByName: "Owner User",
          createdByAvatarUrl: "",
          lastEditedByUserId: "editor-1",
          lastEditedByName: "Editor User",
          lastEditedByAvatarUrl: "",
          position: { lat: 60.1, lon: 10.2 },
          groundElevationM: 111,
          antennaHeightM: 10,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      mapViewport: { center: { lat: 60, lon: 10 }, zoom: 8 },
      mapEditor: {
        kind: "site",
        resourceId: "site-lib-1",
        isNew: false,
        label: "Alpha Site",
        anchorRect,
      },
    });
  });

  it("shows compact site metadata footer and opens the existing change log flow", async () => {
    render(<MapEditorPanel isMobile={false} />);

    await waitFor(() => expect(screen.getByText("Owner")).toBeInTheDocument());
    expect(screen.queryByText("Owner User")).not.toBeInTheDocument();
    expect(screen.getByText("Last edited")).toBeInTheDocument();
    expect(screen.queryByText("Editor User")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Open change log" }),
    );

    expect(fetchResourceChanges).toHaveBeenCalledWith("site", "site-lib-1");
    expect(
      await screen.findByText("Change Log · Alpha Site"),
    ).toBeInTheDocument();
    expect(screen.getByText("Moved site")).toBeInTheDocument();
  });

  it("shows compact simulation metadata footer and opens the simulation change log flow", async () => {
    useAppStore.setState({
      simulationPresets: [
        {
          id: "sim-1",
          name: "Mesh Plan",
          description: "Shared plan",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdByUserId: "owner-1",
          createdByName: "Owner User",
          createdByAvatarUrl: "",
          lastEditedByUserId: "editor-1",
          lastEditedByName: "Editor User",
          lastEditedByAvatarUrl: "",
          updatedAt: "2026-01-02T00:00:00.000Z",
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
            propagationEnvironment:
              useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true,
            terrainDataset: "copernicus30",
          },
        },
      ],
      mapEditor: {
        kind: "simulation",
        resourceId: "sim-1",
        isNew: false,
        label: "Mesh Plan",
        anchorRect,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await waitFor(() => expect(screen.getByText("Owner")).toBeInTheDocument());
    expect(screen.queryByText("Owner User")).not.toBeInTheDocument();
    expect(screen.getByText("Last edited")).toBeInTheDocument();
    expect(screen.queryByText("Editor User")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Open change log" }),
    );

    expect(fetchResourceChanges).toHaveBeenCalledWith("simulation", "sim-1");
    expect(
      await screen.findByText("Change Log · Mesh Plan"),
    ).toBeInTheDocument();
  });

  it("shows Simulation settings summary and enables override editing from the edit action", async () => {
    useAppStore.setState({
      selectedFrequencyPresetId: "custom",
      rxSensitivityTargetDbm: -130,
      autoPropagationEnvironment: true,
      networks: [
        {
          id: "network-1",
          name: "Primary Network",
          frequencyMHz: 869.618,
          frequencyOverrideMHz: 869.618,
          bandwidthKhz: 62,
          spreadFactor: 8,
          codingRate: 5,
          regionCode: "EU_868",
          memberships: [],
        },
      ],
      selectedNetworkId: "network-1",
      simulationPresets: [
        {
          id: "sim-1",
          name: "Mesh Plan",
          description: "Shared plan",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdByUserId: "owner-1",
          createdByName: "Owner User",
          createdByAvatarUrl: "",
          lastEditedByUserId: "editor-1",
          lastEditedByName: "Editor User",
          lastEditedByAvatarUrl: "",
          updatedAt: "2026-01-02T00:00:00.000Z",
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
            rxSensitivityTargetDbm: -130,
            environmentLossDb: 0,
            propagationEnvironment:
              useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true,
            terrainDataset: "copernicus30",
          },
        },
      ],
      mapEditor: {
        kind: "simulation",
        resourceId: "sim-1",
        isNew: false,
        label: "Mesh Plan",
        anchorRect,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(await screen.findByText("Simulation settings")).toBeInTheDocument();
    expect(
      screen.getByText(
        "869.618 MHz · 62 kHz · SF8 · CR5 · Region EU_868 · RX -130 dBm · Auto environment",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This Simulation inherits the owner's account defaults for channel, RX target, and environment.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Frequency (MHz)")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Override Simulation settings" }),
    );

    expect(screen.getByLabelText("Frequency (MHz)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use inherited defaults" }),
    ).toBeInTheDocument();
  });

  it("renders read-only site details as static text", async () => {
    useAppStore.setState({
      siteLibrary: [
        {
          id: "site-lib-1",
          name: "Alpha Site",
          description: "",
          visibility: "shared",
          sharedWith: [{ userId: "owner-1", role: "viewer" }],
          ownerUserId: "editor-1",
          effectiveRole: "viewer",
          position: { lat: 60.1, lon: 10.2 },
          groundElevationM: 111,
          antennaHeightM: 10,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      mapEditor: {
        kind: "site",
        resourceId: "site-lib-1",
        isNew: false,
        label: "Alpha Site",
        anchorRect,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(
      await screen.findByRole("heading", { name: "Alpha Site" }),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alpha Site")).not.toBeInTheDocument();
    expect(screen.getByText("60.1")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveTextContent("");
    expect(screen.getByLabelText("Icon")).toHaveTextContent("Radio tower (Auto)");
    expect(
      screen.queryByRole("button", { name: "Save Site" }),
    ).not.toBeInTheDocument();
  });

  it("honors forced read-only site details even when the user can edit the site", async () => {
    useAppStore.setState({
      currentUser,
      siteLibrary: [
        {
          id: "site-lib-1",
          name: "Alpha Site",
          description: "Editable source",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          position: { lat: 60.1, lon: 10.2 },
          groundElevationM: 111,
          antennaHeightM: 10,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      mapEditor: {
        kind: "site",
        resourceId: "site-lib-1",
        isNew: false,
        label: "Alpha Site",
        anchorRect,
        readOnly: true,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(await screen.findByRole("heading", { name: "Alpha Site" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alpha Site")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Site" })).not.toBeInTheDocument();
  });

  it("renders read-only simulation details as static text", async () => {
    useAppStore.setState({
      simulationPresets: [
        {
          id: "sim-1",
          name: "Mesh Plan",
          description: "Shared plan",
          visibility: "shared",
          sharedWith: [{ userId: "owner-1", role: "viewer" }],
          ownerUserId: "editor-1",
          effectiveRole: "viewer",
          updatedAt: "2026-01-02T00:00:00.000Z",
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
            rxSensitivityTargetDbm: -130,
            environmentLossDb: 0,
            propagationEnvironment:
              useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true,
            terrainDataset: "copernicus30",
          },
        },
      ],
      mapEditor: {
        kind: "simulation",
        resourceId: "sim-1",
        isNew: false,
        label: "Mesh Plan",
        anchorRect,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(
      await screen.findByRole("heading", { name: "Mesh Plan" }),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Mesh Plan")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveTextContent(
      "Shared plan",
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("saves a copy from the copy editor instead of creating a blank simulation", async () => {
    useAppStore.setState({
      currentUser,
      selectedScenarioId: "sim-source",
      selectedSiteId: "site-a",
      selectedSiteIds: ["site-a"],
      selectedLinkId: "link-1",
      sites: [
        {
          id: "site-a",
          name: "Site A",
          position: { lat: 1, lon: 2 },
          groundElevationM: 3,
          antennaHeightM: 4,
          txPowerDbm: 5,
          txGainDbi: 6,
          rxGainDbi: 7,
          cableLossDb: 8,
        },
        {
          id: "site-b",
          name: "Site B",
          position: { lat: 9, lon: 10 },
          groundElevationM: 11,
          antennaHeightM: 12,
          txPowerDbm: 13,
          txGainDbi: 14,
          rxGainDbi: 15,
          cableLossDb: 16,
        },
      ],
      links: [
        {
          id: "link-1",
          name: "Path A",
          fromSiteId: "site-a",
          toSiteId: "site-b",
          frequencyMHz: 868,
        },
      ],
      simulationPresets: [
        {
          id: "sim-source",
          name: "Grefsen",
          description: "Source simulation",
          visibility: "private",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          updatedAt: "2026-01-02T00:00:00.000Z",
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
      mapEditor: {
        kind: "simulation",
        resourceId: null,
        isNew: true,
        label: "Save a copy",
        anchorRect,
        simulationSeed: {
          copyCurrentSimulation: true,
          name: "Grefsen Copy",
          description: "Source simulation",
        },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(await screen.findByRole("heading", { name: "Save a copy" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save a copy" }));

    const state = useAppStore.getState();
    const copy = state.simulationPresets.find((preset) => preset.name === "Grefsen Copy");
    expect(copy).toBeTruthy();
    expect(copy?.snapshot.sites).toHaveLength(2);
    expect(copy?.snapshot.links).toHaveLength(1);
    expect(state.selectedScenarioId).toBe(copy?.id);
    expect(state.sites).toHaveLength(2);
    expect(state.links).toHaveLength(1);
  });

  it("shows a field error when creating a duplicate simulation name", async () => {
    useAppStore.setState({
      currentUser,
      simulationPresets: [
        {
          id: "sim-1",
          name: "Grefsen",
          visibility: "private",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          updatedAt: "2026-01-02T00:00:00.000Z",
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
      mapEditor: {
        kind: "simulation",
        resourceId: null,
        isNew: true,
        label: "New Simulation",
        anchorRect,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    const nameInput = await screen.findByLabelText("Name");
    await userEvent.type(nameInput, "Grefsen");

    expect(await screen.findByText("Name must be unique.")).toBeInTheDocument();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveClass("input-error");

    await userEvent.click(screen.getByRole("button", { name: "Create Simulation" }));

    expect(screen.getByText("Name must be unique.")).toBeInTheDocument();
    expect(useAppStore.getState().simulationPresets).toHaveLength(1);
  });

  it("renders read-only link details as static text", async () => {
    useAppStore.setState({
      currentUser,
      sites: [
        {
          id: "site-a",
          name: "Site A",
          position: { lat: 1, lon: 2 },
          groundElevationM: 3,
          antennaHeightM: 4,
          txPowerDbm: 5,
          txGainDbi: 6,
          rxGainDbi: 7,
          cableLossDb: 8,
        },
        {
          id: "site-b",
          name: "Site B",
          position: { lat: 9, lon: 10 },
          groundElevationM: 11,
          antennaHeightM: 12,
          txPowerDbm: 13,
          txGainDbi: 14,
          rxGainDbi: 15,
          cableLossDb: 16,
        },
      ],
      links: [
        {
          id: "link-1",
          name: "Path A",
          fromSiteId: "site-a",
          toSiteId: "site-b",
          frequencyMHz: 868,
        },
      ],
      mapEditor: {
        kind: "link",
        resourceId: "link-1",
        isNew: false,
        label: "Path A",
        anchorRect,
        readOnly: true,
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(
      await screen.findByRole("heading", { name: "Path A" }),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Path A")).not.toBeInTheDocument();
    expect(screen.getByLabelText("From site")).toHaveTextContent("Site A");
    expect(screen.getByLabelText("To site")).toHaveTextContent("Site B");
    expect(
      screen.queryByRole("button", { name: "Save Link" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the editor open when new site creation fails", async () => {
    const addSiteLibraryEntry = vi.fn(() => "");
    const insertSiteFromLibrary = vi.fn();
    const updateSiteLibraryEntry = vi.fn();
    useAppStore.setState({
      addSiteLibraryEntry,
      insertSiteFromLibrary,
      updateSiteLibraryEntry,
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: true },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Broken Site");
    await userEvent.click(screen.getByRole("button", { name: "Create Site" }));

    expect(addSiteLibraryEntry).toHaveBeenCalled();
    expect(updateSiteLibraryEntry).not.toHaveBeenCalled();
    expect(insertSiteFromLibrary).not.toHaveBeenCalled();
    expect(
      screen.getByText("Failed creating site. Check the name and try again."),
    ).toBeInTheDocument();
    expect(useAppStore.getState().mapEditor).not.toBeNull();
  });

  it("persists a manually selected Site icon", async () => {
    const addSiteLibraryEntry = vi.fn(() => "site-created");
    useAppStore.setState({
      addSiteLibraryEntry,
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: false },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Harbour node");
    await userEvent.click(screen.getByRole("button", { name: /Auto · Radio tower/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Ship" }));
    await userEvent.click(screen.getByRole("button", { name: "Create Site" }));

    expect(addSiteLibraryEntry).toHaveBeenCalledWith(
      "Harbour node",
      60.3,
      10.4,
      0,
      10,
      22,
      2,
      2,
      1,
      undefined,
      "private",
      undefined,
      "ship",
    );
  });

  it("rejects pasted latitude outside the valid range without moving the site draft", async () => {
    const addSiteLibraryEntry = vi.fn(() => "site-created");
    const loadTerrainForCoordinate = vi.fn(async () => undefined);
    useAppStore.setState({
      addSiteLibraryEntry,
      loadTerrainForCoordinate,
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: false },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Test Site");
    const latInput = await screen.findByLabelText("Latitude");
    const initialDraft = useAppStore.getState().mapEditorSiteDraft;
    expect(initialDraft).toMatchObject({
      lat: 60.3,
      lon: 10.4,
    });

    await userEvent.clear(latInput);
    fireEvent.paste(latInput, {
      clipboardData: {
        getData: () => "    956894",
      },
    });

    expect(screen.getByText("Latitude must be between -90 and 90.")).toBeInTheDocument();
    expect(latInput).toHaveAttribute("aria-invalid", "true");
    expect(useAppStore.getState().mapEditorSiteDraft).toEqual(initialDraft);

    await userEvent.click(screen.getByRole("button", { name: "Create Site" }));

    expect(addSiteLibraryEntry).not.toHaveBeenCalled();
    expect(loadTerrainForCoordinate).not.toHaveBeenCalled();
    expect(useAppStore.getState().mapEditor).not.toBeNull();
  });

  it("rejects invalid longitude without creating a site", async () => {
    const addSiteLibraryEntry = vi.fn(() => "site-created");
    useAppStore.setState({
      addSiteLibraryEntry,
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: false },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Test Site");
    const lonInput = await screen.findByLabelText("Longitude");
    await userEvent.clear(lonInput);
    await userEvent.type(lonInput, "956894");

    expect(screen.getByText("Longitude must be between -180 and 180.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create Site" }));

    expect(addSiteLibraryEntry).not.toHaveBeenCalled();
    expect(useAppStore.getState().mapEditor).not.toBeNull();
  });

  it("clears coordinate validation once the pasted latitude is corrected", async () => {
    const addSiteLibraryEntry = vi.fn(() => "site-created");
    useAppStore.setState({
      addSiteLibraryEntry,
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: false },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Corrected Site");
    const latInput = await screen.findByLabelText("Latitude");
    await userEvent.clear(latInput);
    await userEvent.type(latInput, "956894");
    expect(screen.getByText("Latitude must be between -90 and 90.")).toBeInTheDocument();

    await userEvent.clear(latInput);
    await userEvent.type(latInput, "59.956894");
    expect(screen.queryByText("Latitude must be between -90 and 90.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create Site" }));

    expect(addSiteLibraryEntry).toHaveBeenCalledWith(
      "Corrected Site",
      59.956894,
      10.4,
      0,
      10,
      22,
      2,
      2,
      1,
      undefined,
      "private",
      undefined,
      undefined,
    );
    expect(useAppStore.getState().mapEditor).toBeNull();
  });
});
