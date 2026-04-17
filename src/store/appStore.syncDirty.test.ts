import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudUser } from "../lib/cloudUser";

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

const mkUser = (): CloudUser => ({
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

const baselinePayload: any = {
  siteLibrary: [],
  simulationPresets: [
    {
      id: "sim-1",
      name: "Simulation One",
      slug: "simulation-one",
      slugAliases: [],
      visibility: "shared",
      sharedWith: [],
      ownerUserId: "owner-1",
      createdByUserId: "owner-1",
      createdByName: "owner",
      createdByAvatarUrl: "",
      lastEditedByUserId: "owner-1",
      lastEditedByName: "owner",
      lastEditedByAvatarUrl: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
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
        propagationEnvironment: {
          radioClimate: "Continental Temperate",
          polarization: "Vertical",
          clutterHeightM: 3,
          groundDielectric: 15,
          groundConductivity: 0.005,
          atmosphericBendingNUnits: 301,
        },
        autoPropagationEnvironment: true,
        terrainDataset: "copernicus30",
      },
      effectiveRole: "owner",
    },
  ],
};

const makeResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  }) as Response;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("appStore delta sync", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes a newly added site in the next delta sync payload", async () => {
    const fetchBodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/library") && method === "GET") {
        return makeResponse(cloneJson(baselinePayload));
      }
      if (url.includes("/api/library") && method === "PUT") {
        fetchBodies.push(String(init?.body ?? ""));
        return makeResponse({ ok: true, conflicts: [] });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await import("./appStore");
    useAppStore.setState({
      currentUser: mkUser(),
      authState: "signed_in",
      selectedScenarioId: "sim-1",
      selectedSiteId: "",
      selectedSiteIds: [],
      selectedLinkId: "",
      selectedNetworkId: "",
      sites: [],
      links: [],
      systems: [],
      networks: [],
      siteLibrary: [],
      simulationPresets: cloneJson(baselinePayload.simulationPresets),
      syncStatus: "synced",
      syncPending: false,
      syncBusy: false,
      isInitializing: false,
      isOnline: true,
    });

    await useAppStore.getState().initializeCloudSync();

    useAppStore.getState().addSiteByCoordinates("Gamma", 3, 3);
    const addedSiteId = useAppStore.getState().siteLibrary[0]?.id;
    expect(addedSiteId).toMatch(/^libsite-/);

    useAppStore.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();

    expect(fetchBodies).toHaveLength(1);
    const payload = JSON.parse(fetchBodies[0]) as { siteLibrary: Array<{ id: string; name: string }>; simulationPresets: unknown[] };
    expect(payload.siteLibrary).toHaveLength(1);
    expect(payload.siteLibrary[0]?.id).toBe(addedSiteId);
    expect(payload.siteLibrary[0]?.name).toBe("Gamma");
  });
});
