import { beforeEach, describe, expect, it, vi } from "vitest";

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
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", mock);
  vi.stubGlobal("window", {
    localStorage: mock,
    setTimeout,
    clearTimeout,
  });
  return { data, mock };
});

vi.mock("../lib/coverage", () => ({
  buildCoverage: vi.fn(() => []),
  clearTerrainLossCache: vi.fn(),
}));

vi.mock("../lib/elevationService", () => ({
  fetchElevations: vi.fn(async () => [123]),
}));

vi.mock("../lib/cloudLibrary", async () => {
  const actual = await vi.importActual<typeof import("../lib/cloudLibrary")>("../lib/cloudLibrary");
  return {
    ...actual,
    deleteCloudSimulation: vi.fn(async () => undefined),
    restoreCloudSimulation: vi.fn(async () => undefined),
  };
});

import { useAppStore } from "./appStore";
import { fetchElevations } from "../lib/elevationService";
import { deleteCloudSimulation, restoreCloudSimulation } from "../lib/cloudLibrary";
import { simulationDefaultsFromPreset } from "../lib/simulationDefaults";

describe("appStore auth session state", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
  });

  it("marks auth state signed_in when current user is set and signed_out when cleared", () => {
    useAppStore.getState().setCurrentUser({
      id: "user-1",
      username: "User One",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });
    expect(useAppStore.getState().authState).toBe("signed_in");

    useAppStore.getState().setCurrentUser(null);
    expect(useAppStore.getState().authState).toBe("signed_out");
  });
});

