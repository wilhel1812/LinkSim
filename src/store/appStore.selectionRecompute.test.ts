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
  return { mock };
});

vi.mock("../lib/coverage", () => ({
  buildCoverage: vi.fn(() => []),
}));

vi.mock("../lib/elevationService", () => ({
  fetchElevations: vi.fn(async () => [123]),
}));

const seedSelectionState = (useAppStore: { setState: (patch: Record<string, unknown>) => void }) => {
  useAppStore.setState({
    sites: [
      {
        id: "site-1",
        name: "Alpha",
        position: { lat: 59.91, lon: 10.75 },
        groundElevationM: 100,
        antennaHeightM: 10,
        txPowerDbm: 20,
        txGainDbi: 2,
        rxGainDbi: 2,
        cableLossDb: 1,
      },
      {
        id: "site-2",
        name: "Beta",
        position: { lat: 59.94, lon: 10.8 },
        groundElevationM: 120,
        antennaHeightM: 10,
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
    selectedLinkId: "",
    selectedSiteId: "site-1",
    selectedSiteIds: ["site-1"],
    mapOverlayMode: "passfail",
    profileCursorIndex: 0,
    temporaryDirectionReversed: false,
    endpointPickTarget: null,
  });
};

describe("appStore selection recompute triggers", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("triggers recompute for setSelectedLinkId only when selection state changes", async () => {
    const recomputeCoverage = vi.fn();
    vi.doMock("./coverageStore", () => ({
      useCoverageStore: {
        getState: () => ({ recomputeCoverage }),
      },
      setAppStoreBridge: vi.fn(),
    }));

    const { useAppStore } = await import("./appStore");
    seedSelectionState(useAppStore);

    useAppStore.getState().setSelectedLinkId("lnk-1");
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);

    useAppStore.getState().setSelectedLinkId("lnk-1");
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);
  });

  it("triggers recompute for setSelectedSiteId only when selection state changes", async () => {
    const recomputeCoverage = vi.fn();
    vi.doMock("./coverageStore", () => ({
      useCoverageStore: {
        getState: () => ({ recomputeCoverage }),
      },
      setAppStoreBridge: vi.fn(),
    }));

    const { useAppStore } = await import("./appStore");
    seedSelectionState(useAppStore);

    useAppStore.getState().setSelectedSiteId("site-2");
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);

    useAppStore.getState().setSelectedSiteId("site-2");
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);
  });

  it("triggers recompute for selectSiteById only when selection state changes", async () => {
    const recomputeCoverage = vi.fn();
    vi.doMock("./coverageStore", () => ({
      useCoverageStore: {
        getState: () => ({ recomputeCoverage }),
      },
      setAppStoreBridge: vi.fn(),
    }));

    const { useAppStore } = await import("./appStore");
    seedSelectionState(useAppStore);

    useAppStore.getState().selectSiteById("site-2");
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);

    useAppStore.getState().selectSiteById("site-2");
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);
  });

  it("triggers recompute for clearActiveSelection only when selection state changes", async () => {
    const recomputeCoverage = vi.fn();
    vi.doMock("./coverageStore", () => ({
      useCoverageStore: {
        getState: () => ({ recomputeCoverage }),
      },
      setAppStoreBridge: vi.fn(),
    }));

    const { useAppStore } = await import("./appStore");
    seedSelectionState(useAppStore);

    useAppStore.getState().clearActiveSelection();
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);

    useAppStore.getState().clearActiveSelection();
    expect(recomputeCoverage).toHaveBeenCalledTimes(1);
  });
});
