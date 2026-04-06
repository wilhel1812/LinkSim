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
}));

vi.mock("../lib/elevationService", () => ({
  fetchElevations: vi.fn(async () => [123]),
}));

import { useAppStore } from "./appStore";
import { fetchElevations } from "../lib/elevationService";

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
            selectedCoverageResolution: "normal",
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
});

describe("appStore selected pair link resolution", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      selectedLinkId: "",
      selectedSiteIds: ["site-2", "site-1"],
      sites: [
        {
          id: "site-1",
          name: "Alpha",
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
          position: { lat: 2, lon: 2 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 21,
          txGainDbi: 3,
          rxGainDbi: 3,
          cableLossDb: 2,
        },
      ],
      links: [
        {
          id: "link-other",
          fromSiteId: "site-9",
          toSiteId: "site-10",
          frequencyMHz: 869.618,
          txPowerDbm: 5,
          txGainDbi: 1,
          rxGainDbi: 1,
          cableLossDb: 9,
        },
        {
          id: "link-primary",
          fromSiteId: "site-1",
          toSiteId: "site-2",
          frequencyMHz: 869.618,
          txPowerDbm: 30,
          txGainDbi: 9,
          rxGainDbi: 8,
          cableLossDb: 0.5,
        },
      ],
      networks: [
        {
          id: "network-1",
          name: "n1",
          frequencyMHz: 869.618,
          bandwidthKhz: 125,
          spreadFactor: 7,
          codingRate: 5,
          memberships: [],
        },
      ],
      selectedNetworkId: "network-1",
    });
  });

  it("returns saved pair link overrides when two-site selection has no selectedLinkId", () => {
    const selectedLink = useAppStore.getState().getSelectedLink();
    expect(selectedLink.id).toBe("link-primary");
    expect(selectedLink.txPowerDbm).toBe(30);
    expect(selectedLink.txGainDbi).toBe(9);
    expect(selectedLink.rxGainDbi).toBe(8);
    expect(selectedLink.cableLossDb).toBe(0.5);
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
