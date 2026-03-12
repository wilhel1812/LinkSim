import { describe, expect, it } from "vitest";
import { getClientAddress, takeRateLimitToken } from "./rateLimit";

describe("rate limit helpers", () => {
  it("extracts client address from Cloudflare and forwarded headers", () => {
    const cfReq = new Request("https://example.test", {
      headers: { "cf-connecting-ip": " 203.0.113.9 " },
    });
    expect(getClientAddress(cfReq)).toBe("203.0.113.9");

    const fwdReq = new Request("https://example.test", {
      headers: { "x-forwarded-for": "198.51.100.10, 10.0.0.2" },
    });
    expect(getClientAddress(fwdReq)).toBe("198.51.100.10");

    const unknownReq = new Request("https://example.test");
    expect(getClientAddress(unknownReq)).toBe("unknown");
  });

  it("enforces limits within a window and resets after expiry", () => {
    const key = `test-limit-${Date.now()}-a`;
    const first = takeRateLimitToken({ key, limit: 2, windowMs: 5_000, nowMs: 1_000 });
    const second = takeRateLimitToken({ key, limit: 2, windowMs: 5_000, nowMs: 1_100 });
    const blocked = takeRateLimitToken({ key, limit: 2, windowMs: 5_000, nowMs: 1_200 });
    const afterWindow = takeRateLimitToken({ key, limit: 2, windowMs: 5_000, nowMs: 6_100 });

    expect(first).toMatchObject({ allowed: true, remaining: 1, retryAfterSec: 0 });
    expect(second).toMatchObject({ allowed: true, remaining: 0, retryAfterSec: 0 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(afterWindow).toMatchObject({ allowed: true, remaining: 1, retryAfterSec: 0 });
  });

  it("normalizes invalid limits to a minimum of one request", () => {
    const key = `test-limit-${Date.now()}-b`;
    const first = takeRateLimitToken({ key, limit: Number.NaN, nowMs: 10_000 });
    const second = takeRateLimitToken({ key, limit: Number.NaN, nowMs: 10_100 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
