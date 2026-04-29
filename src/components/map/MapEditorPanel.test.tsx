// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
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
  const actual = await vi.importActual<typeof import("../../lib/cloudUser")>("../../lib/cloudUser");
  return {
    ...actual,
    fetchCollaboratorDirectory: vi.fn(async () => [
      { id: "owner-1", username: "Owner User", email: "owner@example.com", avatarUrl: "" },
      { id: "editor-1", username: "Editor User", email: "editor@example.com", avatarUrl: "" },
      { id: "collab-1", username: "Collaborator User", email: "collab@example.com", avatarUrl: "" },
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

const anchorRect = { top: 100, right: 200, bottom: 120, left: 160, width: 40, height: 20 };

describe("MapEditorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.mock.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
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

    await userEvent.click(screen.getByRole("button", { name: "Open change log" }));

    expect(fetchResourceChanges).toHaveBeenCalledWith("site", "site-lib-1");
    expect(await screen.findByText("Change Log · Alpha Site")).toBeInTheDocument();
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
            propagationEnvironment: useAppStore.getState().propagationEnvironment,
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

    await userEvent.click(screen.getByRole("button", { name: "Open change log" }));

    expect(fetchResourceChanges).toHaveBeenCalledWith("simulation", "sim-1");
    expect(await screen.findByText("Change Log · Mesh Plan")).toBeInTheDocument();
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
    expect(screen.getByText("Failed creating site. Check the name and try again.")).toBeInTheDocument();
    expect(useAppStore.getState().mapEditor).not.toBeNull();
  });
});
