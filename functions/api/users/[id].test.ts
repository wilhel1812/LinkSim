import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchUserProfileMock,
  updateUserProfileMock,
  setUserRoleMock,
  setUserApprovalMock,
  deleteUserMock,
  sendAccessGrantedEmailMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  updateUserProfileMock: vi.fn(),
  setUserRoleMock: vi.fn(),
  setUserApprovalMock: vi.fn(),
  deleteUserMock: vi.fn(),
  sendAccessGrantedEmailMock: vi.fn(),
}));

vi.mock("../../_lib/auth", () => ({
  verifyAuth: verifyAuthMock,
}));

vi.mock("../../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
  updateUserProfile: updateUserProfileMock,
  setUserRole: setUserRoleMock,
  setUserApproval: setUserApprovalMock,
  deleteUser: deleteUserMock,
}));

vi.mock("../../_lib/access-grant-email", () => ({
  sendAccessGrantedEmail: sendAccessGrantedEmailMock,
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
  sendAccessGrantedEmailMock.mockResolvedValue({ sent: true });
});

describe("users/[id] auth and permission guards", () => {
  it("blocks self role change", async () => {
    const req = new Request("https://example.test/api/users/admin", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user" }),
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
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "You cannot assign this role for the selected user." });
  });

  it("blocks self delete", async () => {
    const req = new Request("https://example.test/api/users/admin", { method: "DELETE" });
    const res = await onRequestDelete(mkCtx(req, { id: "admin" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Admin cannot delete own account." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("returns redacted profile with email when target opted public", async () => {
    const req = new Request("https://example.test/api/users/u2", { method: "GET" });
    fetchUserProfileMock.mockResolvedValueOnce({
      id: "u1",
      username: "User One",
      email: "u1@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isApproved: true,
      emailPublic: true,
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
      emailPublic: true,
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
      email: "u2@example.com",
      bio: "bio",
      avatarUrl: "https://example.test/avatar.png",
      isAdmin: false,
      isApproved: true,
    });
  });

  it("hides email in redacted profile when target opted private", async () => {
    const req = new Request("https://example.test/api/users/u2", { method: "GET" });
    fetchUserProfileMock.mockResolvedValueOnce({
      id: "u1",
      username: "User One",
      email: "u1@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isApproved: true,
      emailPublic: true,
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
      emailPublic: false,
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await onRequestGet(mkCtx(req, { id: "u2" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBeUndefined();
    expect(body.user.emailPublic).toBe(false);
  });

  it("sends access email when pending user is assigned moderator role", async () => {
    const req = new Request("https://example.test/api/users/u2", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "moderator" }),
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
      id: "u2",
      username: "User Two",
      email: "u2@example.com",
      idpEmail: "u2-idp@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isModerator: false,
      isApproved: false,
      role: "pending",
      accountState: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    setUserRoleMock.mockResolvedValue({
      id: "u2",
      username: "User Two",
      email: "u2@example.com",
      idpEmail: "u2-idp@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isModerator: true,
      isApproved: true,
      role: "moderator",
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await onRequestPatch(mkCtx(req, { id: "u2" }));
    expect(res.status).toBe(200);
    expect(sendAccessGrantedEmailMock).toHaveBeenCalledTimes(1);
    expect(sendAccessGrantedEmailMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ userId: "u2", role: "moderator", email: "u2@example.com", approvedByUserId: "admin" }),
    );
  });

  it("sends access email when pending user is approved via isApproved flag", async () => {
    const req = new Request("https://example.test/api/users/u3", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isApproved: true }),
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
      id: "u3",
      username: "User Three",
      email: "u3@example.com",
      idpEmail: "u3-idp@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isModerator: false,
      isApproved: false,
      role: "pending",
      accountState: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    setUserApprovalMock.mockResolvedValue({
      id: "u3",
      username: "User Three",
      email: "u3@example.com",
      idpEmail: "u3-idp@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isModerator: false,
      isApproved: true,
      role: "user",
      accountState: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await onRequestPatch(mkCtx(req, { id: "u3" }));
    expect(res.status).toBe(200);
    expect(sendAccessGrantedEmailMock).toHaveBeenCalledTimes(1);
    expect(sendAccessGrantedEmailMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ userId: "u3", role: "user", email: "u3@example.com", approvedByUserId: "admin" }),
    );
  });

  it("does not send access email when role remains pending", async () => {
    const req = new Request("https://example.test/api/users/u4", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "pending" }),
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
      id: "u4",
      username: "User Four",
      email: "u4@example.com",
      idpEmail: "u4-idp@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isModerator: false,
      isApproved: false,
      role: "pending",
      accountState: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    setUserRoleMock.mockResolvedValue({
      id: "u4",
      username: "User Four",
      email: "u4@example.com",
      idpEmail: "u4-idp@example.com",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isModerator: false,
      isApproved: false,
      role: "pending",
      accountState: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await onRequestPatch(mkCtx(req, { id: "u4" }));
    expect(res.status).toBe(200);
    expect(sendAccessGrantedEmailMock).not.toHaveBeenCalled();
  });
});
