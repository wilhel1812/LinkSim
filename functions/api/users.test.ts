import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, assertUserAccessMock, fetchUserProfileMock, listUsersMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(), ensureUserMock: vi.fn(), assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(), listUsersMock: vi.fn(),
}));
vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock, assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock, listUsers: listUsersMock,
}));

import { onRequestGet } from "./users";

const env = { DB: {} } as unknown as Parameters<typeof onRequestGet>[0]["env"];

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "moderator", tokenPayload: {}, source: "jwt" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  listUsersMock.mockResolvedValue([]);
});

describe("users directory email privacy", () => {
  it("does not request hidden email for moderators", async () => {
    fetchUserProfileMock.mockResolvedValue({ id: "moderator", isAdmin: false, isModerator: true });
    const response = await onRequestGet({ request: new Request("https://example.test/api/users"), env } as never);
    expect(response.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith(env, false);
  });

  it("allows administrators to receive hidden email", async () => {
    fetchUserProfileMock.mockResolvedValue({ id: "admin", isAdmin: true, isModerator: false });
    const response = await onRequestGet({ request: new Request("https://example.test/api/users"), env } as never);
    expect(response.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith(env, true);
  });
});
