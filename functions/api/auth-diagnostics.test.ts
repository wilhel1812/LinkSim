import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, fetchUserDiagnosticAccessStateMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  fetchUserDiagnosticAccessStateMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock, inspectAuthRequest: vi.fn(() => ({})) }));
vi.mock("../_lib/db", () => ({ fetchUserDiagnosticAccessState: fetchUserDiagnosticAccessStateMock }));

import { onRequestGet } from "./auth-diagnostics";

const env = { DB: {}, ADMIN_USER_IDS: "configured-admin" } as unknown as Parameters<typeof onRequestGet>[0]["env"];

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "configured-admin", tokenPayload: {}, source: "jwt" });
});

describe("auth diagnostics authorization", () => {
  it("uses current DB role instead of ADMIN_USER_IDS", async () => {
    fetchUserDiagnosticAccessStateMock.mockResolvedValue({ isAdmin: false, accountState: "approved" });
    const response = await onRequestGet({ request: new Request("https://example.test/api/auth-diagnostics"), env } as never);
    expect(response.status).toBe(403);
  });

  it("denies a revoked configured bootstrap identity", async () => {
    fetchUserDiagnosticAccessStateMock.mockResolvedValue({ isAdmin: false, accountState: "revoked" });
    const response = await onRequestGet({ request: new Request("https://example.test/api/auth-diagnostics"), env } as never);
    expect(response.status).toBe(403);
  });

  it("returns diagnostics for a current DB admin without strict schema initialization", async () => {
    fetchUserDiagnosticAccessStateMock.mockResolvedValue({ isAdmin: true, accountState: "approved" });
    const response = await onRequestGet({ request: new Request("https://example.test/api/auth-diagnostics"), env } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      auth: { userId: "configured-admin", source: "jwt" },
    });
  });
});
