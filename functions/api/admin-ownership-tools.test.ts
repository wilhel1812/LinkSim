import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchUserProfileMock,
  reassignResourceOwnerMock,
  bulkReassignOwnershipMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  reassignResourceOwnerMock: vi.fn(),
  bulkReassignOwnershipMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
  reassignResourceOwner: reassignResourceOwnerMock,
  bulkReassignOwnership: bulkReassignOwnershipMock,
}));

import { onRequestPost } from "./admin-ownership-tools";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "admin", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({ id: "admin", isAdmin: true });
  reassignResourceOwnerMock.mockResolvedValue({ ok: true });
  bulkReassignOwnershipMock.mockResolvedValue({ sitesUpdated: 1, simulationsUpdated: 2 });
});

describe("api/admin-ownership-tools", () => {
  it("returns 400 for unknown action", async () => {
    const req = new Request("https://example.test/api/admin-ownership-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "bad_action" }),
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(400);
  });

  it("executes reassign owner action", async () => {
    const req = new Request("https://example.test/api/admin-ownership-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reassign_owner", kind: "site", resourceId: "s1", newOwnerUserId: "u2" }),
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(200);
    expect(reassignResourceOwnerMock).toHaveBeenCalledWith(env, "site", "s1", "u2", "admin");
  });

  it("executes bulk reassignment action", async () => {
    const req = new Request("https://example.test/api/admin-ownership-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "bulk_reassign", fromUserId: "u1", toUserId: "u2" }),
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(200);
    expect(bulkReassignOwnershipMock).toHaveBeenCalledWith(env, "u1", "u2", "admin");
  });
});
