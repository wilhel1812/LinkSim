import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureUserMock, fetchPublicSimulationBundleMock, fetchUserProfileMock, verifyAuthMock } = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  fetchPublicSimulationBundleMock: vi.fn(),
  fetchUserProfileMock: vi.fn(),
  verifyAuthMock: vi.fn(),
}));

vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  fetchPublicSimulationBundle: fetchPublicSimulationBundleMock,
  fetchUserProfile: fetchUserProfileMock,
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
  fetchUserProfileMock.mockResolvedValue(null);
  fetchPublicSimulationBundleMock.mockResolvedValue({
    status: "ok",
    simulationId: "sim-1",
    sites: [{ id: "site-1" }],
    simulation: { id: "sim-1" },
  });
});

describe("api/public-simulation", () => {
  it("reports expected guests through the public auth-status mode", async () => {
    verifyAuthMock.mockResolvedValueOnce(null);

    const res = await onRequestGet(
      mkCtx(new Request("https://example.test/api/public-simulation?mode=auth")),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ authenticated: false, authState: "guest" });
    expect(fetchPublicSimulationBundleMock).not.toHaveBeenCalled();
  });

  it("reports authenticated and revoked auth-status states", async () => {
    verifyAuthMock.mockResolvedValue({ userId: "user-42", tokenPayload: {} });
    fetchUserProfileMock
      .mockResolvedValueOnce({ id: "user-42", accountState: "approved" })
      .mockResolvedValueOnce({ id: "user-42", accountState: "revoked" });

    const authenticated = await onRequestGet(
      mkCtx(new Request("https://example.test/api/public-simulation?mode=auth")),
    );
    const revoked = await onRequestGet(
      mkCtx(new Request("https://example.test/api/public-simulation?mode=auth")),
    );

    await expect(authenticated.json()).resolves.toEqual({
      authenticated: true,
      authState: "authenticated",
    });
    await expect(revoked.json()).resolves.toEqual({
      authenticated: false,
      authState: "revoked",
    });
    expect(fetchPublicSimulationBundleMock).not.toHaveBeenCalled();
  });

  it.each([
    "Identity subject is no longer current",
    "Identity is blocked by an administrator",
  ])("reports lifecycle rejection as revoked in auth-status mode: %s", async (message) => {
    verifyAuthMock.mockResolvedValueOnce({ userId: "user-42", tokenPayload: {} });
    ensureUserMock.mockRejectedValueOnce(new Error(message));

    const res = await onRequestGet(
      mkCtx(new Request("https://example.test/api/public-simulation?mode=auth")),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authenticated: false, authState: "revoked" });
  });

  it("surfaces auth verification failures in auth-status mode", async () => {
    verifyAuthMock.mockRejectedValueOnce(new Error("Auth verification timed out"));

    const res = await onRequestGet(
      mkCtx(new Request("https://example.test/api/public-simulation?mode=auth")),
    );

    expect(res.status).toBe(503);
  });

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

  it("passes an anonymous actor when request is unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const response = await onRequestGet(mkCtx(new Request(
      "https://example.test/api/public-simulation?sim=sim-1",
      { headers: { origin: "https://example.test" } },
    )));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://example.test");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(fetchPublicSimulationBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: null }),
    );
  });

  it("passes the resolved actor policy when request is authenticated", async () => {
    verifyAuthMock.mockResolvedValue({ userId: "user-42", tokenPayload: {} });
    fetchUserProfileMock.mockResolvedValue({
      id: "user-42",
      isAdmin: true,
      isModerator: false,
      accountState: "approved",
    });
    await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?sim=sim-1")));
    expect(ensureUserMock).toHaveBeenCalledWith(expect.anything(), "user-42", {});
    expect(fetchPublicSimulationBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: { id: "user-42", isAdmin: true, isModerator: false },
      }),
    );
  });

  it("passes username-scoped slug lookup parameters", async () => {
    await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?username=Owner&slug=my-sim")));
    expect(fetchPublicSimulationBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ username: "Owner", simulationSlug: "my-sim", actor: null }),
    );
  });

  it("returns 403 when bundle status is forbidden", async () => {
    fetchPublicSimulationBundleMock.mockResolvedValue({ status: "forbidden" });
    const res = await onRequestGet(mkCtx(new Request("https://example.test/api/public-simulation?sim=sim-1")));
    expect(res.status).toBe(403);
  });
});
