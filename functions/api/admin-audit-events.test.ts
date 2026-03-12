import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, assertUserAccessMock, fetchUserProfileMock, listAdminAuditEventsMock } = vi.hoisted(
  () => ({
    verifyAuthMock: vi.fn(),
    ensureUserMock: vi.fn(),
    assertUserAccessMock: vi.fn(),
    fetchUserProfileMock: vi.fn(),
    listAdminAuditEventsMock: vi.fn(),
  }),
);

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
  listAdminAuditEvents: listAdminAuditEventsMock,
}));

import { onRequestGet } from "./admin-audit-events";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "admin", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({ id: "admin", isAdmin: true });
  listAdminAuditEventsMock.mockResolvedValue([{ id: 1, eventType: "x" }]);
});

describe("api/admin-audit-events", () => {
  it("returns 403 for non-admin users", async () => {
    fetchUserProfileMock.mockResolvedValueOnce({ id: "u1", isAdmin: false });
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/admin-audit-events")));
    expect(res.status).toBe(403);
  });

  it("uses default limit when query limit is invalid", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/admin-audit-events?limit=oops")));
    expect(res.status).toBe(200);
    expect(listAdminAuditEventsMock).toHaveBeenCalledWith(env, 120);
  });
});
