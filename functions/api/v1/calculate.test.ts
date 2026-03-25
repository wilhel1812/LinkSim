import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
}));

vi.mock("../../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  takeRateLimitToken: takeRateLimitTokenMock,
}));

import { onRequestPost } from "./calculate";

type TestEnv = {
  DB: unknown;
  CALC_API_BASE_URL?: string;
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE?: string;
};

const mkCtx = (request: Request, env: TestEnv) =>
  ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  getClientAddressMock.mockReturnValue("203.0.113.1");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 99, retryAfterSec: 0 });
});

describe("api/v1/calculate proxy", () => {
  it("returns 503 when calculation API base URL is not configured", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      body: JSON.stringify({ calculation: "link_budget" }),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Calculation API is not configured." });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 429 when edge proxy limiter denies request", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 9 });
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calculation: "link_budget" }),
    });
    const res = await onRequestPost(
      mkCtx(req, {
        DB: {},
        CALC_API_BASE_URL: "https://api.linksim.link",
        CALC_API_PROXY_RATE_LIMIT_PER_MINUTE: "2",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    await expect(res.json()).resolves.toEqual({
      error: "Calculation API rate limit reached. Please wait and try again.",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("proxies upstream response body and status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ calculation: "link_budget", result: { verdict: "PASS", rx_dbm: -83.5 } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ calculation: "link_budget", input: { from_site: "A", to_site: "B", nodes: [] } }),
    });
    const res = await onRequestPost(
      mkCtx(req, {
        DB: {},
        CALC_API_BASE_URL: "https://api.linksim.link",
      }),
    );

    expect(globalThis.fetch).toHaveBeenCalledWith("https://api.linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ calculation: "link_budget", input: { from_site: "A", to_site: "B", nodes: [] } }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      calculation: "link_budget",
      result: { verdict: "PASS" },
    });
  });
});
