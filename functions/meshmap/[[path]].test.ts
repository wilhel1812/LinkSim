import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
}));

vi.mock("../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  takeRateLimitToken: takeRateLimitTokenMock,
}));

import { onRequest } from "./[[path]]";

const env = { DB: {}, PROXY_RATE_LIMIT_PER_MINUTE: "120" } as unknown as {
  DB: D1Database;
  PROXY_RATE_LIMIT_PER_MINUTE?: string;
};

const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequest>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  getClientAddressMock.mockReturnValue("198.51.100.10");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 119, retryAfterSec: 0 });
  vi.stubGlobal("fetch", vi.fn());
});

describe("meshmap proxy", () => {
  it("rejects methods other than GET/HEAD", async () => {
    const req = new Request("https://example.test/meshmap/nodes.json", { method: "POST", body: "{}" });
    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(405);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limiter blocks request", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 9 });
    const req = new Request("https://example.test/meshmap/nodes.json");
    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards allowed GET requests to meshmap upstream", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const req = new Request("https://example.test/meshmap/nodes.json?region=no", {
      headers: { accept: "application/json" },
    });

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toBe("https://meshmap.net/nodes.json?region=no");
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: { accept: "application/json" },
    });
  });
});
