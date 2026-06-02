import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  submitPathLeaderboardCandidateMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  submitPathLeaderboardCandidateMock: vi.fn(),
}));

vi.mock("../../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
}));
vi.mock("../../_lib/pathLeaderboard", () => ({
  submitPathLeaderboardCandidate: submitPathLeaderboardCandidateMock,
}));

import { onRequestPost } from "./path-leaderboard";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue({ id: "u1", isAdmin: false, isModerator: false });
  submitPathLeaderboardCandidateMock.mockResolvedValue({ ok: true, stored: true });
});

describe("api/stats/path-leaderboard", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestPost(mkCtx(new Request("https://example.test/api/stats/path-leaderboard")));
    expect(res.status).toBe(401);
  });

  it("normalizes candidate input and submits with actor policy", async () => {
    const req = new Request("https://example.test/api/stats/path-leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        simulationId: "sim-1",
        simulationUpdatedAt: "2026-05-16T12:00:00.000Z",
        fromSiteId: "site-a",
        toSiteId: "site-b",
        linkId: "link-1",
        distanceKm: 44,
        rxAfterEnvLossDbm: -101,
        rxMarginDb: 19,
        terrainObstructed: true,
        terrainDataset: "copernicus30",
        terrainTileSignature: "tile-hash",
      }),
    });

    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(200);
    expect(submitPathLeaderboardCandidateMock).toHaveBeenCalledWith(
      env,
      { id: "u1", isAdmin: false, isModerator: false },
      expect.objectContaining({
        simulationId: "sim-1",
        fromSiteId: "site-a",
        toSiteId: "site-b",
        rxMarginDb: 19,
      }),
    );
    await expect(res.json()).resolves.toEqual({ ok: true, stored: true });
  });

  it("returns 400 for rejected candidates", async () => {
    submitPathLeaderboardCandidateMock.mockResolvedValueOnce({ ok: false, stored: false, reason: "not_passing" });
    const req = new Request("https://example.test/api/stats/path-leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, stored: false, reason: "not_passing" });
  });
});
