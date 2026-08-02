import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const mock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
  vi.stubGlobal("localStorage", mock);
  vi.stubGlobal("window", { localStorage: mock, setTimeout, clearTimeout });
  return { mock };
});

vi.mock("../lib/coverage", () => ({ buildCoverage: vi.fn(() => []) }));
vi.mock("../lib/elevationService", () => ({ fetchElevations: vi.fn(async () => [123]) }));

import { useAppStore } from "./appStore";

const owner = {
  id: "owner-1",
  username: "owner",
  avatarUrl: "",
  role: "user" as const,
  accountState: "approved" as const,
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
};

const sites = [
  { id: "site-a", name: "A", position: { lat: 60, lon: 10 }, groundElevationM: 100, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
  { id: "site-b", name: "B", position: { lat: 60.1, lon: 10.1 }, groundElevationM: 110, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1 },
];

const link = { id: "link-a", name: "A to B", fromSiteId: "site-a", toSiteId: "site-b", frequencyMHz: 869.618 };

describe("appStore simulation colors", () => {
  beforeEach(() => {
    storage.mock.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    const base = useAppStore.getState();
    useAppStore.setState({
      currentUser: owner,
      selectedScenarioId: "sim-a",
      sites,
      links: [link],
      linkColorMode: "manual",
      siteIconColors: {},
      simulationPresets: [{
        id: "sim-a",
        name: "Simulation A",
        ownerUserId: owner.id,
        effectiveRole: "owner",
        updatedAt: "2026-01-01T00:00:00.000Z",
        snapshot: {
          sites,
          links: [link],
          systems: [],
          networks: [],
          selectedSiteId: "site-a",
          selectedLinkId: "link-a",
          selectedNetworkId: "",
          propagationModel: "ITM",
          selectedFrequencyPresetId: "custom",
          rxSensitivityTargetDbm: -120,
          environmentLossDb: 0,
          propagationEnvironment: base.propagationEnvironment,
          autoPropagationEnvironment: false,
          terrainDataset: "copernicus30",
        },
      }],
    });
  });

  it("persists mode and per-site colors in the active Simulation snapshot", () => {
    useAppStore.getState().updateSimulationPresetEntry("sim-a", {
      linkColorMode: "auto",
      siteIconColors: { "site-a": "#ABC" },
    });

    const snapshot = useAppStore.getState().simulationPresets[0]?.snapshot;
    expect(snapshot?.linkColorMode).toBe("auto");
    expect(snapshot?.siteIconColors).toEqual({ "site-a": "#aabbcc" });
    expect(useAppStore.getState().siteLibrary.every((entry) => !("color" in entry))).toBe(true);
  });

  it("loads legacy Simulations with manual themed colors", () => {
    useAppStore.setState({ linkColorMode: "auto", siteIconColors: { "site-a": "#123456" } });
    useAppStore.getState().loadSimulationPreset("sim-a");
    expect(useAppStore.getState().linkColorMode).toBe("manual");
    expect(useAppStore.getState().siteIconColors).toEqual({});
  });

  it("persists normalized manual Link colors through updateLink", () => {
    useAppStore.getState().updateLink("link-a", { color: "#F00" });
    expect(useAppStore.getState().links[0]?.color).toBe("#ff0000");
    expect(useAppStore.getState().simulationPresets[0]?.snapshot.links[0]?.color).toBe("#ff0000");
  });
});
