import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, ensureUserMock, setUserRoleMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  ensureUserMock: vi.fn(),
  setUserRoleMock: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock,
  setUserRole: setUserRoleMock,
}));

import { onRequestPost } from "./dev-role";

const env = { DB: {}, ALLOW_INSECURE_DEV_AUTH: "true" } as unknown as { DB: D1Database; ALLOW_INSECURE_DEV_AUTH: string };
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: "local-dev-user", tokenPayload: {}, source: "dev" });
  ensureUserMock.mockResolvedValue(undefined);
  setUserRoleMock.mockResolvedValue({ id: "local-dev-user", role: "admin" });
});

describe("api/dev-role", () => {
  it("rejects when dev auth is disabled", async () => {
    const disabledEnv = { DB: {}, ALLOW_INSECURE_DEV_AUTH: "false" } as unknown as { DB: D1Database; ALLOW_INSECURE_DEV_AUTH: string };
    const req = new Request("https://example.test/api/dev-role", {
      method: "POST",
      body: JSON.stringify({ role: "admin" }),
      headers: { "content-type": "application/json" },
    });
    const res = await onRequestPost({ request: req, env: disabledEnv } as unknown as Parameters<typeof onRequestPost>[0]);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid role", async () => {
    const req = new Request("https://example.test/api/dev-role", {
      method: "POST",
      body: JSON.stringify({ role: "invalid" }),
      headers: { "content-type": "application/json" },
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(400);
  });

  it("sets the role for local dev user", async () => {
    const req = new Request("https://example.test/api/dev-role", {
      method: "POST",
      body: JSON.stringify({ role: "moderator" }),
      headers: { "content-type": "application/json" },
    });
    const res = await onRequestPost(mkCtx(req));
    expect(res.status).toBe(200);
    expect(setUserRoleMock).toHaveBeenCalledWith(env, "local-dev-user", "moderator", "local-dev-user");
  });
});
