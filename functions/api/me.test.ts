import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, fetchUserProfileMock, updateUserProfileMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  updateUserProfileMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  fetchUserProfile: fetchUserProfileMock,
  updateUserProfile: updateUserProfileMock,
}));

import { onRequestGet, onRequestPatch } from "./me";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({ id: "u1", username: "User One" });
  updateUserProfileMock.mockResolvedValue({ id: "u1", username: "Updated" });
});

describe("api/me", () => {
  it("returns no-store on GET", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/me")));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns no-store on PATCH", async () => {
    const req = new Request("https://example.test/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "Updated" }),
    });
    const res = await onRequestPatch(mkCtx(req));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
