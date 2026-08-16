import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, parsePerMinuteLimitMock, takeRateLimitTokenMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(() => "198.51.100.10"),
  parsePerMinuteLimitMock: vi.fn((raw: string | undefined, fallback: number) => raw ? Number(raw) : fallback),
  takeRateLimitTokenMock: vi.fn(() => ({ allowed: true, remaining: 59, retryAfterSec: 0 })),
}));
vi.mock("../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  parsePerMinuteLimit: parsePerMinuteLimitMock,
  takeRateLimitToken: takeRateLimitTokenMock,
}));

import { onRequestGet } from "./geocode";

type CacheLike = { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
const setCache = (cache: CacheLike) => vi.stubGlobal("caches", { default: cache });
const env = (rate?: string) => ({ DB: {}, GEOCODE_RATE_LIMIT_PER_MINUTE: rate } as unknown as Parameters<typeof onRequestGet>[0]["env"]);
const call = (query: string, routeEnv = env()) => onRequestGet({
  request: new Request(`https://example.test/api/geocode?q=${encodeURIComponent(query)}`),
  env: routeEnv,
} as never);
const result = (overrides = {}) => ({
  place_id: 101,
  display_name: "Oslo, Norway",
  lat: "59.91",
  lon: "10.75",
  boundingbox: ["59.8", "60.0", "10.6", "10.9"],
  ...overrides,
});

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  setCache({ match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) });
  vi.stubGlobal("fetch", vi.fn());
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 59, retryAfterSec: 0 });
});

describe("api/geocode bounds", () => {
  it("normalizes NFC, case, and whitespace and enforces 3-256 characters", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify([result()]), { headers: { "content-type": "application/json" } }));
    expect((await call("ab")).status).toBe(400);
    expect((await call("x".repeat(257))).status).toBe(400);
    expect((await call("  O\u0308SLO   Sentrum  ")).status).toBe(200);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain("q=%C3%B6slo+sentrum");
  });

  it("serves cache hits before either rate gate", async () => {
    const cached = new Response(JSON.stringify({ results: [{ id: "1", label: "Cached", lat: 59.9, lon: 10.7 }] }));
    setCache({ match: vi.fn().mockResolvedValue(cached), put: vi.fn() });
    expect((await call("Oslo")).status).toBe(200);
    expect(takeRateLimitTokenMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("applies configured caller defense and a one-per-second isolate miss gate", async () => {
    takeRateLimitTokenMock
      .mockReturnValueOnce({ allowed: true, remaining: 16, retryAfterSec: 0 })
      .mockReturnValueOnce({ allowed: true, remaining: 0, retryAfterSec: 0 })
      .mockReturnValueOnce({ allowed: true, remaining: 15, retryAfterSec: 0 })
      .mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 1 });
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify([result()]), { headers: { "content-type": "application/json" } }));
    expect((await call("Oslo", env("17"))).status).toBe(200);
    expect(parsePerMinuteLimitMock).toHaveBeenCalledWith("17", 60);
    expect(takeRateLimitTokenMock).toHaveBeenCalledWith({ key: "geocode:198.51.100.10", limit: 17 });
    expect(takeRateLimitTokenMock).toHaveBeenCalledWith({ key: "geocode:provider-cache-miss", limit: 1, windowMs: 1_000 });
    const gated = await call("Bergen");
    expect(gated.status).toBe(429);
    expect(gated.headers.get("retry-after")).toBe("1");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves caller 429 retry behavior", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 7 });
    const response = await call("Oslo");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("preserves upstream 429 with a sanitized retry value", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("limited", {
      status: 429,
      headers: { "retry-after": "99999" },
    }));
    const response = await call("Oslo");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts exact response boundaries and rejects bytes, depth, records, types, or ranges beyond them", async () => {
    const exactSix = Array.from({ length: 6 }, (_, index) => result({ place_id: index + 1 }));
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(exactSix), { headers: { "content-type": "application/json" } }));
    expect((await call("first")).status).toBe(200);

    setCache({ match: vi.fn().mockResolvedValue(undefined), put: vi.fn() });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify([...exactSix, result({ place_id: 7 })]), { headers: { "content-type": "application/json" } }));
    expect((await call("records")).status).toBe(502);

    for (const [query, payload] of [
      ["depth", [result({ extra: { nested: { tooDeep: true } } })]],
      ["type", [result({ display_name: 42 })]],
      ["range", [result({ lat: "91" })]],
    ] as const) {
      setCache({ match: vi.fn().mockResolvedValue(undefined), put: vi.fn() });
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
      expect((await call(query)).status).toBe(502);
    }

    const base = JSON.stringify([result()]);
    const exactBytes = `${base}${" ".repeat(64 * 1024 - base.length)}`;
    setCache({ match: vi.fn().mockResolvedValue(undefined), put: vi.fn() });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(exactBytes, { headers: { "content-type": "application/json" } }));
    expect((await call("bytes exact")).status).toBe(200);
    setCache({ match: vi.fn().mockResolvedValue(undefined), put: vi.fn() });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(`${exactBytes} `, { headers: { "content-type": "application/json" } }));
    expect((await call("bytes overflow")).status).toBe(502);
  });

  it("aborts the provider after ten seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = call("timeout");
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(504);
  });

  it("keeps the ten-second deadline active while the response body is streaming", async () => {
    vi.useFakeTimers();
    let bodyAborted = false;
    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            bodyAborted = true;
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      });
      return Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } }));
    });

    const pending = call("stream timeout");
    await vi.advanceTimersByTimeAsync(10_001);

    expect((await pending).status).toBe(504);
    expect(bodyAborted).toBe(true);
  });
});
