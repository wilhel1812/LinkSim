import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, assertUserAccessMock, fetchResourceChangesMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchResourceChangesMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchResourceChanges: fetchResourceChangesMock,
}));

import { onRequestGet } from "./changes";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchResourceChangesMock.mockResolvedValue([{ id: 1, action: "updated" }]);
});

describe("api/changes", () => {
  it("returns 401 when not authenticated", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/changes?kind=site&id=s1")));
    expect(res.status).toBe(401);
  });

  it("returns 400 when kind or id are missing/invalid", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/changes?kind=bad&id=")));
    expect(res.status).toBe(400);
  });

  it("returns changes for valid kind and id", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/changes?kind=simulation&id=sim-1")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ changes: [{ id: 1, action: "updated" }] });
    expect(fetchResourceChangesMock).toHaveBeenCalledWith(env, "simulation", "sim-1");
  });
});
