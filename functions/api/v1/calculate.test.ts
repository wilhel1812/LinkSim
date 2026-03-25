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
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE?: string;
};

const mkCtx = (request: Request, env: TestEnv) =>
  ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  getClientAddressMock.mockReturnValue("203.0.113.1");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 99, retryAfterSec: 0 });
});

describe("api/v1/calculate", () => {
  it("returns calculated link budget response", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        calculation: "link_budget",
        input: {
          from_site: "A",
          to_site: "B",
          frequency_mhz: 868,
          rx_target_dbm: -110,
          nodes: [
            { name: "A", lat: 59.9139, lon: 10.7522 },
            { name: "B", lat: 59.917, lon: 10.76 },
          ],
        },
      }),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      calculation: "link_budget",
      mode: "fast",
      terrain_used: false,
      result: {
        from_site: "A",
        to_site: "B",
        verdict: "PASS",
      },
    });
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
        CALC_API_PROXY_RATE_LIMIT_PER_MINUTE: "2",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    await expect(res.json()).resolves.toEqual({
      error: "Calculation API rate limit reached. Please wait and try again.",
    });
  });

  it("accepts from_node/to_node aliases", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        calculation: "link_budget",
        input: {
          from_node: "A",
          to_node: "B",
          frequency_mhz: 868,
          nodes: [
            { name: "A", lat: 59.9139, lon: 10.7522 },
            { name: "B", lat: 59.917, lon: 10.76 },
          ],
        },
      }),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      calculation: "link_budget",
      mode: "fast",
      terrain_used: false,
      result: {
        from_site: "A",
        to_site: "B",
      },
    });
  });

  it("returns 400 when terrain mode is requested on synchronous endpoint", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        calculation: "link_budget",
        input: {
          mode: "terrain",
          from_site: "A",
          to_site: "B",
          frequency_mhz: 868,
          nodes: [
            { name: "A", lat: 59.9139, lon: 10.7522 },
            { name: "B", lat: 59.917, lon: 10.76 },
          ],
        },
      }),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Terrain mode is not available on synchronous /api/v1/calculate. Use POST /api/v1/calculate/jobs for terrain-aware calculations (supports up to 500 km).",
    });
  });

  it("returns 400 for unsupported calculations", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ calculation: "terrain_profile", input: {} }),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Unsupported calculation type: link_budget is currently the only supported value.",
    });
  });
});
