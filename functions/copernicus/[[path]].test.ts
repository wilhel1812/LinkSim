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

const env = {
  DB: {},
  PROXY_RATE_LIMIT_PER_MINUTE: "120",
  PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE: "1500",
  PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE: "40",
} as unknown as {
  DB: D1Database;
  PROXY_RATE_LIMIT_PER_MINUTE?: string;
  PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE?: string;
  PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE?: string;
};

const mkCtx = (request: Request) =>
  ({
    request,
    env,
    waitUntil: vi.fn(),
  }) as unknown as Parameters<typeof onRequest>[0];

type CacheLike = {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const setCache = (cache: CacheLike) => {
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: cache },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  getClientAddressMock.mockReturnValue("203.0.113.9");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 119, retryAfterSec: 0 });
  setCache({
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("copernicus proxy", () => {
  it("forwards tile requests to the selected Copernicus bucket", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("tif", { status: 200, headers: { "content-type": "image/tiff" } }),
    );
    const req = new Request(
      "https://example.test/copernicus/90m/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
      { headers: { accept: "image/tiff", "cf-access-authenticated-user-email": "node@linksim.test" } },
    );

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toBe(
      "https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
    );
    expect(takeRateLimitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "proxy:copernicus:tile:user:node@linksim.test",
        limit: 1500,
      }),
    );
  });

  it("uses tile-list specific limits for tileList.txt requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("Copernicus_DSM_COG_30_N60_00_E009_00_DEM", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const req = new Request("https://example.test/copernicus/30m/tileList.txt", {
      headers: { "cf-access-authenticated-user-email": "node@linksim.test", accept: "text/plain" },
    });

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(takeRateLimitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "proxy:copernicus:tilelist:user:node@linksim.test",
        limit: 40,
      }),
    );
  });

  it("rejects unsupported objects", async () => {
    const req = new Request("https://example.test/copernicus/90m/README.md");
    const res = await onRequest(mkCtx(req));
    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 429 with retry-after when throttled", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 9 });
    const req = new Request(
      "https://example.test/copernicus/90m/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
    );

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("serves cached tile from edge cache on cache hit", async () => {
    const cached = new Response("tif-bytes", {
      status: 200,
      headers: { "content-type": "image/tiff" },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
    };
    setCache(cache);

    const waitUntil = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(undefined, { status: 200 }));
    const req = new Request(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
    );

    const res = await onRequest({ request: req, env, waitUntil } as Parameters<typeof onRequest>[0]);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache-status")).toBe("HIT");
    expect(waitUntil).toHaveBeenCalled();
  });

  it("caches successful tile responses without explicit TTL (sliding window)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("tif", { status: 200, headers: { "content-type": "image/tiff" } }),
    );

    const req = new Request(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
    );

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache-status")).toBe("MISS");
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("cdn-cache-control")).toBeNull();
  });

  it("caches successful tileList responses without explicit TTL", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("tile-list-content", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const req = new Request("https://example.test/copernicus/30m/tileList.txt");

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache-status")).toBe("MISS");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("does not cache non-OK responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "content-type": "text/plain" } }),
    );

    const req = new Request(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
    );

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(404);
    expect(res.headers.get("x-cache-status")).toBe("MISS");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("prefetchs neighbor tiles on tile cache hit", async () => {
    const cached = new Response("tif-bytes", {
      status: 200,
      headers: { "content-type": "image/tiff" },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
    };
    setCache(cache);

    const waitUntil = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(undefined, { status: 200 }));
    const req = new Request(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N60_00_E009_00_DEM/Copernicus_DSM_COG_30_N60_00_E009_00_DEM.tif",
    );

    await onRequest({ request: req, env, waitUntil } as Parameters<typeof onRequest>[0]);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const prefetchCall = vi.mocked(waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await prefetchCall;

    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    const neighborUrls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(neighborUrls).toContain(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N59_00_E009_DEM/Copernicus_DSM_COG_30_N59_00_E009_DEM.tif",
    );
    expect(neighborUrls).toContain(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N61_00_E009_DEM/Copernicus_DSM_COG_30_N61_00_E009_DEM.tif",
    );
    expect(neighborUrls).toContain(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N60_00_E008_DEM/Copernicus_DSM_COG_30_N60_00_E008_DEM.tif",
    );
    expect(neighborUrls).toContain(
      "https://example.test/copernicus/30m/Copernicus_DSM_COG_30_N60_00_E010_DEM/Copernicus_DSM_COG_30_N60_00_E010_DEM.tif",
    );
  });

  it("does not prefetch neighbors for tileList.txt", async () => {
    const cached = new Response("tile-list", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
    };
    setCache(cache);

    const waitUntil = vi.fn();
    const req = new Request("https://example.test/copernicus/30m/tileList.txt");

    await onRequest({ request: req, env, waitUntil } as Parameters<typeof onRequest>[0]);

    expect(waitUntil).not.toHaveBeenCalled();
  });
});
