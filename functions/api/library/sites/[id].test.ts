import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, assertUserAccessMock, deleteSiteResourceMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  deleteSiteResourceMock: vi.fn(),
}));

vi.mock("../../../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../../../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  deleteSiteResource: deleteSiteResourceMock,
}));

import { onRequestDelete } from "./[id]";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (id = "site-1") => ({
  request: new Request(`https://example.test/api/library/sites/${id}`, { method: "DELETE" }),
  env,
  params: { id },
} as unknown as Parameters<typeof onRequestDelete>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "owner-1", tokenPayload: {} });
  assertUserAccessMock.mockResolvedValue({ id: "owner-1", isAdmin: false, isModerator: false });
  deleteSiteResourceMock.mockResolvedValue({ ok: true, siteId: "site-1" });
});

describe("api/library/sites/[id]", () => {
  it("deletes an owned Site through the existing authenticated Library boundary", async () => {
    const response = await onRequestDelete(mkCtx());
    expect(response.status).toBe(200);
    expect(deleteSiteResourceMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: "owner-1", isAdmin: false }),
      "site-1",
    );
  });

  it("maps forbidden deletion and treats an already-missing Site as an idempotent success", async () => {
    deleteSiteResourceMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    expect((await onRequestDelete(mkCtx())).status).toBe(403);
    deleteSiteResourceMock.mockResolvedValueOnce({ ok: false, reason: "missing" });
    const missing = await onRequestDelete(mkCtx());
    expect(missing.status).toBe(200);
    await expect(missing.json()).resolves.toMatchObject({ ok: true, siteId: "site-1", alreadyDeleted: true });
  });

  it("requires authentication", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    expect((await onRequestDelete(mkCtx())).status).toBe(401);
    expect(deleteSiteResourceMock).not.toHaveBeenCalled();
  });
});
