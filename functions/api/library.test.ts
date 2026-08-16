import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchLibraryForUserMock,
  upsertLibrarySnapshotMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchLibraryForUserMock: vi.fn(),
  upsertLibrarySnapshotMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchLibraryForUser: fetchLibraryForUserMock,
  upsertLibrarySnapshot: upsertLibrarySnapshotMock,
}));

import { onRequestGet, onRequestPut } from "./library";
import { LIBRARY_BATCH_MAX_RECORDS, LIBRARY_REQUEST_MAX_BYTES } from "../../src/lib/libraryLimits";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

const validSite = (id = "site-1") => ({
  id,
  name: "Hilltop",
  visibility: "private",
  sharedWith: [],
  position: { lat: 59.9, lon: 10.7 },
  groundElevationM: 120,
  antennaHeightM: 12,
  txPowerDbm: 22,
  txGainDbi: 5,
  rxGainDbi: 5,
  cableLossDb: 1,
  createdAt: "2026-08-14T00:00:00.000Z",
});

const validSimulation = (updatedAt: unknown) => ({
  id: "sim-1",
  name: "Relay plan",
  visibility: "private",
  sharedWith: [],
  updatedAt,
  snapshot: { sites: [], links: [], systems: [], networks: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue({ id: "u1", isAdmin: false, isModerator: false });
  fetchLibraryForUserMock.mockResolvedValue({ siteLibrary: [{ id: "s1" }], simulationPresets: [] });
  upsertLibrarySnapshotMock.mockResolvedValue({ siteLibrary: [], simulationPresets: [], conflicts: [] });
});

describe("api/library", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/library")));
    expect(res.status).toBe(401);
  });

  it("returns user library payload on GET", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/library")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ userId: "u1", siteLibrary: [{ id: "s1" }] });
  });

  it("preserves the complete legacy one-shot response unless pagination is explicitly requested", async () => {
    fetchLibraryForUserMock.mockResolvedValueOnce({
      siteLibrary: [{ id: "site-1" }],
      simulationPresets: [{ id: "sim-1" }],
      deletedSiteIds: ["site-deleted"],
      deletedSimulationIds: ["sim-deleted"],
      removedSiteIds: ["site-removed"],
      removedSimulationIds: ["sim-removed"],
    });
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/library")));
    expect(res.status).toBe(200);
    expect(fetchLibraryForUserMock).toHaveBeenCalledWith(env, "u1", { since: undefined });
    await expect(res.json()).resolves.toEqual({
      userId: "u1",
      siteLibrary: [{ id: "site-1" }],
      simulationPresets: [{ id: "sim-1" }],
      deletedSiteIds: ["site-deleted"],
      deletedSimulationIds: ["sim-deleted"],
      removedSiteIds: ["site-removed"],
      removedSimulationIds: ["sim-removed"],
      isDelta: false,
    });
  });

  it("passes since param to fetchLibraryForUser on GET", async () => {
    const since = "2026-01-01T00:00:00.000Z";
    const res = await onRequestGet(
      mkCtx(new Request(`https://example.test/api/library?since=${encodeURIComponent(since)}`)),
    );
    expect(res.status).toBe(200);
    expect(fetchLibraryForUserMock).toHaveBeenCalledWith(env, "u1", { since });
    const body = await res.json() as Record<string, unknown>;
    expect(body.isDelta).toBe(true);
  });

  it("passes undefined since when no query param on GET", async () => {
    await onRequestGet(mkCtx(new Request("https://example.test/api/library")));
    expect(fetchLibraryForUserMock).toHaveBeenCalledWith(env, "u1", { since: undefined });
    // isDelta should be falsy
  });

  it("uses bounded pagination when the new client opts in with a delta checkpoint", async () => {
    const since = "2026-01-01T00:00:00.000Z";
    const res = await onRequestGet(
      mkCtx(new Request(`https://example.test/api/library?pagination=v1&since=${encodeURIComponent(since)}`)),
    );
    expect(res.status).toBe(200);
    expect(fetchLibraryForUserMock).toHaveBeenCalledWith(env, "u1", expect.objectContaining({
      since, phase: "sites", afterId: "", limit: 20,
    }));
    await expect(res.json()).resolves.toMatchObject({ isDelta: true, syncCutoff: expect.any(String) });
  });

  it("rejects an oversized cursor before querying the Library", async () => {
    const res = await onRequestGet(
      mkCtx(new Request(`https://example.test/api/library?cursor=${"x".repeat(1025)}`)),
    );
    expect(res.status).toBe(400);
    expect(fetchLibraryForUserMock).not.toHaveBeenCalled();
  });

  it("returns a bounded cursor page with a server cutoff", async () => {
    fetchLibraryForUserMock.mockResolvedValueOnce({
      siteLibrary: [{ id: "s1" }],
      simulationPresets: [],
      deletedSiteIds: [],
      deletedSimulationIds: [],
      nextCursor: { phase: "sites", afterId: "s1" },
    });
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/library?pagination=v1")));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.syncCutoff).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(typeof body.nextCursor).toBe("string");
    expect(String(body.nextCursor).length).toBeLessThanOrEqual(1024);
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(LIBRARY_REQUEST_MAX_BYTES);
  });

  it("rejects malformed and differently authenticated cursors", async () => {
    const malformed = await onRequestGet(mkCtx(new Request("https://example.test/api/library?cursor=not-json")));
    expect(malformed.status).toBe(400);
    fetchLibraryForUserMock.mockResolvedValueOnce({
      siteLibrary: [{ id: "s1" }], simulationPresets: [], deletedSiteIds: [], deletedSimulationIds: [],
      nextCursor: { phase: "sites", afterId: "s1" },
    });
    const first = await onRequestGet(mkCtx(new Request("https://example.test/api/library?pagination=v1")));
    const cursor = String((await first.json() as { nextCursor?: unknown }).nextCursor);
    verifyAuthMock.mockResolvedValueOnce({ userId: "u2", tokenPayload: {}, source: "headers" });
    const mismatched = await onRequestGet(mkCtx(new Request(`https://example.test/api/library?cursor=${encodeURIComponent(cursor)}`)));
    expect(mismatched.status).toBe(400);
  });

  it("rejects non-canonical timestamps before querying the Library", async () => {
    const res = await onRequestGet(
      mkCtx(new Request("https://example.test/api/library?since=August%2014%2C%202026")),
    );
    expect(res.status).toBe(400);
    expect(fetchLibraryForUserMock).not.toHaveBeenCalled();
  });

  it("packs the exact serialized envelope under 2 MiB and resumes after the last emitted ID", async () => {
    fetchLibraryForUserMock.mockResolvedValueOnce({
      siteLibrary: Array.from({ length: 20 }, (_, index) => ({ id: `s${String(index).padStart(2, "0")}`, padding: "x".repeat(150_000) })),
      simulationPresets: [], deletedSiteIds: [], deletedSimulationIds: [],
      nextCursor: { phase: "sites", afterId: "s19" },
    });
    const first = await onRequestGet(mkCtx(new Request("https://example.test/api/library?pagination=v1")));
    const firstText = await first.text();
    expect(new TextEncoder().encode(firstText).byteLength).toBeLessThanOrEqual(LIBRARY_REQUEST_MAX_BYTES);
    const body = JSON.parse(firstText) as { siteLibrary: Array<{ id: string }>; nextCursor: string };
    expect(body.siteLibrary.length).toBeGreaterThan(0);
    expect(body.siteLibrary.length).toBeLessThan(20);

    fetchLibraryForUserMock.mockResolvedValueOnce({ siteLibrary: [], simulationPresets: [], deletedSiteIds: [], deletedSimulationIds: [] });
    await onRequestGet(mkCtx(new Request(`https://example.test/api/library?cursor=${encodeURIComponent(body.nextCursor)}`)));
    expect(fetchLibraryForUserMock).toHaveBeenLastCalledWith(env, "u1", expect.objectContaining({
      phase: "sites", afterId: body.siteLibrary.at(-1)?.id,
    }));
  });

  it("fails instead of returning a non-advancing cursor for one oversized legacy record", async () => {
    fetchLibraryForUserMock.mockResolvedValueOnce({
      siteLibrary: [{ id: "oversized", padding: "x".repeat(LIBRARY_REQUEST_MAX_BYTES) }],
      simulationPresets: [], deletedSiteIds: [], deletedSimulationIds: [],
    });
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/library?pagination=v1")));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: "record_too_large" });
  });

  it("rejects non-array Library collections on PUT", async () => {
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteLibrary: { bad: true }, simulationPresets: null }),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(422);
    expect(upsertLibrarySnapshotMock).not.toHaveBeenCalled();
  });

  it("rejects a declared body larger than the approved limit before parsing", async () => {
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "content-length": String(LIBRARY_REQUEST_MAX_BYTES + 1),
      },
      body: "{}",
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(413);
    expect(upsertLibrarySnapshotMock).not.toHaveBeenCalled();
  });

  it("rejects JSON nested beyond the approved depth", async () => {
    let nested: unknown = "leaf";
    for (let index = 0; index < 21; index += 1) nested = { nested };
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nested),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(422);
    expect(upsertLibrarySnapshotMock).not.toHaveBeenCalled();
  });

  it("rejects more than the approved number of records instead of truncating", async () => {
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteLibrary: Array.from({ length: LIBRARY_BATCH_MAX_RECORDS + 1 }, (_, index) => validSite(`site-${index}`)),
        simulationPresets: [],
      }),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(422);
    expect(upsertLibrarySnapshotMock).not.toHaveBeenCalled();
  });

  it.each([undefined, { unsafe: true }])(
    "rejects a missing or malformed render-critical Simulation updatedAt (%j)",
    async (updatedAt) => {
      const simulation = validSimulation(updatedAt);
      if (updatedAt === undefined) delete (simulation as { updatedAt?: unknown }).updatedAt;
      const req = new Request("https://example.test/api/library", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteLibrary: [], simulationPresets: [simulation] }),
      });

      const res = await onRequestPut(mkCtx(req));
      expect(res.status).toBe(422);
      expect(upsertLibrarySnapshotMock).not.toHaveBeenCalled();
    },
  );

  it("passes a validated Library batch to the existing database helper", async () => {
    const site = validSite();
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteLibrary: [site], simulationPresets: [] }),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(200);
    expect(upsertLibrarySnapshotMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: "u1" }),
      { siteLibrary: [site], simulationPresets: [] },
    );
  });

  it("accepts previously supported non-empty Site and Simulation name lengths", async () => {
    const longName = "L".repeat(160);
    const sites = [
      { ...validSite("site-short"), name: "X" },
      { ...validSite("site-long"), name: longName },
    ];
    const simulations = [
      { ...validSimulation("2026-08-14T00:00:00.000Z"), id: "sim-short", name: "X" },
      { ...validSimulation("2026-08-14T00:00:00.000Z"), id: "sim-long", name: longName },
    ];
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteLibrary: sites, simulationPresets: simulations }),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(200);
    expect(upsertLibrarySnapshotMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: "u1" }),
      { siteLibrary: sites, simulationPresets: simulations },
    );
  });

  it("accepts legacy Simulation snapshots without Radio Systems or Networks", async () => {
    const withoutSystems = validSimulation("2026-08-14T00:00:00.000Z") as {
      id: string;
      snapshot: Record<string, unknown>;
    };
    withoutSystems.id = "sim-without-systems";
    delete withoutSystems.snapshot.systems;
    const withoutNetworks = validSimulation("2026-08-14T00:00:00.000Z") as {
      id: string;
      snapshot: Record<string, unknown>;
    };
    withoutNetworks.id = "sim-without-networks";
    delete withoutNetworks.snapshot.networks;
    const simulations = [withoutSystems, withoutNetworks];
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteLibrary: [], simulationPresets: simulations }),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(200);
    expect(upsertLibrarySnapshotMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: "u1" }),
      { siteLibrary: [], simulationPresets: simulations },
    );
  });
});
