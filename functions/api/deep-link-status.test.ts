import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  assertUserAccessMock,
  resolveSimulationAccessForUserMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  resolveSimulationAccessForUserMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  resolveSimulationAccessForUser: resolveSimulationAccessForUserMock,
}));

import { onRequestGet } from "./deep-link-status";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  assertUserAccessMock.mockResolvedValue({ id: "u1", isAdmin: false, isModerator: false });
  resolveSimulationAccessForUserMock.mockResolvedValue("ok");
});

describe("api/deep-link-status", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status?sim=sim-1")));
    expect(res.status).toBe(401);
  });

  it("returns 400 when simulation id is missing", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status")));
    expect(res.status).toBe(400);
  });

  it("returns access status for simulation id", async () => {
    resolveSimulationAccessForUserMock.mockResolvedValueOnce("forbidden");
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status?sim=sim-2")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "forbidden" });
  });
});
