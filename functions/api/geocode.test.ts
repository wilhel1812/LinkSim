import { beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestGet } from "./geocode";

const env = { DB: {} } as unknown as { DB: D1Database };

const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

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
  setCache({
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("api/geocode", () => {
  it("returns empty results for blank query", async () => {
    const req = new Request("https://example.test/api/geocode?q=");
    const res = await onRequestGet(mkCtx(req));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
  });

  it("returns 400 for short query", async () => {
    const req = new Request("https://example.test/api/geocode?q=ab");
    const res = await onRequestGet(mkCtx(req));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Search query must be at least 3 characters." });
  });

  it("serves cached response without upstream fetch", async () => {
    const cached = new Response(JSON.stringify({ results: [{ id: "1", label: "Cached", lat: 59.9, lon: 10.7 }] }), {
      headers: { "content-type": "application/json" },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
    };
    setCache(cache);

    const req = new Request("https://example.test/api/geocode?q=Oslo");
    const res = await onRequestGet(mkCtx(req));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ results: [{ id: "1", label: "Cached" }] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("maps upstream payload and writes edge cache", async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    };
    setCache(cache);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { place_id: 101, display_name: "Oslo, Norway", lat: "59.91", lon: "10.75" },
          { place_id: 102, display_name: "Invalid", lat: "oops", lon: "10.75" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const req = new Request("https://example.test/api/geocode?q=Oslo");
    const res = await onRequestGet(mkCtx(req));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    await expect(res.json()).resolves.toEqual({
      results: [{ id: "101", label: "Oslo, Norway", lat: 59.91, lon: 10.75 }],
    });
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
