import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
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
  const decodeTestJwt = async (token: string) => decodeJwt(token);
  const accessJwt = (payload: Record<string, unknown>): string => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString(
      "base64url",
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${encodedPayload}.signature`;
  };

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

  it("fails closed when a configured audience cannot be verified", async () => {
    const request = new Request("https://example.test/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "user@example.com",
        cookie: "CF_Authorization=not-a-real-jwt",
      },
    });
    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_AUD: "aud", ACCESS_TEAM_DOMAIN: "team.example" }),
      decodeTestJwt,
    );
    expect(auth).toBeNull();
  });

  it("accepts a JWT whose audience matches one configured Access application", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const request = new Request("https://preview.linksim-staging.pages.dev/api/me", {
      headers: {
        cookie: `CF_Authorization=${accessJwt({
          iss: "https://team.example",
          sub: "user-123",
          aud: ["preview-aud", "another-aud"],
          exp,
        })}`,
      },
    });

    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "staging-aud, preview-aud" }),
      decodeTestJwt,
    );

    expect(auth?.userId).toBe("user-123");
    expect(auth?.source).toBe("jwt");
  });

  it("rejects a JWT whose audience is not configured", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const request = new Request("https://preview.linksim-staging.pages.dev/api/me", {
      headers: {
        cookie: `CF_Authorization=${accessJwt({
          iss: "https://team.example",
          sub: "user-123",
          aud: "unknown-aud",
          exp,
        })}`,
      },
    });

    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "staging-aud,preview-aud" }),
      decodeTestJwt,
    );

    expect(auth).toBeNull();
  });

  it("does not let identity headers bypass a configured audience check", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const request = new Request("https://preview.linksim-staging.pages.dev/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "user@example.com",
        "Cf-Access-Jwt-Assertion": accessJwt({
          iss: "https://team.example",
          sub: "user-123",
          aud: "wrong-aud",
          exp,
        }),
      },
    });

    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "preview-aud" }),
      decodeTestJwt,
    );

    expect(auth).toBeNull();
  });

  it("rejects header-only identity when an audience is configured", async () => {
    const request = new Request("https://preview.linksim-staging.pages.dev/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "user@example.com",
      },
    });

    const auth = await verifyAuth(request, makeEnv({ ACCESS_AUD: "preview-aud" }));

    expect(auth).toBeNull();
  });

  it("returns null when CF_Authorization JWT has no valid user identity", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "https://team.example" })).toString("base64url");
    const request = new Request("https://example.test/api/me", {
      headers: {
        cookie: `CF_Authorization=${header}.${payload}.signature`,
      },
    });
    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_TEAM_DOMAIN: "team.example" }),
      decodeTestJwt,
    );
    expect(auth).toBeNull();
  });

  it("decodes a valid CF_Authorization JWT and returns the user identity", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ iss: "https://team.example", sub: "user-123", email: "user@example.com", exp })).toString("base64url");
    const request = new Request("https://example.test/api/me", {
      headers: {
        cookie: `CF_Authorization=${header}.${payload}.signature`,
      },
    });
    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_TEAM_DOMAIN: "team.example" }),
      decodeTestJwt,
    );
    expect(auth?.userId).toBe("user-123");
    expect(auth?.source).toBe("jwt");
  });

  it("rejects an unsigned token through the production verifier", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const request = new Request("https://preview.linksim-staging.pages.dev/api/me", {
      headers: {
        cookie: `CF_Authorization=${accessJwt({
          iss: "https://team.example",
          sub: "user-123",
          aud: "preview-aud",
          exp,
        })}`,
      },
    });

    const auth = await verifyAuth(request, makeEnv({ ACCESS_AUD: "preview-aud" }));

    expect(auth).toBeNull();
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
