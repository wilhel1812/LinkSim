import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchUserProfileMock,
  updateUserProfileMock,
  setUserAdminFlagMock,
  setUserApprovalMock,
  deleteUserMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  updateUserProfileMock: vi.fn(),
  setUserAdminFlagMock: vi.fn(),
  setUserApprovalMock: vi.fn(),
  deleteUserMock: vi.fn(),
}));

vi.mock("../../_lib/auth", () => ({
  verifyAuth: verifyAuthMock,
}));

vi.mock("../../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
  updateUserProfile: updateUserProfileMock,
  setUserAdminFlag: setUserAdminFlagMock,
  setUserApproval: setUserApprovalMock,
  deleteUser: deleteUserMock,
}));

import { onRequestDelete, onRequestGet, onRequestPatch } from "./[id]";

const env = { DB: {} } as unknown as { DB: D1Database };

const mkCtx = (request: Request, params: Record<string, string>) =>
  ({ request, env, params } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "admin", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({
    id: "admin",
    username: "Admin",
    email: "admin@example.com",
    bio: "",
    avatarUrl: "",
    isAdmin: true,
    isApproved: true,
    accountState: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
});

describe("users/[id] auth and permission guards", () => {
  it("blocks self role change", async () => {
    const req = new Request("https://example.test/api/users/admin", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isAdmin: false }),
    });

    fetchUserProfileMock.mockResolvedValueOnce({
      id: "admin",
      username: "Admin",
      email: "admin@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: true,
      isApproved: true,
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      id: "admin",
      username: "Admin",
      email: "admin@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: true,
      isApproved: true,
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await onRequestPatch(mkCtx(req, { id: "admin" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Users cannot change their own admin role." });
  });

  it("blocks self delete", async () => {
    const req = new Request("https://example.test/api/users/admin", { method: "DELETE" });
    const res = await onRequestDelete(mkCtx(req, { id: "admin" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Admin cannot delete own account." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("returns redacted profile for non-admin requesting another user", async () => {
    const req = new Request("https://example.test/api/users/u2", { method: "GET" });
    fetchUserProfileMock.mockResolvedValueOnce({
      id: "u1",
      username: "User One",
      email: "u1@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isApproved: true,
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      id: "u2",
      username: "User Two",
      email: "u2@example.com",
      bio: "bio",
      avatarUrl: "https://example.test/avatar.png",
      isAdmin: false,
      isApproved: true,
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await onRequestGet(mkCtx(req, { id: "u2" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      id: "u2",
      username: "User Two",
      bio: "bio",
      avatarUrl: "https://example.test/avatar.png",
      isAdmin: false,
      isApproved: true,
    });
    expect(body.user.email).toBeUndefined();
  });
});