describe("appStore auth guards", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: null,
      siteLibrary: [
        {
          id: "lib-1",
          name: "Alpha",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 1, lon: 1 },
          groundElevationM: 100,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
        {
          id: "lib-2",
          name: "Beta",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 2, lon: 2 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
      sites: [
        {
          id: "site-1",
          name: "Alpha",
          libraryEntryId: "lib-1",
          position: { lat: 1, lon: 1 },
          groundElevationM: 100,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
        {
          id: "site-2",
          name: "Beta",
          libraryEntryId: "lib-2",
          position: { lat: 2, lon: 2 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
      links: [
        {
          id: "lnk-1",
          name: "Alpha-Beta",
          fromSiteId: "site-1",
          toSiteId: "site-2",
          frequencyMHz: 869.618,
        },
      ],
      selectedScenarioId: "sim-1",
      simulationPresets: [
        {
          id: "sim-1",
          name: "Simulation One",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          updatedAt: "2026-01-01T00:00:00.000Z",
          snapshot: {
            sites: [
              {
                id: "site-1",
                name: "Alpha",
                libraryEntryId: "lib-1",
                position: { lat: 1, lon: 1 },
                groundElevationM: 100,
                antennaHeightM: 2,
                txPowerDbm: 20,
                txGainDbi: 2,
                rxGainDbi: 2,
                cableLossDb: 1,
              },
              {
                id: "site-2",
                name: "Beta",
                libraryEntryId: "lib-2",
                position: { lat: 2, lon: 2 },
                groundElevationM: 120,
                antennaHeightM: 2,
                txPowerDbm: 20,
                txGainDbi: 2,
                rxGainDbi: 2,
                cableLossDb: 1,
              },
            ],
            links: [
              {
                id: "lnk-1",
                name: "Alpha-Beta",
                fromSiteId: "site-1",
                toSiteId: "site-2",
                frequencyMHz: 869.618,
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

  it("blocks updateSite when current user cannot edit linked Site Library entry", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useAppStore.getState().setCurrentUser({
      id: "user-2",
      username: "viewer",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    useAppStore.getState().updateSite("site-1", { name: "Renamed" });

    expect(useAppStore.getState().sites[0]?.name).toBe("Alpha");
    expect(useAppStore.getState().siteLibrary[0]?.name).toBe("Alpha");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("blocks Library deletion when the current user only has view access", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useAppStore.getState().setCurrentUser({
      id: "user-2",
      username: "viewer",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    useAppStore.getState().deleteSiteLibraryEntry("lib-1");
    await expect(useAppStore.getState().deleteSimulationPreset("sim-1")).rejects.toThrow(
      "Only the Simulation owner or a platform admin",
    );

    expect(useAppStore.getState().siteLibrary.some((entry) => entry.id === "lib-1")).toBe(true);
    expect(useAppStore.getState().simulationPresets.some((preset) => preset.id === "sim-1")).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("does not auto-sync online elevations when adding a site", async () => {
    vi.mocked(fetchElevations).mockClear();
    useAppStore.getState().setCurrentUser({
      id: "owner-1",
      username: "owner",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    useAppStore.getState().addSiteByCoordinates("Gamma", 3, 3);
    await Promise.resolve();

    expect(fetchElevations).not.toHaveBeenCalled();
  });

  it("blocks updateCurrentSimulationSnapshot when current user cannot edit selected simulation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useAppStore.getState().setCurrentUser({
      id: "user-2",
      username: "viewer",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    const beforeUpdatedAt = useAppStore.getState().simulationPresets[0]?.updatedAt;
    useAppStore.getState().updateCurrentSimulationSnapshot();

    expect(useAppStore.getState().simulationPresets[0]?.updatedAt).toBe(beforeUpdatedAt);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("updates active simulation snapshot when deleting a site from simulation", () => {
    useAppStore.getState().setCurrentUser({
      id: "owner-1",
      username: "owner",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    useAppStore.getState().updateSimulationPresetEntry("sim-1", { name: "Simulation One" });
    useAppStore.getState().deleteSite("site-1");

    const state = useAppStore.getState();
    expect(state.sites.some((site) => site.id === "site-1")).toBe(false);
    expect(state.simulationPresets[0]?.snapshot.sites.some((site) => site.id === "site-1")).toBe(false);
  });

  it("tracks a pointing target and detaches at the last orientation when the target is deleted", () => {
    useAppStore.getState().setCurrentUser({
      id: "owner-1",
      username: "owner",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });
    useAppStore.setState((state) => ({
      siteLibrary: state.siteLibrary.map((entry) => entry.id === "lib-1" ? { ...entry, effectiveRole: "owner" as const } : entry),
    }));
    useAppStore.getState().updateSite("site-1", {
        antennaMode: "directional" as const,
        antennaTargetSiteId: "site-2",
    });

    useAppStore.getState().updateSite("site-2", { position: { lat: 1, lon: 0 } });
    expect(useAppStore.getState().sites.find((site) => site.id === "site-2")?.position).toEqual({ lat: 1, lon: 0 });
    const tracked = useAppStore.getState().sites.find((site) => site.id === "site-1");
    expect(tracked?.antennaAzimuthDeg).toBeCloseTo(270, 1);
    expect(tracked?.antennaTargetSiteId).toBe("site-2");

    useAppStore.getState().deleteSite("site-2");
    const detached = useAppStore.getState().sites.find((site) => site.id === "site-1");
    expect(detached?.antennaTargetSiteId).toBeUndefined();
    expect(detached?.antennaTargetDetachedReason).toBe("target-deleted");
    expect(detached?.antennaAzimuthDeg).toBeCloseTo(270, 1);
  });

  it("persists selected overlay radius option to active simulation snapshot", () => {
    useAppStore.getState().setCurrentUser({
      id: "owner-1",
      username: "owner",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    useAppStore.getState().setSelectedOverlayRadiusOption("100");

    expect(useAppStore.getState().selectedOverlayRadiusOption).toBe("100");
    expect(useAppStore.getState().simulationPresets[0]?.snapshot.selectedOverlayRadiusOption).toBe("100");
  });

  it("blocks deleteSite when current user cannot edit selected simulation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useAppStore.getState().setCurrentUser({
      id: "user-2",
      username: "viewer",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    const beforeSiteCount = useAppStore.getState().sites.length;
    useAppStore.getState().deleteSite("site-1");
    expect(useAppStore.getState().sites.length).toBe(beforeSiteCount);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("blocks updateLink when current user cannot edit selected simulation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useAppStore.getState().setCurrentUser({
      id: "user-2",
      username: "viewer",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    useAppStore.getState().updateLink("lnk-1", { name: "Blocked Rename" });
    expect(useAppStore.getState().links.find((link) => link.id === "lnk-1")?.name).toBe("Alpha-Beta");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("blocks insertSitesFromLibrary when current user cannot edit selected simulation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useAppStore.setState((state) => ({
      siteLibrary: [
        ...state.siteLibrary,
        {
          id: "lib-3",
          name: "Gamma",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          effectiveRole: "viewer",
          createdAt: "2026-01-01T00:00:00.000Z",
          position: { lat: 3, lon: 3 },
          groundElevationM: 130,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
      ],
    }));
    useAppStore.getState().setCurrentUser({
      id: "user-2",
      username: "viewer",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });

    const beforeSiteCount = useAppStore.getState().sites.length;
    useAppStore.getState().insertSitesFromLibrary(["lib-3"]);
    expect(useAppStore.getState().sites.length).toBe(beforeSiteCount);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("clears selectedLinkId when switching to single-site selection", () => {
    useAppStore.setState({
      selectedLinkId: "lnk-1",
      selectedSiteId: "site-1",
      selectedSiteIds: ["site-1", "site-2"],
    });

    useAppStore.getState().setSelectedSiteId("site-2");

    const state = useAppStore.getState();
    expect(state.selectedLinkId).toBe("");
    expect(state.selectedSiteIds).toEqual(["site-2"]);
  });

  it("clears selectedLinkId when toggling additive site selection", () => {
    useAppStore.setState({
      selectedLinkId: "lnk-1",
      selectedSiteId: "site-1",
      selectedSiteIds: ["site-1", "site-2"],
    });

    useAppStore.getState().selectSiteById("site-1", true);

    const state = useAppStore.getState();
    expect(state.selectedLinkId).toBe("");
    expect(state.selectedSiteIds).toEqual(["site-2"]);
  });
});

describe("appStore blank simulation loading", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "owner",
        avatarUrl: "",
        role: "user",
        accountState: "approved",
        isApproved: true,
        isAdmin: false,
        isModerator: false,
        createdAt: "",
        updatedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        email: undefined,
        emailPublic: true,
        bio: "",
      },
      selectedScenarioId: "starter-default",
      sites: [],
      links: [],
      simulationPresets: [],
    });
  });

  it("persists last-session selection when loading a blank saved simulation", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Blank Session", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();

    storage.mock.removeItem("linksim-last-session-v1");
    useAppStore.getState().loadSimulationPreset(createdId as string);

    const raw = storage.mock.getItem("linksim-last-session-v1");
    expect(raw).toBeTruthy();
    expect(raw).toContain(createdId as string);
  });

  it("grants the owner edit access immediately when creating a blank simulation", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Writable Blank Session", { visibility: "private", ownerUserId: "owner-1" });

    const created = useAppStore.getState().simulationPresets.find((entry) => entry.id === createdId);
    expect(created?.effectiveRole).toBe("owner");
  });

  it("keeps a simulation shared when it references a private Library Site", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Shared With Private Site", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();

    const privateSite = {
      id: "private-site",
      name: "Private Site",
      visibility: "private" as const,
      ownerUserId: "owner-1",
      effectiveRole: "owner" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      position: { lat: 60, lon: 10 },
      groundElevationM: 100,
      antennaHeightM: 2,
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
    };
    useAppStore.setState((state) => ({
      siteLibrary: [privateSite],
      simulationPresets: state.simulationPresets.map((simulation) =>
        simulation.id === createdId
          ? {
              ...simulation,
              snapshot: {
                ...simulation.snapshot,
                sites: [{ ...privateSite, libraryEntryId: privateSite.id }],
              },
            }
          : simulation,
      ),
    }));

    useAppStore.getState().updateSimulationPresetEntry(createdId as string, { visibility: "shared" });

    expect(useAppStore.getState().simulationPresets.find((simulation) => simulation.id === createdId)?.visibility)
      .toBe("shared");
    expect(useAppStore.getState().siteLibrary[0]?.visibility).toBe("private");
  });
});

describe("appStore unified Library state", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.getState().setCurrentUser({
      id: "owner-1",
      username: "owner",
      avatarUrl: "",
      role: "user",
      accountState: "approved",
      isApproved: true,
      isAdmin: false,
      isModerator: false,
      createdAt: "",
      updatedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      email: undefined,
      emailPublic: true,
      bio: "",
    });
  });

  it("opens and closes the Library with an explicit tab", () => {
    useAppStore.getState().openLibrary("sites");
    expect(useAppStore.getState().libraryRequest).toEqual({ tab: "sites" });

    useAppStore.getState().openLibrary("simulations");
    expect(useAppStore.getState().libraryRequest).toEqual({ tab: "simulations" });

    useAppStore.getState().closeLibrary();
    expect(useAppStore.getState().libraryRequest).toBeNull();
  });

  it("detaches a deleted Library Site from the live workspace and saved snapshots", () => {
    const linkedSite = {
      id: "site-1",
      name: "Ridge",
      libraryEntryId: "library-site-1",
      position: { lat: 60, lon: 11 },
      groundElevationM: 100,
      antennaHeightM: 2,
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
    };
    useAppStore.setState({
      siteLibrary: [
        {
          ...linkedSite,
          id: "library-site-1",
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      sites: [linkedSite],
      simulationPresets: [
        {
          id: "sim-1",
          name: "Ridge plan",
          ownerUserId: "owner-1",
          effectiveRole: "owner",
          updatedAt: "2026-01-01T00:00:00.000Z",
          snapshot: {
            sites: [linkedSite],
            links: [],
            systems: [],
            networks: [],
            selectedSiteId: "site-1",
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

    useAppStore.getState().deleteSiteLibraryEntry("library-site-1");

    expect(useAppStore.getState().sites[0]).not.toHaveProperty("libraryEntryId");
    expect(useAppStore.getState().simulationPresets[0]?.snapshot.sites[0]).not.toHaveProperty(
      "libraryEntryId",
    );
  });

  it("clears the workspace and persisted active references when deleting the active Simulation", async () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Delete me", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();
    useAppStore.getState().loadSimulationPreset(createdId as string);
    storage.mock.setItem("rmw-last-simulation-ref-v1", `saved:${createdId}`);

    await useAppStore.getState().deleteSimulationPreset(createdId as string);

    const state = useAppStore.getState();
    expect(state.selectedScenarioId).toBe("");
    expect(state.sites).toEqual([]);
    expect(state.links).toEqual([]);
    expect(storage.mock.getItem("linksim-last-session-v1")).toBeNull();
    expect(storage.mock.getItem("rmw-last-simulation-ref-v1")).toBeNull();
  });

  it("keeps the Simulation and active workspace when backend deletion fails", async () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Keep me", { visibility: "private", ownerUserId: "owner-1" });
    useAppStore.getState().loadSimulationPreset(createdId as string);
    vi.mocked(deleteCloudSimulation).mockRejectedValueOnce(new Error("Network unavailable"));

    await expect(useAppStore.getState().deleteSimulationPreset(createdId as string)).rejects.toThrow("Network unavailable");

    expect(useAppStore.getState().simulationPresets.some((preset) => preset.id === createdId)).toBe(true);
    expect(useAppStore.getState().selectedScenarioId).toBe(createdId);
  });

  it("keeps deleted Simulations inspectable for admins and restores them", async () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Admin lifecycle", { visibility: "private", ownerUserId: "owner-1" });
    useAppStore.setState({
      currentUser: { ...useAppStore.getState().currentUser!, isAdmin: true, role: "admin" },
    });

    await useAppStore.getState().deleteSimulationPreset(createdId as string);
    expect(useAppStore.getState().simulationPresets.find((preset) => preset.id === createdId)?.status).toBe("deleted");
    await useAppStore.getState().restoreSimulationPreset(createdId as string);

    expect(restoreCloudSimulation).toHaveBeenCalledWith(createdId);
    expect(useAppStore.getState().simulationPresets.find((preset) => preset.id === createdId)?.status).toBe("active");
  });

  it("applies remote deletion tombstones and clears a stale active workspace", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Remote delete", { visibility: "shared", ownerUserId: "owner-1" });
    useAppStore.getState().loadSimulationPreset(createdId as string);

    useAppStore.getState().applyDeletedSimulationTombstones([createdId as string]);

    expect(useAppStore.getState().simulationPresets.some((preset) => preset.id === createdId)).toBe(false);
    expect(useAppStore.getState().selectedScenarioId).toBe("");
    expect(useAppStore.getState().sites).toEqual([]);
  });
});

describe("appStore new simulation default frequency preset", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "owner",
        avatarUrl: "",
        role: "user",
        accountState: "approved",
        isApproved: true,
        isAdmin: false,
        isModerator: false,
        createdAt: "",
        updatedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        email: undefined,
        emailPublic: true,
        bio: "",
        defaultFrequencyPresetId: "meshcore-us-narrow-910525-sf7-bw625-cr5",
      },
      selectedScenarioId: "starter-default",
      sites: [],
      links: [],
      simulationPresets: [],
    });
  });

  it("uses cloud default preset when creating blank simulation", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Cloud Default Session", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();
    const created = useAppStore.getState().simulationPresets.find((entry) => entry.id === createdId);
    expect(created?.snapshot.selectedFrequencyPresetId).toBe("meshcore-us-narrow-910525-sf7-bw625-cr5");
  });

  it("uses cloud simulation defaults when creating blank simulation", () => {
    useAppStore.setState((state) => ({
      currentUser: state.currentUser
        ? {
            ...state.currentUser,
            simulationDefaultsPreference: {
              mode: "custom",
              presetId: "meshcore-us-narrow-910525-sf7-bw625-cr5",
              overridePresetDefaults: false,
              custom: {
                frequencyPresetId: "meshcore-us-narrow-910525-sf7-bw625-cr5",
                frequencyMHz: 910.525,
                bandwidthKhz: 62.5,
                spreadFactor: 7,
                codingRate: 5,
                regionCode: "US",
                rxSensitivityTargetDbm: -131,
                environmentLossDb: 4,
                autoPropagationEnvironment: false,
              },
            },
          }
        : state.currentUser,
    }));

    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Cloud Simulation Defaults", { visibility: "private", ownerUserId: "owner-1" });
    const created = useAppStore.getState().simulationPresets.find((entry) => entry.id === createdId);
    expect(created?.snapshot.selectedFrequencyPresetId).toBe("meshcore-us-narrow-910525-sf7-bw625-cr5");
    expect(created?.snapshot.rxSensitivityTargetDbm).toBe(-131);
    expect(created?.snapshot.environmentLossDb).toBe(4);
    expect(created?.snapshot.autoPropagationEnvironment).toBe(false);
    expect(created?.snapshot.simulationDefaultsOverrideEnabled).toBe(false);
  });

  it("uses a selected named custom preset when creating a blank simulation", () => {
    const defaults = {
      ...simulationDefaultsFromPreset("mt-eu_868"),
      frequencyPresetId: "radio-field-mesh",
      frequencyMHz: 869.4,
      rxSensitivityTargetDbm: -127,
    };
    useAppStore.setState((state) => ({
      currentUser: state.currentUser ? {
        ...state.currentUser,
        simulationDefaultsPreference: {
          mode: "custom",
          presetId: "mt-eu_868",
          customPresetId: "radio-field-mesh",
          customPresets: [{ id: "radio-field-mesh", name: "Field Mesh", defaults }],
          overridePresetDefaults: false,
        },
      } : null,
    }));

    const createdId = useAppStore.getState().createBlankSimulationPreset("Named custom", {
      visibility: "private",
      ownerUserId: "owner-1",
    });
    const created = useAppStore.getState().simulationPresets.find((entry) => entry.id === createdId);
    expect(created?.snapshot).toMatchObject({
      selectedFrequencyPresetId: "radio-field-mesh",
      rxSensitivityTargetDbm: -127,
    });
  });

  it("falls back to app default when cloud default is invalid", () => {
    useAppStore.setState((state) => ({
      currentUser: state.currentUser
        ? { ...state.currentUser, defaultFrequencyPresetId: "not-a-real-preset" }
        : state.currentUser,
    }));
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Fallback Session", { visibility: "private", ownerUserId: "owner-1" });
    const created = useAppStore.getState().simulationPresets.find((entry) => entry.id === createdId);
    expect(created?.snapshot.selectedFrequencyPresetId).toBe("oslo-local-869618");
  });
});

describe("appStore simulation copy", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "owner",
        avatarUrl: "",
        role: "user",
        accountState: "approved",
        isApproved: true,
        isAdmin: false,
        isModerator: false,
        createdAt: "",
        updatedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        email: undefined,
        emailPublic: true,
        bio: "",
      },
      selectedScenarioId: "sim-alpha",
      selectedFrequencyPresetId: "custom",
      autoPropagationEnvironment: false,
      simulationDefaultsOverrideEnabled: false,
      simulationDefaultsOverride: null,
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
          iconKey: "ship",
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
      siteLibrary: [],
      simulationPresets: [],
    });
  });

  it("creates a private copy with the current sites and links", () => {
    const createdId = useAppStore
      .getState()
      .createSimulationCopyFromCurrent("Copied Session", { description: "Copied from alpha" });

    expect(createdId).toBeTruthy();

    const created = useAppStore.getState().simulationPresets.find((entry) => entry.id === createdId);
    expect(created).toMatchObject({
      name: "Copied Session",
      description: "Copied from alpha",
      visibility: "private",
      sharedWith: [],
      ownerUserId: "owner-1",
    });
    expect(created?.snapshot.sites).toHaveLength(2);
    expect(created?.snapshot.sites.map((site) => site.name)).toEqual(["Site Alpha", "Site Beta"]);
    expect(created?.snapshot.sites[1]?.iconKey).toBe("ship");
    expect(created?.snapshot.links).toHaveLength(1);
    expect(created?.snapshot.links[0]).toMatchObject({
      fromSiteId: "site-alpha",
      toSiteId: "site-beta",
      name: "Alpha Link",
    });
    expect(useAppStore.getState().siteLibrary).toHaveLength(2);
    expect(useAppStore.getState().siteLibrary.map((entry) => entry.name)).toEqual(["Site Beta", "Site Alpha"]);
    expect(useAppStore.getState().siteLibrary.find((entry) => entry.name === "Site Beta")?.iconKey).toBe("ship");

    useAppStore.getState().loadSimulationPreset(createdId as string);
    expect(useAppStore.getState().selectedScenarioId).toBe(createdId);
    expect(useAppStore.getState().sites).toHaveLength(2);
    expect(useAppStore.getState().links).toHaveLength(1);
  });
});

describe("appStore built-in scenario defaults", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
  });

  it("uses the preset RX target for the starter workspace", () => {
    useAppStore.getState().selectScenario("workspace-starter");
    expect(useAppStore.getState().rxSensitivityTargetDbm).toBe(-130);
  });
});

