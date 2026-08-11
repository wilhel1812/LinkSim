// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/appStore";
import { fetchResourceChanges, fetchUserById } from "../../lib/cloudUser";
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

  it("reveals directional settings only while the antenna toggle is enabled and retains drafts", async () => {
    render(<MapEditorPanel isMobile={false} />);

    const toggle = await screen.findByRole("checkbox", { name: "Directional antenna" });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText("Antenna azimuth")).not.toBeInTheDocument();

    await userEvent.click(toggle);
    const azimuth = screen.getByLabelText("Antenna azimuth");
    expect(screen.getByLabelText("Antenna tilt")).toBeInTheDocument();
    expect(screen.getByLabelText("Horizontal beamwidth")).toBeInTheDocument();
    expect(screen.getByLabelText("Vertical beamwidth")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum off-axis attenuation")).toBeInTheDocument();

    await userEvent.clear(azimuth);
    await userEvent.type(azimuth, "123");
    await userEvent.click(toggle);
    expect(screen.queryByLabelText("Antenna azimuth")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByLabelText("Antenna azimuth")).toHaveValue(123);
    await waitFor(() => expect(useAppStore.getState().mapEditorSiteDraft).toMatchObject({
      antennaMode: "directional",
      antennaAzimuthDeg: 123,
      antennaHorizontalBeamwidthDeg: 60,
    }));
  });

  it("derives orientation from another Simulation Site and supports detaching", async () => {
    useAppStore.setState({
      sites: [
        {
          id: "sim-site-a",
          libraryEntryId: "site-lib-1",
          name: "Alpha Site",
          position: { lat: 60.1, lon: 10.2 },
          groundElevationM: 111,
          antennaHeightM: 10,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
          antennaMode: "directional",
          antennaAzimuthDeg: 0,
          antennaTiltDeg: 35,
          antennaHorizontalBeamwidthDeg: 60,
          antennaVerticalBeamwidthDeg: 30,
          antennaMaxAttenuationDb: 25,
          antennaTargetSiteId: "sim-site-b",
        },
        {
          id: "sim-site-b",
          name: "Summit",
          position: { lat: 60.2, lon: 10.2 },
          groundElevationM: 900,
          antennaHeightM: 10,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
    });
    render(<MapEditorPanel isMobile={false} />);

    expect(await screen.findByRole("checkbox", { name: "Directional antenna" })).toBeChecked();
    const target = screen.getByRole("combobox", { name: "Point antenna at Site" });

    expect(target).toHaveValue("sim-site-b");
    expect(screen.getByLabelText("Antenna azimuth")).toBeDisabled();
    expect(screen.getByLabelText("Antenna tilt")).toBeDisabled();
    expect(screen.getByLabelText("Antenna azimuth")).toHaveValue(0);
    await userEvent.click(screen.getByRole("button", { name: "Detach pointing target" }));
    expect(screen.getByLabelText("Antenna azimuth")).toBeEnabled();

    await userEvent.clear(screen.getByLabelText("Antenna azimuth"));
    await userEvent.type(screen.getByLabelText("Antenna azimuth"), "123");
    fireEvent.change(screen.getByLabelText("Antenna tilt"), { target: { value: "-7" } });
    await userEvent.click(screen.getByRole("button", { name: "Save Site" }));

    const savedSite = useAppStore.getState().sites.find((site) => site.id === "sim-site-a");
    const savedLibrarySite = useAppStore.getState().siteLibrary.find((site) => site.id === "site-lib-1");
    expect(savedSite).toMatchObject({
      antennaTargetSiteId: undefined,
      antennaAzimuthDeg: 123,
      antennaTiltDeg: -7,
    });
    expect(savedLibrarySite).toMatchObject({
      antennaAzimuthDeg: 123,
      antennaTiltDeg: -7,
    });
  });

  it("confirms deletion from editable Site details", async () => {
    const deleteSiteLibraryEntry = vi.fn();
    useAppStore.setState({ deleteSiteLibraryEntry });
    render(<MapEditorPanel isMobile={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete Site" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Site" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(deleteSiteLibraryEntry).toHaveBeenCalledWith("site-lib-1");
    expect(useAppStore.getState().mapEditor).toBeNull();
  });

  it("opens the shared profile popover from metadata and change-log identities", async () => {
    render(<MapEditorPanel isMobile={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Open owner profile: Owner User" }));
    expect(await screen.findByRole("dialog", { name: "User profile for Owner User" })).toBeInTheDocument();
    expect(fetchUserById).toHaveBeenCalledWith("owner-1");

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Open change log" }));
    const actor = await screen.findByRole("button", { name: "Open profile for Editor User" });
    await userEvent.click(actor);

    expect(await screen.findByRole("dialog", { name: "User profile for Editor User" })).toBeInTheDocument();
    expect(fetchUserById).toHaveBeenCalledWith("editor-1");
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

  it("confirms Simulation deletion and preserves the editor when deletion fails", async () => {
    const deleteSimulationPreset = vi.fn(async () => {
      throw new Error("Cloud unavailable");
    });
    useAppStore.setState({
      deleteSimulationPreset,
      simulationPresets: [
        {
          id: "sim-delete",
          name: "Delete Plan",
          visibility: "private",
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          updatedAt: "2026-01-02T00:00:00.000Z",
          snapshot: {
            sites: [], links: [], systems: [], networks: [], selectedSiteId: "", selectedLinkId: "", selectedNetworkId: "",
            propagationModel: "ITM", selectedFrequencyPresetId: "custom", rxSensitivityTargetDbm: -120,
            environmentLossDb: 0, propagationEnvironment: useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true, terrainDataset: "copernicus30",
          },
        },
      ],
      mapEditor: { kind: "simulation", resourceId: "sim-delete", isNew: false, label: "Delete Plan", anchorRect },
    });
    render(<MapEditorPanel isMobile={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete Simulation" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Simulation" });
    expect(within(dialog).getByText(/Delete Delete Plan from the Library/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText("Delete failed: Cloud unavailable")).toBeInTheDocument();
    expect(useAppStore.getState().mapEditor?.resourceId).toBe("sim-delete");
  });

  it("does not offer Simulation deletion to resource collaborators", async () => {
    useAppStore.setState({
      simulationPresets: [
        {
          id: "sim-editor", name: "Editor Plan", visibility: "shared", ownerUserId: "other-owner",
          effectiveRole: "editor", updatedAt: "2026-01-02T00:00:00.000Z",
          snapshot: {
            sites: [], links: [], systems: [], networks: [], selectedSiteId: "", selectedLinkId: "", selectedNetworkId: "",
            propagationModel: "ITM", selectedFrequencyPresetId: "custom", rxSensitivityTargetDbm: -120,
            environmentLossDb: 0, propagationEnvironment: useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true, terrainDataset: "copernicus30",
          },
        },
      ],
      mapEditor: { kind: "simulation", resourceId: "sim-editor", isNew: false, label: "Editor Plan", anchorRect },
    });
    render(<MapEditorPanel isMobile={false} />);

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Simulation" })).not.toBeInTheDocument();
  });

  it("shows Restore in read-only deleted Simulation details for platform admins", async () => {
    const restoreSimulationPreset = vi.fn(async () => undefined);
    useAppStore.setState({
      currentUser: { ...currentUser, isAdmin: true },
      restoreSimulationPreset,
      simulationPresets: [
        {
          id: "sim-deleted", name: "Deleted Plan", status: "deleted", visibility: "private", ownerUserId: "owner-1",
          effectiveRole: "admin", updatedAt: "2026-01-02T00:00:00.000Z",
          snapshot: {
            sites: [], links: [], systems: [], networks: [], selectedSiteId: "", selectedLinkId: "", selectedNetworkId: "",
            propagationModel: "ITM", selectedFrequencyPresetId: "custom", rxSensitivityTargetDbm: -120,
            environmentLossDb: 0, propagationEnvironment: useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true, terrainDataset: "copernicus30",
          },
        },
      ],
      mapEditor: {
        kind: "simulation", resourceId: "sim-deleted", isNew: false, label: "Deleted Plan", anchorRect, readOnly: true,
        origin: { kind: "library", tab: "simulations" },
      },
    });
    render(<MapEditorPanel isMobile={false} />);

    expect(await screen.findByText(/available to platform admins for inspection/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Simulation" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore Simulation" }));
    await waitFor(() => expect(restoreSimulationPreset).toHaveBeenCalledWith("sim-deleted"));
    expect(useAppStore.getState().mapEditor).toBeNull();
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

  it("moves Simulation-scoped icon color to the Site editor and commits it immediately", async () => {
    const site = {
      id: "site-a",
      name: "Site A",
      position: { lat: 60, lon: 10 },
      groundElevationM: 100,
      antennaHeightM: 2,
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
    };
    useAppStore.setState({
      selectedScenarioId: "sim-appearance",
      siteLibrary: [{
        ...site,
        visibility: "private",
        sharedWith: [],
        ownerUserId: "owner-1",
        effectiveRole: "owner",
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
      sites: [site],
      linkColorMode: "manual",
      siteIconColors: {},
      simulationPresets: [{
        id: "sim-appearance",
        name: "Appearance Plan",
        ownerUserId: "owner-1",
        effectiveRole: "owner",
        updatedAt: "2026-01-02T00:00:00.000Z",
        snapshot: {
          sites: [site], links: [], systems: [], networks: [],
          selectedSiteId: "site-a", selectedLinkId: "", selectedNetworkId: "",
          propagationModel: "ITM", selectedFrequencyPresetId: "custom",
          rxSensitivityTargetDbm: -120, environmentLossDb: 0,
          propagationEnvironment: useAppStore.getState().propagationEnvironment,
          autoPropagationEnvironment: false, terrainDataset: "copernicus30",
        },
      }],
      mapEditor: { kind: "site", resourceId: "site-a", isNew: false, label: "Site A", anchorRect },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(screen.getByText("Applies to this Simulation only.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Site icon color")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set Site icon color to Blue" }));

    const state = useAppStore.getState();
    expect(state.siteIconColors).toEqual({ "site-a": "#2563eb" });
    expect(state.simulationPresets[0]?.snapshot.siteIconColors).toEqual({ "site-a": "#2563eb" });
    expect(state.siteLibrary[0]).not.toHaveProperty("color");
  });

  it("does not list Site colors or Link color mode in the Simulation editor", () => {
    useAppStore.setState({
      simulationPresets: [{
        id: "sim-appearance",
        name: "Appearance Plan",
        ownerUserId: "owner-1",
        effectiveRole: "owner",
        updatedAt: "2026-01-02T00:00:00.000Z",
        snapshot: {
          sites: [], links: [], systems: [], networks: [],
          selectedSiteId: "", selectedLinkId: "", selectedNetworkId: "",
          propagationModel: "ITM", selectedFrequencyPresetId: "custom",
          rxSensitivityTargetDbm: -120, environmentLossDb: 0,
          propagationEnvironment: useAppStore.getState().propagationEnvironment,
          autoPropagationEnvironment: false, terrainDataset: "copernicus30",
        },
      }],
      mapEditor: { kind: "simulation", resourceId: "sim-appearance", isNew: false, label: "Appearance Plan", anchorRect },
    });

    render(<MapEditorPanel isMobile={false} />);

    expect(screen.queryByLabelText("Appearance")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auto link colors" })).not.toBeInTheDocument();
  });

  it("commits a manual Link color immediately without waiting for Save Link", async () => {
    const sites = [
      { id: "site-a", name: "Site A", position: { lat: 60, lon: 10 }, groundElevationM: 100, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
      { id: "site-b", name: "Site B", position: { lat: 60.1, lon: 10.1 }, groundElevationM: 110, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
    ];
    useAppStore.setState({
      sites,
      links: [{ id: "link-a", name: "Path A", fromSiteId: "site-a", toSiteId: "site-b", frequencyMHz: 868 }],
      linkColorMode: "manual",
      mapEditor: { kind: "link", resourceId: "link-a", isNew: false, label: "Path A", anchorRect },
    });

    render(<MapEditorPanel isMobile={false} />);
    expect(screen.queryByLabelText("Link color")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set Link color to Purple" }));

    expect(useAppStore.getState().links[0]?.color).toBe("#7c3aed");
  });

  it("renders presets and theme color without an arbitrary picker", async () => {
    const sites = [
      { id: "site-a", name: "Site A", position: { lat: 60, lon: 10 }, groundElevationM: 100, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
      { id: "site-b", name: "Site B", position: { lat: 60.1, lon: 10.1 }, groundElevationM: 110, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
    ];
    useAppStore.setState({
      sites,
      links: [{ id: "link-a", name: "Path A", fromSiteId: "site-a", toSiteId: "site-b", frequencyMHz: 868, color: "#654321" }],
      linkColorMode: "manual",
      mapEditor: { kind: "link", resourceId: "link-a", isNew: false, label: "Path A", anchorRect },
    });

    render(<MapEditorPanel isMobile={false} />);
    const themeSwatch = await screen.findByRole("button", { name: "Use theme Link color" });
    const presetGroup = screen.getByRole("group", { name: "Link color presets" });
    expect(presetGroup.querySelector('input[type="color"]')).not.toBeInTheDocument();
    expect(themeSwatch).toHaveClass("simulation-color-swatch", "is-theme-color");
    expect(themeSwatch.previousElementSibling).toHaveClass("simulation-color-separator");

    await userEvent.click(themeSwatch);
    expect(useAppStore.getState().links[0]?.color).toBeUndefined();
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
    expect(screen.getByRole("img", { name: "Radio Tower" })).toBeInTheDocument();
    expect(screen.queryByText(/Radio tower|Auto/i)).not.toBeInTheDocument();
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

  it("returns a newly saved Site to its originating Library tab without adding it", async () => {
    const addSiteLibraryEntry = vi.fn(() => "site-created");
    const insertSiteFromLibrary = vi.fn();
    useAppStore.setState({
      addSiteLibraryEntry,
      insertSiteFromLibrary,
      libraryRequest: { tab: "sites" },
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        origin: { kind: "library", tab: "sites" },
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: false },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Library Site");
    await userEvent.click(screen.getByRole("button", { name: "Save to Library" }));

    expect(addSiteLibraryEntry).toHaveBeenCalled();
    expect(insertSiteFromLibrary).not.toHaveBeenCalled();
    expect(useAppStore.getState().mapEditor).toBeNull();
    expect(useAppStore.getState().libraryRequest).toEqual({ tab: "sites" });
  });

  it("offers Save and Add for an editable active Simulation and exits the Library", async () => {
    const addSiteLibraryEntry = vi.fn(() => "site-created");
    const insertSiteFromLibrary = vi.fn();
    const editableSimulationId = useAppStore.getState().scenarioOptions[0]?.id ?? "starter-default";
    useAppStore.setState({
      addSiteLibraryEntry,
      insertSiteFromLibrary,
      selectedScenarioId: editableSimulationId,
      libraryRequest: { tab: "sites" },
      mapEditor: {
        kind: "site",
        resourceId: null,
        isNew: true,
        label: "New Site",
        anchorRect,
        origin: { kind: "library", tab: "sites" },
        siteSeed: { lat: 60.3, lon: 10.4, insertIntoSimulation: false },
      },
    });

    render(<MapEditorPanel isMobile={false} />);

    await userEvent.type(await screen.findByLabelText("Name"), "Added Site");
    await userEvent.click(screen.getByRole("button", { name: "Save & Add to Simulation" }));

    expect(insertSiteFromLibrary).toHaveBeenCalledWith("site-created");
    expect(useAppStore.getState().mapEditor).toBeNull();
    expect(useAppStore.getState().libraryRequest).toBeNull();
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
    const trigger = screen.getByRole("button", { name: "Radio Tower" });
    expect(trigger).toHaveTextContent("");
    await userEvent.click(trigger);

    const shipOption = await screen.findByRole("button", { name: "Ship" });
    expect(shipOption).toHaveAttribute("title", "Ship");
    expect(shipOption).toHaveClass("btn-icon");
    expect(screen.queryByText("Ship")).not.toBeInTheDocument();
    await userEvent.click(shipOption);
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
