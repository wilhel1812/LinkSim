import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchResourceChangesMock,
  revertResourceFromChangeCopyMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchResourceChangesMock: vi.fn(),
  revertResourceFromChangeCopyMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchResourceChanges: fetchResourceChangesMock,
  revertResourceFromChangeCopy: revertResourceFromChangeCopyMock,
}));

import { onRequestGet, onRequestPost } from "./changes";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkGetCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);
const mkPostCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue({ id: "u1", isAdmin: false, isModerator: true });
  fetchResourceChangesMock.mockResolvedValue({ ok: true, changes: [{ id: 1, action: "updated" }] });
  revertResourceFromChangeCopyMock.mockResolvedValue({ ok: true });
});

describe("api/changes", () => {
  it("returns 401 when not authenticated", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestGet(mkGetCtx(new Request("https://example.test/api/changes?kind=site&id=s1")));
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unauthenticated revert", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestPost(mkPostCtx(new Request("https://example.test/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "site", id: "s1", changeId: 7 }),
    })));

    expect(res.status).toBe(401);
    expect(revertResourceFromChangeCopyMock).not.toHaveBeenCalled();
  });

  it("returns 400 when kind or id are missing/invalid", async () => {
    const res = await onRequestGet(mkGetCtx(new Request("https://example.test/api/changes?kind=bad&id=")));
    expect(res.status).toBe(400);
  });

  it("returns 400 when revert input is missing or invalid", async () => {
    const res = await onRequestPost(mkPostCtx(new Request("https://example.test/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "bad", id: "", changeId: "invalid" }),
    })));

    expect(res.status).toBe(400);
    expect(revertResourceFromChangeCopyMock).not.toHaveBeenCalled();
  });

  it("returns changes for valid kind and id", async () => {
    const res = await onRequestGet(mkGetCtx(new Request("https://example.test/api/changes?kind=simulation&id=sim-1")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ changes: [{ id: 1, action: "updated" }] });
    expect(fetchResourceChangesMock).toHaveBeenCalledWith(env, "simulation", "sim-1", {
      id: "u1",
      isAdmin: false,
      isModerator: true,
    });
  });

  it.each([
    ["missing", 404],
    ["forbidden", 403],
  ] as const)("maps a %s resource result without returning history", async (reason, status) => {
    fetchResourceChangesMock.mockResolvedValueOnce({ ok: false, reason });

    const res = await onRequestGet(mkGetCtx(new Request("https://example.test/api/changes?kind=site&id=s1")));

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ error: reason === "missing" ? "Resource not found" : "Forbidden" });
  });

  it("authorizes reverts with the complete current actor policy", async () => {
    const res = await onRequestPost(mkPostCtx(new Request("https://example.test/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "site", id: "s1", changeId: 7 }),
    })));

    expect(res.status).toBe(200);
    expect(revertResourceFromChangeCopyMock).toHaveBeenCalledWith(env, "site", "s1", 7, {
      id: "u1",
      isAdmin: false,
      isModerator: true,
    });
  });

  it.each([
    ["missing", 404],
    ["forbidden", 403],
  ] as const)("maps a %s revert result", async (reason, status) => {
    revertResourceFromChangeCopyMock.mockResolvedValueOnce({ ok: false, reason });

    const res = await onRequestPost(mkPostCtx(new Request("https://example.test/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "simulation", id: "sim-1", changeId: 7 }),
    })));

    expect(res.status).toBe(status);
  });
});
