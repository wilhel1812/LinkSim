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

  it("applies a Site tombstone before a manual retry builds its push payload", async () => {
    const pushedBodies: Array<{ siteLibrary: Array<{ id: string }> }> = [];
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/library") && method === "GET") {
        getCount += 1;
        if (getCount === 2) {
          return makeResponse({
            ...cloneJson(baselinePayload),
            deletedSiteIds: ["site-deleted"],
            deletedSimulationIds: [],
          });
        }
        return makeResponse({ ...cloneJson(baselinePayload), deletedSiteIds: [], deletedSimulationIds: [] });
      }
      if (url.includes("/api/library") && method === "PUT") {
        pushedBodies.push(JSON.parse(String(init?.body ?? "{}")) as { siteLibrary: Array<{ id: string }> });
        return makeResponse({ ok: true, conflicts: [] });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await import("./appStore");
    useAppStore.setState({
      currentUser: mkUser(), authState: "signed_in", isOnline: true,
      siteLibrary: [], simulationPresets: cloneJson(baselinePayload.simulationPresets),
      sites: [], links: [], systems: [], networks: [],
      syncStatus: "synced", syncPending: false, syncBusy: false, isInitializing: false,
    });
    await useAppStore.getState().initializeCloudSync();
    useAppStore.setState({
      siteLibrary: [{
        id: "site-deleted", name: "Stale cached Site", ownerUserId: "owner-1", effectiveRole: "owner",
        createdAt: "2026-01-01T00:00:00.000Z", position: { lat: 60, lon: 11 }, groundElevationM: 100,
        antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
      }],
    });

    await useAppStore.getState().performManualCloudSync();

    expect(pushedBodies).toHaveLength(1);
    expect(pushedBodies[0]?.siteLibrary).toEqual([]);
    expect(useAppStore.getState().siteLibrary.some((site) => site.id === "site-deleted")).toBe(false);
  });

  it("preserves and follows up a same-record edit made during manual sync", async () => {
    const initialSite = {
      id: "site-manual", name: "Before", ownerUserId: "owner-1", effectiveRole: "owner" as const,
      createdAt: "2026-01-01T00:00:00.000Z", position: { lat: 60, lon: 11 }, groundElevationM: 100,
      antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
    };
    const pushedBodies: Array<{ siteLibrary: Array<{ id: string; name: string }> }> = [];
    let getCount = 0;
    let releaseFirstPush: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/library") && method === "GET") {
        getCount += 1;
        return makeResponse({
          ...cloneJson(baselinePayload),
          siteLibrary: getCount >= 3 ? [cloneJson(initialSite)] : [],
          deletedSiteIds: [], deletedSimulationIds: [], removedSiteIds: [], removedSimulationIds: [],
        });
      }
      if (url.includes("/api/library") && method === "PUT") {
        pushedBodies.push(JSON.parse(String(init?.body ?? "{}")) as { siteLibrary: Array<{ id: string; name: string }> });
        if (pushedBodies.length === 1) {
          return await new Promise<Response>((resolve) => { releaseFirstPush = resolve; });
        }
        return makeResponse({ ok: true, conflicts: [] });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useAppStore } = await import("./appStore");
    useAppStore.setState({
      currentUser: mkUser(), authState: "signed_in", isOnline: true,
      siteLibrary: [], simulationPresets: cloneJson(baselinePayload.simulationPresets),
      sites: [], links: [], systems: [], networks: [],
      syncStatus: "synced", syncPending: false, syncBusy: false, isInitializing: false,
    });
    await useAppStore.getState().initializeCloudSync();
    useAppStore.setState({ siteLibrary: [cloneJson(initialSite)] });

    const manualSync = useAppStore.getState().performManualCloudSync();
    await vi.waitFor(() => expect(pushedBodies).toHaveLength(1));
    useAppStore.getState().updateSiteLibraryEntry("site-manual", { name: "After" });
    useAppStore.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(2500);
    releaseFirstPush?.(makeResponse({ ok: true, conflicts: [] }));
    await manualSync;
    expect(useAppStore.getState().siteLibrary.find((site) => site.id === "site-manual")?.name).toBe("After");

    await vi.advanceTimersByTimeAsync(2500);
    await vi.waitFor(() => expect(pushedBodies).toHaveLength(2));
    expect(pushedBodies[1]?.siteLibrary).toEqual([expect.objectContaining({ id: "site-manual", name: "After" })]);
  });

  it("keeps a same-record edit pending when it changes during an in-flight push", async () => {
    const pushedBodies: Array<{ siteLibrary: Array<{ id: string; name: string }> }> = [];
    let releaseFirstPush: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/library") && method === "GET") {
        return makeResponse({ ...cloneJson(baselinePayload), deletedSiteIds: [], deletedSimulationIds: [] });
      }
      if (url.includes("/api/library") && method === "PUT") {
        pushedBodies.push(JSON.parse(String(init?.body ?? "{}")) as { siteLibrary: Array<{ id: string; name: string }> });
        if (pushedBodies.length === 1) {
          return await new Promise<Response>((resolve) => { releaseFirstPush = resolve; });
        }
        return makeResponse({ ok: true, conflicts: [] });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useAppStore } = await import("./appStore");
    useAppStore.setState({
      currentUser: mkUser(), authState: "signed_in", isOnline: true,
      siteLibrary: [], simulationPresets: cloneJson(baselinePayload.simulationPresets),
      sites: [], links: [], systems: [], networks: [],
      syncStatus: "synced", syncPending: false, syncBusy: false, isInitializing: false,
    });
    await useAppStore.getState().initializeCloudSync();
    useAppStore.getState().addSiteByCoordinates("First", 60, 10);
    const siteId = useAppStore.getState().siteLibrary[0]?.id as string;
    useAppStore.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(2500);
    expect(pushedBodies).toHaveLength(1);

    useAppStore.getState().updateSiteLibraryEntry(siteId, { name: "Second" });
    useAppStore.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(2500);
    releaseFirstPush?.(makeResponse({ ok: true, conflicts: [] }));
    await vi.waitFor(() => expect(useAppStore.getState().syncBusy).toBe(false));
    await vi.advanceTimersByTimeAsync(2500);
    await vi.waitFor(() => expect(pushedBodies).toHaveLength(2));
    await vi.waitFor(() => expect(useAppStore.getState().syncPending).toBe(false));

    expect(pushedBodies[0]?.siteLibrary[0]?.name).toBe("First");
    expect(pushedBodies[1]?.siteLibrary[0]?.name).toBe("Second");
  });

  it("automatically follows an in-flight push with a different newly dirty record", async () => {
    const pushedBodies: Array<{ siteLibrary: Array<{ id: string; name: string }> }> = [];
    let releaseFirstPush: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/library") && method === "GET") {
        return makeResponse({ ...cloneJson(baselinePayload), deletedSiteIds: [], deletedSimulationIds: [] });
      }
      if (url.includes("/api/library") && method === "PUT") {
        pushedBodies.push(JSON.parse(String(init?.body ?? "{}")) as { siteLibrary: Array<{ id: string; name: string }> });
        if (pushedBodies.length === 1) {
          return await new Promise<Response>((resolve) => { releaseFirstPush = resolve; });
        }
        return makeResponse({ ok: true, conflicts: [] });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useAppStore } = await import("./appStore");
    useAppStore.setState({
      currentUser: mkUser(), authState: "signed_in", isOnline: true,
      siteLibrary: [], simulationPresets: cloneJson(baselinePayload.simulationPresets),
      sites: [], links: [], systems: [], networks: [],
      syncStatus: "synced", syncPending: false, syncBusy: false, isInitializing: false,
    });
    await useAppStore.getState().initializeCloudSync();

    useAppStore.getState().addSiteByCoordinates("First", 60, 10);
    useAppStore.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(2500);
    expect(pushedBodies).toHaveLength(1);

    useAppStore.getState().addSiteByCoordinates("Second", 61, 11);
    useAppStore.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(2500);
    releaseFirstPush?.(makeResponse({ ok: true, conflicts: [] }));
    await vi.waitFor(() => expect(useAppStore.getState().syncBusy).toBe(false));
    await vi.advanceTimersByTimeAsync(2500);
    await vi.waitFor(() => expect(pushedBodies).toHaveLength(2));
    await vi.waitFor(() => expect(useAppStore.getState().syncPending).toBe(false));

    expect(pushedBodies[0]?.siteLibrary.map((site) => site.name)).toEqual(["First"]);
    expect(pushedBodies[1]?.siteLibrary.map((site) => site.name)).toEqual(["Second"]);
  });

  it("stores only the completed server recovery cutoff", async () => {
    let getCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/library") && (init?.method ?? "GET") === "GET") {
        getCount += 1;
        return makeResponse({
          ...cloneJson(baselinePayload), deletedSiteIds: [], deletedSimulationIds: [],
          syncCutoff: getCount === 1 ? "2026-08-14T10:00:00.000Z" : "2026-08-14T10:00:01.000Z",
          isDelta: getCount > 1,
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));
    const { useAppStore } = await import("./appStore");
    useAppStore.setState({ currentUser: mkUser(), authState: "signed_in", isOnline: true, isInitializing: false });

    await useAppStore.getState().initializeCloudSync();

    expect(localStorage.getItem("linksim-last-fetched-at-v1")).toBe("2026-08-14T10:00:01.000Z");
  });

  it("leaves the prior checkpoint unchanged when a later page fails", async () => {
    localStorage.setItem("linksim-last-fetched-at-v1", "2026-08-14T09:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [], simulationPresets: [], deletedSiteIds: [], deletedSimulationIds: [],
        syncCutoff: "2026-08-14T10:00:00.000Z", nextCursor: "page-two", isDelta: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unavailable" }), { status: 503, statusText: "Unavailable" })));
    const { useAppStore } = await import("./appStore");
    useAppStore.setState({ currentUser: mkUser(), authState: "signed_in", isOnline: true, isInitializing: false });

    await useAppStore.getState().initializeCloudSync();

    expect(localStorage.getItem("linksim-last-fetched-at-v1")).toBe("2026-08-14T09:00:00.000Z");
    expect(useAppStore.getState().syncStatus).toBe("error");
  });
});
