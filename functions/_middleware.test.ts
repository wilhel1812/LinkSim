import { describe, expect, it, vi } from "vitest";
import { onRequest } from "./_middleware";
import { verifyAuth } from "./_lib/auth";
import type { AuthRequestData, Env } from "./_lib/types";

const invoke = async (
  url: string,
  init?: RequestInit,
  env = { DB: {} as D1Database } as Env,
  nextImplementation: (request: Request, env: Env, data: AuthRequestData) => Promise<Response> = async () =>
    new Response("app", { status: 200 }),
) => {
  const request = new Request(url, init);
  const data: AuthRequestData = {};
  const next = vi.fn(() => nextImplementation(new Request(request.clone()), env, data));
  const response = await onRequest({ request, next, env, data } as never);
  return { response, next };
};

const betterAuthEnv = (
  checkSession: () => Promise<{ status: number; authUserId?: string; setCookies?: string[] }>,
): Env => ({
  DB: {
    prepare: () => ({
      bind: () => ({ first: async () => ({ auth_user_id: "auth-1", linksim_user_id: "linksim-1" }) }),
    }),
  } as unknown as D1Database,
  AUTH_SESSION_SOURCE: "better-auth",
  AUTH: { getByName: () => ({ checkSession }) },
});

describe("canonical Pages host middleware", () => {
  it.each([
    ["https://linksim-staging.pages.dev/Owner/Simulation?mode=test", "https://staging.linksim.link/Owner/Simulation?mode=test"],
    ["https://linksim.pages.dev/Owner/Simulation", "https://linksim.link/Owner/Simulation"],
  ])("redirects the raw Pages root %s", async (url, expected) => {
    const { response, next } = await invoke(url);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(expected);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "https://staging.linksim.link/",
    "https://linksim.link/",
    "https://6ed2da50.linksim-staging.pages.dev/",
  ])("passes canonical and immutable preview hosts through: %s", async (url) => {
    const { response, next } = await invoke(url);
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("API origin boundary", () => {
  it.each([
    ["PATCH", "administrator role mutation", "https://linksim.link/api/users/user-1"],
    ["DELETE", "user deletion", "https://linksim.link/api/users/user-1"],
    ["POST", "ownership reassignment", "https://linksim.link/api/admin-ownership-tools"],
    ["PUT", "Library write", "https://linksim.link/api/library"],
    ["DELETE", "Library deletion", "https://linksim.link/api/library/simulations/sim-1"],
    ["POST", "change revert", "https://linksim.link/api/changes"],
  ])("rejects cross-origin %s before the %s handler", async (method, _behavior, url) => {
    const { response, next } = await invoke(url, {
      method,
      headers: {
        origin: "https://attacker.example",
        cookie: "CF_Authorization=stolen-browser-cookie",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "mutation" }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a same-origin guest public Simulation read", async () => {
    const { response, next } = await invoke(
      "https://staging.linksim.link/api/public-simulation?sim=sim-1",
      { headers: { origin: "https://staging.linksim.link" } },
    );
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows an originless guest deep-link read", async () => {
    const { response, next } = await invoke(
      "https://linksim.link/api/deep-link-status?sim=sim-1",
    );
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not apply the API boundary to app routes", async () => {
    const { response, next } = await invoke("https://linksim.link/Owner/Simulation", {
      headers: { origin: "https://attacker.example" },
    });
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("API authentication boundary", () => {
  it("returns 401 before protected handlers without authentication", async () => {
    const { response, next } = await invoke("https://linksim.link/api/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(next).not.toHaveBeenCalled();
  });

  it("clears an expired Better Auth cookie on a 401 response", async () => {
    const { response, next } = await invoke(
      "https://staging.linksim.link/api/me",
      { headers: { cookie: "better-auth.session_token=expired" } },
      betterAuthEnv(async () => ({
        status: 401,
        setCookies: ["better-auth.session_token=; Max-Age=0; Secure; HttpOnly"],
      })),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(next).not.toHaveBeenCalled();
  });

  it("propagates an expired-session cleanup cookie from a public handler", async () => {
    let checks = 0;
    const env = betterAuthEnv(async () => {
      checks += 1;
      return {
        status: 401,
        setCookies: ["better-auth.session_token=; Max-Age=0; Secure; HttpOnly"],
      };
    });
    const { response } = await invoke(
      "https://staging.linksim.link/api/public-simulation?sim=sim-1",
      { headers: { cookie: "better-auth.session_token=expired" } },
      env,
      async (request, handlerEnv, data) => {
        expect(await verifyAuth(request, handlerEnv, data)).toBeNull();
        return new Response("public");
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(checks).toBe(1);
  });

  it("propagates a refreshed session cookie from an authenticated public handler", async () => {
    let checks = 0;
    const env = betterAuthEnv(async () => {
      checks += 1;
      return {
        status: 200,
        authUserId: "auth-1",
        setCookies: ["better-auth.session_token=refreshed; Secure; HttpOnly"],
      };
    });
    const { response } = await invoke(
      "https://staging.linksim.link/api/deep-link-status?sim=sim-1",
      { headers: { cookie: "better-auth.session_token=session" } },
      env,
      async (request, handlerEnv, data) => {
        expect((await verifyAuth(request, handlerEnv, data))?.userId).toBe("linksim-1");
        return new Response("public");
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_token=refreshed");
    expect(checks).toBe(1);
  });

  it("shares one Better Auth check and identity lookup with a cloned downstream request", async () => {
    let checks = 0;
    let identityLookups = 0;
    const env = betterAuthEnv(async () => {
      checks += 1;
      return {
        status: 200,
        authUserId: "auth-1",
        setCookies: ["better-auth.session_token=refreshed; Secure; HttpOnly"],
      };
    });
    env.DB = {
      prepare: () => {
        identityLookups += 1;
        return {
          bind: () => ({
            first: async () => ({ auth_user_id: "auth-1", linksim_user_id: "linksim-1" }),
          }),
        };
      },
    } as unknown as D1Database;
    const { response } = await invoke(
      "https://staging.linksim.link/api/library",
      { headers: { cookie: "better-auth.session_token=session" } },
      env,
      async (request, handlerEnv, data) => {
        expect((await verifyAuth(request, handlerEnv, data))?.userId).toBe("linksim-1");
        return new Response("app");
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_token=refreshed");
    expect(checks).toBe(1);
    expect(identityLookups).toBe(1);
  });

  it.each([
    [undefined, "missing"],
    ["https://attacker.example", "cross-origin"],
  ])("rejects a Better Auth mutation with a %s origin", async (origin) => {
    const headers = new Headers({
      cookie: "better-auth.session_token=session",
      "content-type": "application/json",
    });
    if (origin) headers.set("origin", origin);
    const { response, next } = await invoke(
      "https://staging.linksim.link/api/library",
      { method: "PUT", headers, body: "{}" },
      betterAuthEnv(async () => ({ status: 200, authUserId: "auth-1", setCookies: [] })),
    );
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an exact-origin Better Auth mutation", async () => {
    const { response, next } = await invoke(
      "https://staging.linksim.link/api/library",
      {
        method: "PUT",
        headers: {
          cookie: "better-auth.session_token=session",
          origin: "https://staging.linksim.link",
          "content-type": "application/json",
        },
        body: "{}",
      },
      betterAuthEnv(async () => ({ status: 200, authUserId: "auth-1", setCookies: [] })),
    );
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("preserves originless Access requests during transition fallback", async () => {
    const env = {
      DB: {} as D1Database,
      AUTH_SESSION_SOURCE: "transition" as const,
      AUTH: { getByName: () => ({ checkSession: async () => ({
        status: 401,
        setCookies: ["better-auth.session_token=; Max-Age=0; Secure; HttpOnly"],
      }) }) },
    };
    const { response, next } = await invoke(
      "https://staging.linksim.link/api/library",
      {
        method: "PUT",
        headers: { "cf-access-authenticated-user-id": "access-user", "content-type": "application/json" },
        body: "{}",
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(next).toHaveBeenCalledOnce();
  });
});
