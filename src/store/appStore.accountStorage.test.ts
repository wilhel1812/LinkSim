import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudUser } from "../lib/cloudUser";
import type { PathLeaderboardCandidate } from "../types/pathLeaderboard";

const cloud = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn() }));
vi.mock("../lib/cloudLibrary", () => ({
  fetchCloudLibrary: cloud.fetch, pushCloudLibrary: cloud.push,
  deleteCloudSite: vi.fn(), deleteCloudSimulation: vi.fn(), restoreCloudSimulation: vi.fn(),
}));
const user = (id: string) => ({ id, username: id, accountState: "approved", isApproved: true,
  isAdmin: false, isModerator: false, role: "user" } as CloudUser);
const draft = { id: "draft", name: "Unsynced draft", position: { lat: 60, lon: 10 },
  groundElevationM: 100, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 0,
  createdAt: "2026-01-01T00:00:00Z" };
const activeKey = "linksim-library-active-account-v1";
const legacyKey = "linksim-library-legacy-backup-v1";
let data: Map<string, string>;
let backups: Map<string, string>;
let failCache: boolean;
let failLegacyBackup: boolean;
let failMarker: boolean;
let delayPut: (() => Promise<void>) | undefined;
let failAccountCache: boolean;

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  cloud.fetch.mockReset(); cloud.push.mockReset();
  data = new Map(); backups = new Map(); failLegacyBackup = true; failCache = false; failMarker = false; failAccountCache = false; delayPut = undefined;
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if ((failLegacyBackup && key === legacyKey && value.length > 256) || (failMarker && key === activeKey) ||
        (failAccountCache && key.startsWith("linksim-library-account-v1:") && value.length > 256)) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      data.set(key, value);
    },
    removeItem: (key: string) => data.delete(key), clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; },
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage, setTimeout, clearTimeout });
  vi.stubGlobal("caches", { open: vi.fn(async () => ({
    match: async (request: Request) => backups.has(request.url) ? new Response(backups.get(request.url)) : undefined,
    put: async (request: Request, response: Response) => {
      if (failCache) throw new DOMException("Quota exceeded", "QuotaExceededError");
      const encoded = await response.text();
      if (delayPut) await delayPut();
      backups.set(request.url, encoded);
    },
  })) });
  cloud.fetch.mockResolvedValue({ siteLibrary: [], simulationPresets: [], isDelta: true,
    deletedSiteIds: [], deletedSimulationIds: [], removedSiteIds: [], removedSimulationIds: [] });
  cloud.push.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const store = async () => {
  const { useAppStore } = await import("./appStore");
  useAppStore.setState({ siteLibrary: [draft], simulationPresets: [], sites: [], links: [],
    selectedScenarioId: "", currentUser: null, syncPending: true, pendingChangesCount: 1 });
  return useAppStore;
};

