import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, assertUserAccessMock, fetchUserProfileMock, sendAccessGrantedEmailMock } =
  vi.hoisted(() => ({
    verifyAuthMock: vi.fn(),
    ensureUserMock: vi.fn(),
    assertUserAccessMock: vi.fn(),
    fetchUserProfileMock: vi.fn(),
    sendAccessGrantedEmailMock: vi.fn(),
  }));

vi.mock("../_lib/auth", () => ({
  verifyAuth: verifyAuthMock,
}));

vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
}));

vi.mock("../_lib/access-grant-email", () => ({
  sendAccessGrantedEmail: sendAccessGrantedEmailMock,
}));

import { onRequestPost } from "./admin-email-test";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "admin", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({
    id: "admin",
    username: "Admin User",
    email: "admin@example.com",
    idpEmail: "admin-idp@example.com",
    isAdmin: true,
    isModerator: false,
    isApproved: true,
  });
  sendAccessGrantedEmailMock.mockResolvedValue({ sent: true });
});

describe("api/admin-email-test", () => {
  it("returns 403 for non-admin user", async () => {
    fetchUserProfileMock.mockResolvedValue({
      id: "u1",
      username: "User",
      email: "u1@example.com",
      isAdmin: false,
      isModerator: false,
      isApproved: true,
    });
    const req = new Request("https://example.test/api/admin-email-test", { method: "POST" });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(403);
    expect(sendAccessGrantedEmailMock).not.toHaveBeenCalled();
  });

  it("sends test email to admin preferred email", async () => {
    const req = new Request("https://example.test/api/admin-email-test", { method: "POST" });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, result: { sent: true } });
    expect(sendAccessGrantedEmailMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        userId: "admin",
        email: "admin@example.com",
        approvedByUserId: "admin",
      }),
    );
  });
});