describe("appStore blank simulation loading", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "owner",
        avatarUrl: "",
        role: "user",
        accountState: "approved",
        isApproved: true,
        isAdmin: false,
        isModerator: false,
        createdAt: "",
        updatedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        email: undefined,
        emailPublic: true,
        bio: "",
      },
      selectedScenarioId: "starter-default",
      sites: [],
      links: [],
      simulationPresets: [],
    });
  });

  it("persists last-session selection when loading a blank saved simulation", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Blank Session", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();

    storage.mock.removeItem("linksim-last-session-v1");
    useAppStore.getState().loadSimulationPreset(createdId as string);

    const raw = storage.mock.getItem("linksim-last-session-v1");
    expect(raw).toBeTruthy();
    expect(raw).toContain(createdId as string);
  });
});

describe("appStore blank simulation loading", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "owner",
        avatarUrl: "",
        role: "user",
        accountState: "approved",
        isApproved: true,
        isAdmin: false,
        isModerator: false,
        createdAt: "",
        updatedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        email: undefined,
        emailPublic: true,
        bio: "",
      },
      selectedScenarioId: "starter-default",
      sites: [],
      links: [],
      simulationPresets: [],
    });
  });

  it("persists last-session selection when loading a blank saved simulation", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Blank Session", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();

    storage.mock.removeItem("linksim-last-session-v1");
    useAppStore.getState().loadSimulationPreset(createdId as string);

    const raw = storage.mock.getItem("linksim-last-session-v1");
    expect(raw).toBeTruthy();
    expect(raw).toContain(createdId as string);
  });
});

describe("appStore blank simulation loading", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "owner",
        avatarUrl: "",
        role: "user",
        accountState: "approved",
        isApproved: true,
        isAdmin: false,
        isModerator: false,
        createdAt: "",
        updatedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        email: undefined,
        emailPublic: true,
        bio: "",
      },
      selectedScenarioId: "starter-default",
      sites: [],
      links: [],
      simulationPresets: [],
    });
  });

  it("persists last-session selection when loading a blank saved simulation", () => {
    const createdId = useAppStore
      .getState()
      .createBlankSimulationPreset("Blank Session", { visibility: "private", ownerUserId: "owner-1" });
    expect(createdId).toBeTruthy();

    storage.mock.removeItem("linksim-last-session-v1");
    useAppStore.getState().loadSimulationPreset(createdId as string);

    const raw = storage.mock.getItem("linksim-last-session-v1");
    expect(raw).toBeTruthy();
    expect(raw).toContain(createdId as string);
  });
});
