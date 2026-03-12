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
  getClientAddressMock.mockReturnValue("203.0.113.9");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 119, retryAfterSec: 0 });
  vi.stubGlobal("fetch", vi.fn());
});

describe("ve2dbe proxy", () => {
  it("allows tile-list POST and forwards content-type/body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const req = new Request("https://example.test/ve2dbe/geodata/gettile.asp", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain" },
      body: "lat=59&lon=10",
    });

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(takeRateLimitTokenMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toBe("https://www.ve2dbe.com/geodata/gettile.asp");
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        accept: "text/plain",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect((vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as { body?: unknown })?.body).toBeTruthy();
  });

  it("rejects unsupported methods on non tile-list endpoints", async () => {
    const req = new Request("https://example.test/ve2dbe/geodata/srtm/file.zip", {
      method: "POST",
      body: "payload",
    });
    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(405);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 429 when limiter blocks non tile-list requests", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 4 });
    const req = new Request("https://example.test/ve2dbe/geodata/n59e010.hgt.zip");
    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("4");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards allowed GET requests to upstream with query string", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("zip", { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );

    const req = new Request("https://example.test/ve2dbe/geodata/n59e010.hgt.zip?dataset=srtm", {
      headers: { accept: "application/octet-stream" },
    });
    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toBe(
      "https://www.ve2dbe.com/geodata/n59e010.hgt.zip?dataset=srtm",
    );
    expect(takeRateLimitTokenMock).toHaveBeenCalledTimes(1);
  });
});
