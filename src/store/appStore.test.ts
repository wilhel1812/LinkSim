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

import { useAppStore } from "./appStore";

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
            sites: [],
            links: [],
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
            mapViewport: useAppStore.getState().mapViewport,
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
});
