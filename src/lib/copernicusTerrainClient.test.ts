import { describe, expect, it } from "vitest";
import { resolveRetryDelayMs, type RetryPolicy } from "./copernicusTerrainClient";

const policy: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 3000,
};

describe("copernicus retry delay", () => {
  it("uses exponential backoff when retry-after is absent", () => {
    expect(resolveRetryDelayMs(policy, 1, null)).toBe(500);
    expect(resolveRetryDelayMs(policy, 2, null)).toBe(1000);
    expect(resolveRetryDelayMs(policy, 3, null)).toBe(2000);
  });

  it("caps retry delay to configured max", () => {
    const response = new Response("", {
      status: 429,
      headers: { "retry-after": "120" },
    });
    expect(resolveRetryDelayMs(policy, 1, response)).toBe(3000);
  });

  it("respects retry-after when lower than cap", () => {
    const response = new Response("", {
      status: 429,
      headers: { "retry-after": "2" },
    });
    expect(resolveRetryDelayMs(policy, 2, response)).toBe(2000);
  });
});
