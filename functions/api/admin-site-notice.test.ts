import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchUserProfileMock,
  readSiteNoticeMock,
  publishSiteNoticeMock,
  clearSiteNoticeMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  readSiteNoticeMock: vi.fn(),
  publishSiteNoticeMock: vi.fn(),
  clearSiteNoticeMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
}));
vi.mock("../_lib/siteNotice", () => ({
  readSiteNotice: readSiteNoticeMock,
  publishSiteNotice: publishSiteNoticeMock,
  clearSiteNotice: clearSiteNoticeMock,
}));

import { onRequestDelete, onRequestGet, onRequestPut } from "./admin-site-notice";

const env = { DB: {} } as unknown as Parameters<typeof onRequestGet>[0]["env"];
const context = (request: Request) => ({ request, env } as never);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "admin-1", tokenPayload: {}, source: "jwt" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({ id: "admin-1", isAdmin: true });
  readSiteNoticeMock.mockResolvedValue(null);
  publishSiteNoticeMock.mockResolvedValue({ revision: 2 });
  clearSiteNoticeMock.mockResolvedValue({ revision: 3 });
});

describe("admin site notice API", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    expect((await onRequestGet(context(new Request("https://example.test/api/admin-site-notice")))).status).toBe(401);

    fetchUserProfileMock.mockResolvedValueOnce({ id: "user-1", isAdmin: false });
    expect((await onRequestGet(context(new Request("https://example.test/api/admin-site-notice")))).status).toBe(403);
  });

  it("publishes a bounded JSON draft with the authenticated admin actor", async () => {
    const draft = {
      active: true,
      tone: "warning",
      message: "Registration is temporarily closed.",
      dismissible: false,
      startsAt: null,
      expiresAt: null,
    };
    const response = await onRequestPut(context(new Request("https://example.test/api/admin-site-notice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    })));

    expect(response.status).toBe(200);
    expect(publishSiteNoticeMock).toHaveBeenCalledWith(env, draft, {
      actorId: "admin-1",
      source: "admin-panel",
    });
  });

  it("removes the notice with an audited admin actor", async () => {
    const response = await onRequestDelete(context(new Request("https://example.test/api/admin-site-notice", {
      method: "DELETE",
    })));

    expect(response.status).toBe(200);
    expect(clearSiteNoticeMock).toHaveBeenCalledWith(env, {
      actorId: "admin-1",
      source: "admin-panel",
    });
  });
});
