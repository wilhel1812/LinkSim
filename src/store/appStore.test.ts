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
            selectedCoverageMode: "BestSite",
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
