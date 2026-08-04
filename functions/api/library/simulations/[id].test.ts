import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, assertUserAccessMock, setSimulationLifecycleStatusMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  assertUserAccessMock: vi.fn(),
  setSimulationLifecycleStatusMock: vi.fn(),
}));

vi.mock("../../../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../../../_lib/db", () => ({
  ensureUser: ensureUserMock,
  assertUserAccess: assertUserAccessMock,
  setSimulationLifecycleStatus: setSimulationLifecycleStatusMock,
}));

import { onRequestDelete, onRequestPatch } from "./[id]";

const env = { DB: {} } as unknown as { DB: D1Database };
const mkCtx = (request: Request, id = "sim-1") =>
  ({ request, env, params: { id } } as unknown as Parameters<typeof onRequestDelete>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "owner-1", tokenPayload: {} });
  assertUserAccessMock.mockResolvedValue({ id: "owner-1", isAdmin: false, isModerator: false });
  setSimulationLifecycleStatusMock.mockResolvedValue({ ok: true, simulationId: "sim-1", status: "deleted" });
});

describe("api/library/simulations/[id]", () => {
  it("marks an owned Simulation deleted", async () => {
    const response = await onRequestDelete(mkCtx(new Request("https://example.test/api/library/simulations/sim-1", { method: "DELETE" })));

    expect(response.status).toBe(200);
    expect(setSimulationLifecycleStatusMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: "owner-1", isAdmin: false }),
      "sim-1",
      "deleted",
    );
  });

  it("only accepts admin restoration", async () => {
    const request = new Request("https://example.test/api/library/simulations/sim-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const forbidden = await onRequestPatch(mkCtx(request));
    expect(forbidden.status).toBe(403);

    assertUserAccessMock.mockResolvedValueOnce({ id: "admin-1", isAdmin: true, isModerator: false });
    setSimulationLifecycleStatusMock.mockResolvedValueOnce({ ok: true, simulationId: "sim-1", status: "active" });
    const restored = await onRequestPatch(mkCtx(new Request(request)));
    expect(restored.status).toBe(200);
    expect(setSimulationLifecycleStatusMock).toHaveBeenLastCalledWith(
      env,
      expect.objectContaining({ id: "admin-1", isAdmin: true }),
      "sim-1",
      "active",
    );
  });

  it("maps lifecycle failures to permission and missing responses", async () => {
    setSimulationLifecycleStatusMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const forbidden = await onRequestDelete(mkCtx(new Request("https://example.test/api/library/simulations/sim-1", { method: "DELETE" })));
    expect(forbidden.status).toBe(403);

    setSimulationLifecycleStatusMock.mockResolvedValueOnce({ ok: false, reason: "missing" });
    const missing = await onRequestDelete(mkCtx(new Request("https://example.test/api/library/simulations/sim-1", { method: "DELETE" })));
    expect(missing.status).toBe(404);
  });
});
