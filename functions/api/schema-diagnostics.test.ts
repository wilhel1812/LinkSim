import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, fetchUserDiagnosticAccessStateMock, getSchemaDiagnosticsMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(), fetchUserDiagnosticAccessStateMock: vi.fn(), getSchemaDiagnosticsMock: vi.fn(),
}));
vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  fetchUserDiagnosticAccessState: fetchUserDiagnosticAccessStateMock,
  getSchemaDiagnostics: getSchemaDiagnosticsMock,
}));

import { onRequestGet } from "./schema-diagnostics";

const env = { DB: {}, ADMIN_USER_IDS: "configured-admin" } as unknown as Parameters<typeof onRequestGet>[0]["env"];

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "configured-admin", tokenPayload: {}, source: "jwt" });
  getSchemaDiagnosticsMock.mockResolvedValue({ ok: true, version: "test", missing: [] });
});

describe("schema diagnostics authorization", () => {
  it("denies a configured identity that is no longer a DB admin", async () => {
    fetchUserDiagnosticAccessStateMock.mockResolvedValue({ isAdmin: false, accountState: "approved" });
    const response = await onRequestGet({ request: new Request("https://example.test/api/schema-diagnostics"), env } as never);
    expect(response.status).toBe(403);
    expect(getSchemaDiagnosticsMock).not.toHaveBeenCalled();
  });

  it("allows a current, non-revoked DB admin", async () => {
    fetchUserDiagnosticAccessStateMock.mockResolvedValue({ isAdmin: true, accountState: "approved" });
    const response = await onRequestGet({ request: new Request("https://example.test/api/schema-diagnostics"), env } as never);
    expect(response.status).toBe(200);
  });

  it("returns structured missing-schema diagnostics without running ensureUser", async () => {
    fetchUserDiagnosticAccessStateMock.mockResolvedValue({ isAdmin: true, accountState: "approved" });
    getSchemaDiagnosticsMock.mockResolvedValue({
      ok: false, version: "test", missing: [{ table: "users", columns: ["new_column"] }],
    });
    const response = await onRequestGet({ request: new Request("https://example.test/api/schema-diagnostics"), env } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schema: { ok: false, version: "test", missing: [{ table: "users", columns: ["new_column"] }] },
    });
  });
});