describe("account Library storage preparation", () => {
  it("preserves a full backup outside localStorage and completes account binding on quota failure", async () => {
    const app = await store();
    await app.getState().setCurrentUser(user("a"));
    expect(data.get(activeKey)).toBe("a");
    expect([...backups.values()].map((raw) => JSON.parse(raw).siteLibrary[0].name)).toContain("Unsynced draft");
    expect(app.getState().siteLibrary[0].name).toBe("Unsynced draft");
    expect(app.getState().currentUser?.id).toBe("a");
  });
  it("pauses all cloud sync and preserves live storage when both backup stores fail", async () => {
    const app = await store(); failCache = true;
    data.set("rmw-site-library-v1", JSON.stringify([draft]));
    await app.getState().setCurrentUser(user("a"));
    await app.getState().initializeCloudSync();
    await app.getState().performManualCloudSync();
    app.getState().performCloudSyncPush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(cloud.fetch).not.toHaveBeenCalled(); expect(cloud.push).not.toHaveBeenCalled();
    expect(data.has(activeKey)).toBe(false);
    expect(JSON.parse(data.get("rmw-site-library-v1")!)[0].name).toBe("Unsynced draft");
    expect(app.getState().syncErrorMessage).toMatch(/Library storage/i);
  });
  it("handles a quota failure writing the account marker without throwing or starting cloud sync", async () => {
    const app = await store(); failMarker = true;
    await expect(Promise.resolve(app.getState().setCurrentUser(user("a")))).resolves.toBe(false);
    await app.getState().initializeCloudSync();
    expect(cloud.fetch).not.toHaveBeenCalled();
    expect(app.getState().syncErrorMessage).toMatch(/Library storage/i);
  });
  it("cannot bind or revive a signed-out account after its delayed backup completes", async () => {
    const app = await store(); let release!: () => void;
    delayPut = () => new Promise<void>((resolve) => { release = resolve; });
    const preparation = app.getState().setCurrentUser(user("a"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await app.getState().setCurrentUser(null);
    release(); await preparation;
    expect(app.getState().currentUser).toBeNull(); expect(data.has(activeKey)).toBe(false);
  });
  it("restores separate account caches written through the quota fallback", async () => {
    const app = await store();
    await app.getState().setCurrentUser(user("a"));
    failAccountCache = true;
    await app.getState().setCurrentUser(user("b"));
    expect(app.getState().siteLibrary).toEqual([]);
    app.setState({ siteLibrary: [{ ...draft, id: "b-draft", name: "B draft" }] });
    await app.getState().setCurrentUser(user("a"));
    expect(app.getState().siteLibrary[0].name).toBe("Unsynced draft");
    await app.getState().setCurrentUser(user("b"));
    expect(app.getState().siteLibrary[0].name).toBe("B draft");
  });
});


it("recovers an interrupted account restore before capturing or syncing its Library", async () => {
  data.set(activeKey, "a");
  data.set("linksim-library-account-transition-v1", "a");
  data.set("rmw-site-library-v1", JSON.stringify([{ ...draft, name: "Partial B data" }]));
  data.set("linksim-library-account-v1:a", JSON.stringify({ siteLibrary: [draft], simulationPresets: [],
    syncDigest: null, lastFetchedAt: null, syncPending: true, pendingChangesCount: 1 }));
  const app = await store();
  app.setState({ siteLibrary: [{ ...draft, name: "Partial B data" }] });
  await app.getState().setCurrentUser(user("a"));
  expect(app.getState().siteLibrary[0].name).toBe("Unsynced draft");
  expect(data.has("linksim-library-account-transition-v1")).toBe(false);
  expect(app.getState().currentUser?.id).toBe("a");
});

it("does not treat an evicted recovery copy as an empty account Library", async () => {
  const app = await store();
  await app.getState().setCurrentUser(user("a")); failAccountCache = true;
  await app.getState().setCurrentUser(user("b"));
  backups.clear();
  await app.getState().setCurrentUser(user("a"));
  await app.getState().initializeCloudSync();
  expect(data.get(activeKey)).toBe("b");
  expect(app.getState().currentUser).toBeNull();
  expect(cloud.fetch).not.toHaveBeenCalled();
  expect(app.getState().syncErrorMessage).toMatch(/Library storage/i);
});

it("waits for the recovery copy before cloud initialization", async () => {
  const app = await store(); let release!: () => void;
  delayPut = () => new Promise<void>((resolve) => { release = resolve; });
  const preparation = app.getState().setCurrentUser(user("a"));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const initialization = app.getState().initializeCloudSync();
  await Promise.resolve(); expect(cloud.fetch).not.toHaveBeenCalled();
  release(); await preparation; await initialization;
  expect(data.get(activeKey)).toBe("a"); expect(cloud.fetch).toHaveBeenCalledTimes(1);
});

it("keeps the old account and data intact when the outgoing recovery copy fails", async () => {
  const app = await store();
  await app.getState().setCurrentUser(user("a"));
  data.set("rmw-site-library-v1", JSON.stringify([draft]));
  failAccountCache = true; failCache = true;
  await app.getState().setCurrentUser(user("b"));
  await app.getState().initializeCloudSync();
  expect(data.get(activeKey)).toBe("a");
  expect(JSON.parse(data.get("rmw-site-library-v1")!)[0].name).toBe("Unsynced draft");
  expect(cloud.fetch).not.toHaveBeenCalled(); expect(app.getState().currentUser).toBeNull();
});

it("does not commit a multi-key restore when the account marker write fails", async () => {
  const app = await store();
  await app.getState().setCurrentUser(user("a"));
  data.set("rmw-site-library-v1", JSON.stringify([draft]));
  failMarker = true;
  await app.getState().setCurrentUser(user("b"));
  expect(data.get(activeKey)).toBe("a");
  expect(data.get("linksim-library-account-transition-v1")).toBe("a");
  expect(cloud.fetch).not.toHaveBeenCalled();
  failMarker = false;
  await app.getState().setCurrentUser(user("a"));
  expect(app.getState().siteLibrary[0].name).toBe("Unsynced draft");
  expect(data.has("linksim-library-account-transition-v1")).toBe(false);
});


it("preserves an edit made while an outgoing account recovery copy is being written", async () => {
  const app = await store();
  await app.getState().setCurrentUser(user("a"));
  failAccountCache = true;
  let release!: () => void;
  delayPut = () => new Promise<void>((resolve) => { release = resolve; });
  const preparation = app.getState().setCurrentUser(user("b"));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  app.setState({ siteLibrary: [{ ...draft, name: "Late unsynced edit" }] });
  release(); await preparation;
  expect(data.get(activeKey)).toBe("a");
  expect(app.getState().siteLibrary[0].name).toBe("Late unsynced edit");
  expect(app.getState().currentUser).toBeNull();
  await app.getState().initializeCloudSync();
  expect(cloud.fetch).not.toHaveBeenCalled();
});


it("keeps healthy localStorage preparation working when optional CacheStorage is unavailable", async () => {
  failLegacyBackup = false;
  vi.stubGlobal("caches", { open: vi.fn().mockRejectedValue(new Error("Unavailable")) });
  const app = await store();
  expect(await app.getState().setCurrentUser(user("a"))).toBe(true);
  expect(data.get(activeKey)).toBe("a");
  expect(app.getState().currentUser?.id).toBe("a");
});

const setRetainedSimulation = (app: Awaited<ReturnType<typeof store>>, simulationId: string, updatedAt: string) => {
  const state = app.getState();
  app.setState({ simulationPresets: [{ id: simulationId, name: "Retained Simulation",
    updatedAt: updatedAt, ownerUserId: "a", effectiveRole: "owner", visibility: "public",
    snapshot: { sites: [draft], links: [], systems: [], networks: [], selectedSiteId: draft.id,
      selectedLinkId: "", selectedNetworkId: "", propagationModel: state.propagationModel,
      selectedFrequencyPresetId: state.selectedFrequencyPresetId, rxSensitivityTargetDbm: state.rxSensitivityTargetDbm,
      environmentLossDb: state.environmentLossDb, propagationEnvironment: state.propagationEnvironment,
      autoPropagationEnvironment: state.autoPropagationEnvironment, terrainDataset: state.terrainDataset } }] });
};

it("submits a retained Path only after sign-in initialization uploads its local revision", async () => {
  const { isPathLeaderboardReady, createPathLeaderboardSubmitter } = await import("../lib/pathLeaderboard");
  const app = await store();
  // A previous session can leave an analyzed local Path with no pending-sync flag.
  app.setState({ syncPending: false, syncBusy: false, isInitializing: false, isOnline: true });
  const candidate = { simulationId: "local-simulation", simulationUpdatedAt: "2026-10-14T10:00:00Z",
    fromSiteId: "a", toSiteId: "b", distanceKm: 20, rxAfterEnvLossDbm: -100, rxMarginDb: 20,
    terrainObstructed: false, terrainDataset: "srtm", terrainTileSignature: "terrain" };
  setRetainedSimulation(app, candidate.simulationId, candidate.simulationUpdatedAt);
  const submit = vi.fn(async (_candidate: PathLeaderboardCandidate) => ({ status: "stored" as const }));
  const submitPath = createPathLeaderboardSubmitter(submit);
  const unsubscribe = app.subscribe((state) => {
    if (isPathLeaderboardReady(state)) void submitPath("same-local-revision", candidate);
  });
  try {
    await app.getState().setCurrentUser(user("a"));
    // AppShell performs asynchronous migrations in this gap before initialization.
    expect(app.getState().authState).toBe("signed_in");
    expect(submit).not.toHaveBeenCalled();
    let releaseFetch!: (value: unknown) => void;
    const cloudData = await cloud.fetch();
    cloud.fetch.mockImplementationOnce(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const initialization = app.getState().initializeCloudSync();
    await vi.waitFor(() => expect(releaseFetch).toBeTypeOf("function"));
    expect(submit).not.toHaveBeenCalled();
    releaseFetch(cloudData);
    await initialization;
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(cloud.push).toHaveBeenCalledTimes(1);
    expect(cloud.push.mock.calls[0][0].simulationPresets).toEqual([expect.objectContaining({
      id: candidate.simulationId, updatedAt: candidate.simulationUpdatedAt,
    })]);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith(candidate));
    await app.getState().setCurrentUser(null);
    await app.getState().setCurrentUser(user("b"));
    expect(isPathLeaderboardReady(app.getState())).toBe(false);
  } finally { unsubscribe(); }
});

const syncedRetainedSimulation = async () => {
  const { isPathLeaderboardReady } = await import("../lib/pathLeaderboard");
  const app = await store();
  setRetainedSimulation(app, "local-simulation", "2026-01-01T00:00:00Z");
  app.setState({ isOnline: true });
  await app.getState().setCurrentUser(user("a"));
  await app.getState().initializeCloudSync();
  await vi.advanceTimersByTimeAsync(3000);
  await vi.waitFor(() => expect(isPathLeaderboardReady(app.getState())).toBe(true));
  app.setState({ selectedScenarioId: "local-simulation", sites: [draft] });
  return app;
};

it.each(["snapshot", "metadata", "rename", "overwrite", "save"].flatMap((mutation) =>
  [false, true].map((editDuringUpload) => ({ mutation, editDuringUpload })),
))("blocks $mutation edits until their revision uploads (edit during upload: $editDuringUpload)", async ({ mutation, editDuringUpload }) => {
  const { isPathLeaderboardReady, createPathLeaderboardSubmitter } = await import("../lib/pathLeaderboard");
  const app = await syncedRetainedSimulation();
  const originalRevision = app.getState().simulationPresets[0].updatedAt;
  const edit = () => {
    const state = app.getState();
    const preset = state.simulationPresets.find((entry) => entry.id === "local-simulation")!;
    if (mutation === "snapshot") state.updateCurrentSimulationSnapshot();
    else if (mutation === "metadata") state.updateSimulationPresetEntry(preset.id, { description: `Edited ${Date.now()}` });
    else if (mutation === "rename") state.renameSimulationPreset(preset.id, `Renamed ${Date.now()}`);
    else if (mutation === "overwrite") state.overwriteSimulationPreset(preset.id);
    else state.saveCurrentSimulationPreset(preset.name);
  };
  const submit = vi.fn(async (_candidate: PathLeaderboardCandidate) => ({ status: "stored" as const }));
  const submitPath = createPathLeaderboardSubmitter(submit);
  const unsubscribe = app.subscribe((state) => {
    const preset = state.simulationPresets[0];
    if (preset.updatedAt !== originalRevision && isPathLeaderboardReady(state)) {
      void submitPath(preset.updatedAt, { simulationId: preset.id, simulationUpdatedAt: preset.updatedAt,
        fromSiteId: "a", toSiteId: "b", distanceKm: 20, rxAfterEnvLossDbm: -100, rxMarginDb: 20,
        terrainObstructed: false, terrainDataset: "srtm", terrainTileSignature: "terrain" });
    }
  });
  try {
    edit();
    // No AppShell effect has scheduled a push yet.
    expect(isPathLeaderboardReady(app.getState())).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    let releasePush!: () => void;
    if (editDuringUpload) cloud.push.mockImplementationOnce(() => new Promise<void>((resolve) => { releasePush = resolve; }));
    expect(app.getState().pendingChangesCount).toBe(1);
    app.getState().performCloudSyncPush();
    expect(app.getState().pendingChangesCount).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    if (editDuringUpload) {
      await vi.waitFor(() => expect(releasePush).toBeTypeOf("function"));
      app.setState({ environmentLossDb: app.getState().environmentLossDb + 1 });
      edit();
      // Even when the parent effect is deferred, the old upload cannot clear this edit.
      releasePush();
      await vi.waitFor(() => expect(app.getState().syncBusy).toBe(false));
      expect(isPathLeaderboardReady(app.getState())).toBe(false);
      expect(submit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000);
    }
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const latest = app.getState().simulationPresets[0];
    expect(submit.mock.calls[0][0]).toEqual(expect.objectContaining({ simulationUpdatedAt: latest.updatedAt }));
    expect(cloud.push.mock.lastCall?.[0].simulationPresets).toEqual([expect.objectContaining({ updatedAt: latest.updatedAt })]);
  } finally { unsubscribe(); }
});

it.each(["copy", "blank", "saveNew", "restore"])("keeps %s revisions pending until their upload completes", async (mutation) => {
  const { isPathLeaderboardReady } = await import("../lib/pathLeaderboard");
  const app = await syncedRetainedSimulation();
  const state = app.getState();
  let id: string | null = "local-simulation";
  if (mutation === "copy") id = state.createSimulationCopyFromCurrent("New copy");
  else if (mutation === "blank") id = state.createBlankSimulationPreset("New blank");
  else if (mutation === "saveNew") id = state.saveCurrentSimulationPreset("New saved Simulation");
  else {
    app.setState({ currentUser: { ...user("a"), isAdmin: true } });
    await state.restoreSimulationPreset(id!);
  }
  expect(id).toBeTruthy();
  // The New Simulation/copy UI loads the result before AppShell schedules sync.
  app.getState().loadSimulationPreset(id!);
  expect(isPathLeaderboardReady(app.getState())).toBe(false);
  expect(app.getState().pendingChangesCount).toBe(1);
  app.getState().performCloudSyncPush();
  expect(app.getState().pendingChangesCount).toBe(1);
  await vi.advanceTimersByTimeAsync(3000);
  await vi.waitFor(() => expect(isPathLeaderboardReady(app.getState())).toBe(true));
  expect(cloud.push.mock.lastCall?.[0].simulationPresets).toContainEqual(expect.objectContaining({ id }));
});

it("counts a distinct Library edit during upload without acknowledging it with the older Simulation upload", async () => {
  const { isPathLeaderboardReady } = await import("../lib/pathLeaderboard");
  const app = await syncedRetainedSimulation();
  app.getState().updateSimulationPresetEntry("local-simulation", { description: "First edit" });
  let releasePush!: () => void;
  cloud.push.mockImplementationOnce(() => new Promise<void>((resolve) => { releasePush = resolve; }));
  app.getState().performCloudSyncPush();
  expect(app.getState().pendingChangesCount).toBe(1);
  await vi.advanceTimersByTimeAsync(3000);
  await vi.waitFor(() => expect(releasePush).toBeTypeOf("function"));
  // Model a separate Library mutation observed by the AppShell scheduling effect.
  app.setState({ siteLibrary: [{ ...draft, ownerUserId: "a", effectiveRole: "owner", name: "Distinct late edit" }] });
  app.getState().performCloudSyncPush();
  expect(app.getState().pendingChangesCount).toBe(2);
  // Repeating scheduling for the same inputs must not count either mutation again.
  app.getState().performCloudSyncPush();
  expect(app.getState().pendingChangesCount).toBe(2);
  releasePush();
  await vi.waitFor(() => expect(app.getState().syncBusy).toBe(false));
  expect(isPathLeaderboardReady(app.getState())).toBe(false);
  expect(app.getState().pendingChangesCount).toBe(1);
  await vi.advanceTimersByTimeAsync(3000);
  await vi.waitFor(() => expect(isPathLeaderboardReady(app.getState())).toBe(true));
  expect(cloud.push.mock.lastCall?.[0].siteLibrary).toContainEqual(expect.objectContaining({ name: "Distinct late edit" }));
});
