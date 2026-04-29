import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  ensureUserMock,
  fetchUserProfileMock,
  resolveSimulationAccessForUserMock,
  resolveSimulationIdByOwnerSlugMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  resolveSimulationAccessForUserMock: vi.fn(),
  resolveSimulationIdByOwnerSlugMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  fetchUserProfile: fetchUserProfileMock,
  resolveSimulationAccessForUser: resolveSimulationAccessForUserMock,
  resolveSimulationIdByOwnerSlug: resolveSimulationIdByOwnerSlugMock,
}));

import { onRequestGet } from "./deep-link-status";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "u1", tokenPayload: {}, source: "headers" });
  ensureUserMock.mockResolvedValue(undefined);
  fetchUserProfileMock.mockResolvedValue({ id: "u1", isAdmin: false, isModerator: false, accountState: "approved" });
  resolveSimulationAccessForUserMock.mockResolvedValue("ok");
  resolveSimulationIdByOwnerSlugMock.mockResolvedValue(null);
});

describe("api/deep-link-status", () => {
  it("supports unauthenticated public checks", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status?sim=sim-1")));
    expect(res.status).toBe(200);
  });

  it("returns missing when simulation id is missing", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "missing", authenticated: true });
  });

  it("returns access status for simulation id", async () => {
    resolveSimulationAccessForUserMock.mockResolvedValueOnce("forbidden");
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status?sim=sim-2")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "forbidden", simulationId: "sim-2", authenticated: true });
  });

  it("resolves username-scoped slug to simulation id", async () => {
    resolveSimulationIdByOwnerSlugMock.mockResolvedValueOnce("sim-abc");
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/deep-link-status?username=Owner&slug=my-sim")));
    expect(res.status).toBe(200);
    expect(resolveSimulationIdByOwnerSlugMock).toHaveBeenCalledWith(expect.anything(), "Owner", "my-sim");
    await expect(res.json()).resolves.toEqual({ status: "ok", simulationId: "sim-abc", authenticated: true });
  });
});
