import { describe, expect, it } from "vitest";
import { inspectAuthRequest, verifyAuth } from "./auth";
import type { Env } from "./types";

const makeEnv = (overrides?: Partial<Env>): Env =>
  ({
    DB: {} as D1Database,
    ...overrides,
  }) as Env;

describe("auth inspection", () => {
  it("detects available Cloudflare auth headers", () => {
    const request = new Request("https://example.test/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "user@example.com",
        "Cf-Access-Authenticated-User-Id": "sub-123",
      },
    });
    const inspected = inspectAuthRequest(request);
    expect(inspected.hasEmailHeader).toBe(true);
    expect(inspected.hasUserIdHeader).toBe(true);
    expect(inspected.hasJwtAssertion).toBe(false);
  });
});

describe("verifyAuth", () => {
  it("returns null without auth signals when dev fallback is disabled", async () => {
    const request = new Request("https://example.test/api/me");
    const auth = await verifyAuth(request, makeEnv({ ALLOW_INSECURE_DEV_AUTH: "false" }));
    expect(auth).toBeNull();
  });

  it("accepts header-based auth when user headers are present", async () => {
    const request = new Request("https://example.test/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "user@example.com",
      },
    });
    const auth = await verifyAuth(request, makeEnv());
    expect(auth?.userId).toBe("user@example.com");
    expect(auth?.source).toBe("headers");
  });

  it("falls back to insecure dev auth when enabled", async () => {
    const request = new Request("https://example.test/api/me");
    const auth = await verifyAuth(
      request,
      makeEnv({ ALLOW_INSECURE_DEV_AUTH: "true", DEV_AUTH_USER_ID: "local-dev" }),
    );
    expect(auth?.userId).toBe("local-dev");
    expect(auth?.source).toBe("dev");
  });
});
