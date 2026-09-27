import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchUserProfileMock,
  listUsersMock,
  authMigrationSchemaAvailableMock,
  getAuthMigrationProgressMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(), ensureUserMock: vi.fn(), assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(), listUsersMock: vi.fn(), authMigrationSchemaAvailableMock: vi.fn(),
  getAuthMigrationProgressMock: vi.fn(),
}));
vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock, assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock, listUsers: listUsersMock,
  authMigrationSchemaAvailable: authMigrationSchemaAvailableMock,
  getAuthMigrationProgress: getAuthMigrationProgressMock,
}));

import { onRequestGet } from "./users";

const env = { DB: {} } as unknown as Parameters<typeof onRequestGet>[0]["env"];

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "moderator", tokenPayload: {}, source: "jwt" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  listUsersMock.mockResolvedValue([]);
  authMigrationSchemaAvailableMock.mockResolvedValue(true);
  getAuthMigrationProgressMock.mockResolvedValue({ migrated: 7, total: 11 });
});

describe("users directory email privacy", () => {
  it("does not request hidden email for moderators", async () => {
    fetchUserProfileMock.mockResolvedValue({ id: "moderator", isAdmin: false, isModerator: true });
    const response = await onRequestGet({ request: new Request("https://example.test/api/users"), env } as never);
    expect(response.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith(env, false, false);
    expect(getAuthMigrationProgressMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ users: [] });
  });

  it("allows administrators to receive hidden email", async () => {
    fetchUserProfileMock.mockResolvedValue({ id: "admin", isAdmin: true, isModerator: false });
    const response = await onRequestGet({ request: new Request("https://example.test/api/users"), env } as never);
    expect(response.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith(env, true, true);
    expect(getAuthMigrationProgressMock).toHaveBeenCalledWith(env.DB);
    await expect(response.json()).resolves.toEqual({
      users: [],
      authMigrationAggregateAvailable: true,
      authMigrationProgress: { migrated: 7, total: 11 },
    });
  });

  it("keeps the administrator directory available when the auth schema is absent", async () => {
    fetchUserProfileMock.mockResolvedValue({ id: "admin", isAdmin: true, isModerator: false });
    authMigrationSchemaAvailableMock.mockResolvedValue(false);

    const response = await onRequestGet({ request: new Request("https://example.test/api/users"), env } as never);

    expect(response.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith(env, true, false);
    expect(getAuthMigrationProgressMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ users: [], authMigrationAggregateAvailable: false });
  });
});
