import { describe, expect, it, vi } from "vitest";

import { onRequest } from "./[[path]]";

const call = async (request: Request, runtime?: (request: Request) => Promise<Response>) => {
  const env = runtime
    ? { AUTH: { getByName: () => ({ checkSession: vi.fn(), fetch: runtime }) } }
    : {};
  return onRequest({ request, env } as unknown as Parameters<typeof onRequest>[0]);
};

describe("Better Auth Pages gateway", () => {
  it.each([
    ["POST", "/api/auth/sign-in/social"],
    ["GET", "/api/auth/callback/github?code=x&state=y"],
    ["POST", "/api/auth/sign-out"],
    ["GET", "/api/auth/passkey/generate-authenticate-options"],
    ["POST", "/api/auth/passkey/verify-authentication"],
    ["GET", "/api/auth/passkey/generate-register-options"],
    ["POST", "/api/auth/passkey/verify-registration"],
    ["GET", "/api/auth/passkey/list-user-passkeys"],
    ["POST", "/api/auth/passkey/update-passkey"],
    ["POST", "/api/auth/passkey/delete-passkey"],
  ])("forwards the allowed route %s %s", async (method, path) => {
    const runtime = vi.fn(async () => new Response(null, {
      status: 302,
      headers: [
        ["location", "https://github.com/login/oauth/authorize"],
        ["set-cookie", "better-auth.session=one; Secure; HttpOnly"],
      ],
    }));
    const response = await call(new Request(`https://staging.linksim.link${path}`, {
      method,
      headers: method === "POST" ? {
        origin: "https://staging.linksim.link",
        cookie: "source=one",
        authorization: "must-not-forward",
        "x-captcha-response": "turnstile-token",
      } : undefined,
      body: method === "POST" ? "{}" : undefined,
    }), runtime);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("github.com");
    expect(response.headers.get("set-cookie")).toContain("better-auth.session");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const forwarded = runtime.mock.calls[0][0];
    expect(forwarded.redirect).toBe("manual");
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(forwarded.headers.get("x-captcha-response")).toBe(method === "POST" ? "turnstile-token" : null);
  });

  it.each([
    ["GET", "/api/auth/sign-in/social"],
    ["POST", "/api/auth/callback/github"],
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/auth/callback/gitlab"],
  ])("returns 404 for unlisted route %s %s", async (method, path) => {
    const runtime = vi.fn(async () => new Response("unexpected"));
    expect((await call(new Request(`https://staging.linksim.link${path}`, { method }), runtime)).status)
      .toBe(404);
    expect(runtime).not.toHaveBeenCalled();
  });

  it("requires the exact origin for mutations", async () => {
    const runtime = vi.fn(async () => new Response(null));
    const response = await call(new Request("https://staging.linksim.link/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }), runtime);
    expect(response.status).toBe(403);
    expect(runtime).not.toHaveBeenCalled();
  });

  it("preserves every response cookie", async () => {
    const headers = new Headers({ location: "https://staging.linksim.link/return" });
    headers.append("set-cookie", "first=one; Secure; HttpOnly");
    headers.append("set-cookie", "second=two; Secure; HttpOnly");
    const response = await call(new Request(
      "https://staging.linksim.link/api/auth/callback/github?code=x&state=y",
    ), async () => new Response(null, { status: 302, headers }));
    const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    expect(responseHeaders.getSetCookie?.()).toEqual([
      "first=one; Secure; HttpOnly",
      "second=two; Secure; HttpOnly",
    ]);
  });

  it("returns 503 when the private runtime is missing or unavailable", async () => {
    expect((await call(new Request("https://staging.linksim.link/api/auth/callback/github"))).status)
      .toBe(503);
    expect((await call(
      new Request("https://staging.linksim.link/api/auth/callback/github"),
      async () => { throw new Error("offline"); },
    )).status).toBe(503);
  });
});
