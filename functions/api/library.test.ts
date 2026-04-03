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

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

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

  it("normalizes non-array payloads on PUT", async () => {
    const req = new Request("https://example.test/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteLibrary: { bad: true }, simulationPresets: null }),
    });

    const res = await onRequestPut(mkCtx(req));
    expect(res.status).toBe(200);
    expect(upsertLibrarySnapshotMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: "u1" }),
      { siteLibrary: [], simulationPresets: [] },
    );
  });
});
