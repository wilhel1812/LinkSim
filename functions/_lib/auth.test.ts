import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import {
  AuthRuntimeUnavailableError,
  authResponseCookies,
  inspectAuthRequest,
  verifyAuth,
  verifyFreshAccessJwt,
} from "./auth";
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

describe("fresh Access migration proof", () => {
  const now = Date.parse("2026-09-21T10:05:00.000Z");
  const request = (headers: HeadersInit) => new Request(
    "https://staging.linksim.link/api/auth/legacy-access/start",
    { headers },
  );
  const env = makeEnv({ ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "legacy-migration" });

  it("accepts only a freshly issued exact JWT assertion", async () => {
    const proof = await verifyFreshAccessJwt(
      request({ "cf-access-jwt-assertion": "signed" }),
      env,
      now,
      async () => ({
        iss: "https://team.example", aud: "legacy-migration", sub: "legacy-user",
        iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 3600,
      }),
    );
    expect(proof).toEqual({
      userId: "legacy-user",
      issuedAt: "2026-09-21T10:04:00.000Z",
    });
  });

  it.each([
    ["header-only", { "cf-access-authenticated-user-id": "legacy-user" }, 60],
    ["cookie-only", { cookie: "CF_Authorization=signed" }, 60],
    ["stale", { "cf-access-jwt-assertion": "signed" }, 301],
    ["future", { "cf-access-jwt-assertion": "signed" }, -31],
  ])("rejects %s proof", async (_name, headers, ageSeconds) => {
    await expect(verifyFreshAccessJwt(request(headers), env, now, async () => ({
      iss: "https://team.example", aud: "legacy-migration", sub: "legacy-user",
      iat: Math.floor(now / 1000) - ageSeconds, exp: Math.floor(now / 1000) + 3600,
    }))).resolves.toBeNull();
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
      undefined,
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
      undefined,
      decodeTestJwt,
    );

    expect(auth?.userId).toBe("user-123");
    expect(auth?.source).toBe("jwt");
  });

  it("prefers the verified JWT subject over an email identity header", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const request = new Request("https://preview.linksim-staging.pages.dev/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "user@example.com",
        cookie: `CF_Authorization=${accessJwt({
          iss: "https://team.example",
          sub: "stable-user-uuid",
          email: "user@example.com",
          aud: "preview-aud",
          exp,
        })}`,
      },
    });

    const auth = await verifyAuth(
      request,
      makeEnv({ ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "preview-aud" }),
      undefined,
      decodeTestJwt,
    );

    expect(auth?.userId).toBe("stable-user-uuid");
    expect(auth?.verifiedIdpEmail).toBe("user@example.com");
  });

  it("does not treat header-only email as verified IdP identity evidence", async () => {
    const request = new Request("https://example.test/api/me", {
      headers: { "Cf-Access-Authenticated-User-Email": "user@example.com" },
    });

    const auth = await verifyAuth(request, makeEnv());

    expect(auth?.userId).toBe("user@example.com");
    expect(auth?.verifiedIdpEmail).toBeUndefined();
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
      undefined,
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
      undefined,
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
      undefined,
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
      undefined,
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

  it("checks the private runtime once per request and maps the Better Auth user", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: { cookie: "better-auth.session_token=session" },
    });
    let checks = 0;
    const env = makeEnv({
      AUTH_SESSION_SOURCE: "better-auth",
      AUTH: {
        getByName: () => ({
          checkSession: async (forwarded: Request) => {
            checks += 1;
            expect(forwarded.headers.get("cookie")).toContain("better-auth.session_token");
            expect(forwarded.headers.get("cf-access-jwt-assertion")).toBeNull();
            return {
              status: 200,
              authUserId: "auth-1",
              setCookies: ["better-auth.session_token=refreshed; Secure; HttpOnly"],
            };
          },
        }),
      },
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => ({ auth_user_id: "auth-1", linksim_user_id: "linksim-1" }) }),
        }),
      } as unknown as D1Database,
    });

    const first = await verifyAuth(request, env);
    const second = await verifyAuth(request, env);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      userId: "linksim-1",
      source: "better-auth",
      authUserId: "auth-1",
      setCookieHeaders: ["better-auth.session_token=refreshed; Secure; HttpOnly"],
    });
    expect(checks).toBe(1);
  });

  it("does not fall back to Access when an authenticated Better Auth identity is unmapped", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: { "cf-access-authenticated-user-id": "access-user" },
    });
    const auth = await verifyAuth(request, makeEnv({
      AUTH_SESSION_SOURCE: "transition",
      AUTH: { getByName: () => ({ checkSession: async () => ({ status: 200, authUserId: "auth-1", setCookies: [] }) }) },
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => null }) }),
      } as unknown as D1Database,
    }));
    expect(auth).toBeNull();
  });

  it("falls back to Access for no Better Auth session only in transition mode", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: { "cf-access-authenticated-user-id": "access-user" },
    });
    const auth = await verifyAuth(request, makeEnv({
      AUTH_SESSION_SOURCE: "transition",
      AUTH: { getByName: () => ({ checkSession: async () => ({
        status: 401,
        setCookies: ["better-auth.session_token=; Max-Age=0; Secure; HttpOnly"],
      }) }) },
    }));
    expect(auth).toMatchObject({ userId: "access-user", source: "headers" });
    expect(authResponseCookies(request)).toEqual([
      "better-auth.session_token=; Max-Age=0; Secure; HttpOnly",
    ]);
  });

  it.each(["no-session", "runtime-unavailable"])(
    "reuses a mapped LinkSim identity for an Access-only tab after %s fallback",
    async (mode) => {
      const request = new Request("https://staging.linksim.link/api/me", {
        headers: {
          "cf-access-jwt-assertion": accessJwt({
            iss: "https://team.example",
            sub: "access-subject",
            email: " Mapped@Example.ORG ",
            aud: ["staging-aud"],
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        },
      });
      const runtime = mode === "no-session"
        ? { getByName: () => ({ checkSession: async () => ({ status: 401, setCookies: [] }) }) }
        : { getByName: () => ({ checkSession: async () => { throw new Error("offline"); } }) };
      const db = {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              current_user_id: "linksim-mapped",
              claim_status: "active",
              auth_user_id: "auth-1",
              linksim_user_id: "linksim-mapped",
              user_id: "linksim-mapped",
              idp_email: "mapped@example.org",
              idp_email_verified: 1,
              deleted_id: null,
              subject_status: "current",
              subject_email: "mapped@example.org",
              canonical_user_id: "linksim-mapped",
              is_admin: 0,
              is_moderator: 0,
              is_approved: 1,
            }),
          }),
        }),
      } as unknown as D1Database;
      const auth = await verifyAuth(request, makeEnv({
        AUTH_SESSION_SOURCE: "transition",
        AUTH: runtime,
        DB: db,
        ACCESS_AUD: "staging-aud",
        ACCESS_TEAM_DOMAIN: "team.example",
      }), undefined, decodeTestJwt);
      expect(auth).toMatchObject({
        userId: "linksim-mapped",
        source: "jwt",
        tokenPayload: { __linksim_better_auth_mapped: true },
      });
    },
  );

  it("fails closed when an Access email has an invalid mapped claim", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: {
        "cf-access-jwt-assertion": accessJwt({
          iss: "https://team.example",
          sub: "access-subject",
          email: "mapped@example.org",
          aud: ["staging-aud"],
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      },
    });
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => ({
        current_user_id: "linksim-mapped",
        claim_status: "blocked",
        auth_user_id: "auth-1",
        linksim_user_id: "linksim-mapped",
        user_id: "linksim-mapped",
        idp_email: "mapped@example.org",
        idp_email_verified: 1,
        deleted_id: null,
        subject_status: "current",
        subject_email: "mapped@example.org",
        canonical_user_id: "linksim-mapped",
        is_admin: 0,
        is_moderator: 0,
        is_approved: 1,
      }) }) }),
    } as unknown as D1Database;
    await expect(verifyAuth(request, makeEnv({
      AUTH_SESSION_SOURCE: "transition",
      AUTH: { getByName: () => ({ checkSession: async () => ({ status: 401, setCookies: [] }) }) },
      DB: db,
      ACCESS_AUD: "staging-aud",
      ACCESS_TEAM_DOMAIN: "team.example",
    }), undefined, decodeTestJwt)).rejects.toBeInstanceOf(AuthRuntimeUnavailableError);
  });

  it("preserves ordinary unmapped Access fallback behavior", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: {
        "cf-access-jwt-assertion": accessJwt({
          iss: "https://team.example",
          sub: "access-subject",
          email: "ordinary@example.org",
          aud: ["staging-aud"],
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      },
    });
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;
    const auth = await verifyAuth(request, makeEnv({
      AUTH_SESSION_SOURCE: "transition",
      AUTH: { getByName: () => ({ checkSession: async () => ({ status: 401, setCookies: [] }) }) },
      DB: db,
      ACCESS_AUD: "staging-aud",
      ACCESS_TEAM_DOMAIN: "team.example",
    }), undefined, decodeTestJwt);
    expect(auth).toMatchObject({ userId: "access-subject", source: "jwt" });
    expect(auth?.tokenPayload).not.toHaveProperty("__linksim_better_auth_mapped");
  });

  it("never maps an unverified header-only email", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: {
        "cf-access-authenticated-user-id": "access-subject",
        "cf-access-authenticated-user-email": "mapped@example.org",
      },
    });
    const db = {
      prepare: () => { throw new Error("header email must not be queried"); },
    } as unknown as D1Database;
    const auth = await verifyAuth(request, makeEnv({
      AUTH_SESSION_SOURCE: "transition",
      AUTH: { getByName: () => ({ checkSession: async () => ({ status: 401, setCookies: [] }) }) },
      DB: db,
    }));
    expect(auth).toMatchObject({ userId: "access-subject", source: "headers" });
  });

  it("falls back on runtime failure only in transition mode and fails closed after cutover", async () => {
    const runtime = { getByName: () => ({ checkSession: async () => { throw new Error("offline"); } }) };
    const transitionRequest = new Request("https://staging.linksim.link/api/me", {
      headers: { "cf-access-authenticated-user-id": "access-user" },
    });
    await expect(verifyAuth(transitionRequest, makeEnv({
      AUTH_SESSION_SOURCE: "transition", AUTH: runtime,
    }))).resolves.toMatchObject({ userId: "access-user" });

    const cutoverRequest = new Request("https://staging.linksim.link/api/me");
    await expect(verifyAuth(cutoverRequest, makeEnv({
      AUTH_SESSION_SOURCE: "better-auth", AUTH: runtime,
    }))).rejects.toBeInstanceOf(AuthRuntimeUnavailableError);
  });

  it("never switches to Access after Better Auth succeeds but mapping resolution fails", async () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: { "cf-access-authenticated-user-id": "different-access-user" },
    });
    const env = makeEnv({
      AUTH_SESSION_SOURCE: "transition",
      AUTH: {
        getByName: () => ({
          checkSession: async () => ({ status: 200, authUserId: "auth-1", setCookies: [] }),
        }),
      },
      DB: {
        prepare: () => { throw new Error("D1 unavailable"); },
      } as unknown as D1Database,
    });

    await expect(verifyAuth(request, env)).rejects.toBeInstanceOf(AuthRuntimeUnavailableError);
  });
});
