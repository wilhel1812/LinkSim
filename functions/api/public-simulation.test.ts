import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPublicSimulationBundleMock, verifyAuthMock } = vi.hoisted(() => ({
  fetchPublicSimulationBundleMock: vi.fn(),
  verifyAuthMock: vi.fn(),
}));

vi.mock("../_lib/db", () => ({
  fetchPublicSimulationBundle: fetchPublicSimulationBundleMock,
}));

vi.mock("../_lib/auth", () => ({
  verifyAuth: verifyAuthMock,
}));

import { onRequestGet } from "./public-simulation";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue(null);
  fetchPublicSimulationBundleMock.mockResolvedValue({
    status: "ok",
    simulationId: "sim-1",
    sites: [{ id: "site-1" }],
    simulation: { id: "sim-1" },
  });
});

describe("api/public-simulation", () => {
  it("returns no-store when request is invalid", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation")));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns no-store for successful responses", async () => {
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?sim=sim-1")));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes actorId null when request is unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?sim=sim-1")));
    expect(fetchPublicSimulationBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: null }),
    );
  });

  it("passes actorId from auth when request is authenticated", async () => {
    verifyAuthMock.mockResolvedValue({ userId: "user-42" });
    await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?sim=sim-1")));
    expect(fetchPublicSimulationBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: "user-42" }),
    );
  });

  it("returns 403 when bundle status is forbidden", async () => {
    fetchPublicSimulationBundleMock.mockResolvedValue({ status: "forbidden" });
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?sim=sim-1")));
    expect(res.status).toBe(403);
  });
});
