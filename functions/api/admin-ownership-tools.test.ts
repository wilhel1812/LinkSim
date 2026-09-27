import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  fetchUserProfileMock,
  reassignResourceOwnerMock,
  bulkReassignOwnershipMock,
  assistAuthIdentityRecoveryMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  reassignResourceOwnerMock: vi.fn(),
  bulkReassignOwnershipMock: vi.fn(),
  assistAuthIdentityRecoveryMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  fetchUserProfile: fetchUserProfileMock,
  reassignResourceOwner: reassignResourceOwnerMock,
  bulkReassignOwnership: bulkReassignOwnershipMock,
}));
vi.mock("../_lib/authAssistedRecovery", () => ({
  assistAuthIdentityRecovery: assistAuthIdentityRecoveryMock,
}));

import { onRequestPost } from "./admin-ownership-tools";

const env = { DB: {}, AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true" } as unknown as {
  DB: D1Database;
  AUTH_DUAL_LOGIN_MIGRATION_ENABLED: string;
};
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "admin", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({ id: "admin", isAdmin: true });
  reassignResourceOwnerMock.mockResolvedValue({ ok: true });
  bulkReassignOwnershipMock.mockResolvedValue({ sitesUpdated: 1, simulationsUpdated: 2 });
  assistAuthIdentityRecoveryMock.mockResolvedValue({ authUserId: "auth-1", linksimUserId: "u1" });
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

  it("executes audited assisted auth recovery for an administrator", async () => {
    const req = new Request("https://example.test/api/admin-ownership-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "assist_auth_recovery",
        authUserId: "auth-1",
        linksimUserId: "u1",
        evidenceType: "account-history",
        evidenceSummary: "Compared private resource history and the original provider account ID.",
      }),
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(200);
    expect(assistAuthIdentityRecoveryMock).toHaveBeenCalledWith(env.DB, {
      actorUserId: "admin",
      authUserId: "auth-1",
      linksimUserId: "u1",
      evidenceType: "account-history",
      evidenceSummary: "Compared private resource history and the original provider account ID.",
    });
  });

  it("rejects assisted recovery without a complete evidence record", async () => {
    const req = new Request("https://example.test/api/admin-ownership-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "assist_auth_recovery", authUserId: "auth-1", linksimUserId: "u1" }),
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(400);
    expect(assistAuthIdentityRecoveryMock).not.toHaveBeenCalled();
  });

  it("hides assisted recovery while migration is disabled", async () => {
    const req = new Request("https://example.test/api/admin-ownership-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "assist_auth_recovery",
        authUserId: "auth-1",
        linksimUserId: "u1",
        evidenceType: "account-history",
        evidenceSummary: "Compared private resource history and the original provider account ID.",
      }),
    });
    const res = await onRequestPost({
      request: req,
      env: { ...env, AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "false" },
    } as unknown as Parameters<typeof onRequestPost>[0]);
    expect(res.status).toBe(404);
    expect(assistAuthIdentityRecoveryMock).not.toHaveBeenCalled();
  });
});
