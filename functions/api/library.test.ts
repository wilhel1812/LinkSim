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
});
