import { DurableObject } from "cloudflare:workers";
import { betterAuth } from "better-auth";

import { makeAuthSessionLog, type AuthSessionResultCategory } from "./logging";
import { authRuntimeOptions, type AuthRuntimeEnv } from "./options";

const SESSION_HEADERS = [
  "cookie",
  "origin",
  "content-type",
  "accept",
  "user-agent",
  "cf-connecting-ip",
] as const;

const responseCookies = (headers: Headers): string[] => {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = withGetSetCookie.getSetCookie?.();
  if (cookies) return cookies;
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
};

export class AuthRuntime extends DurableObject<AuthRuntimeEnv> {
  private readonly auth;

  constructor(ctx: DurableObjectState, env: AuthRuntimeEnv) {
    super(ctx, env);
    this.auth = betterAuth(authRuntimeOptions(env));
  }

  async checkSession(request: Request) {
    const started = Date.now();
    const origin = new URL(this.env.AUTH_ORIGIN).origin;
    const incomingOrigin = request.headers.get("origin");
    if (request.method !== "GET" || (incomingOrigin !== null && incomingOrigin !== origin)) {
      console.info(JSON.stringify(makeAuthSessionLog(403, "rejected", Date.now() - started)));
      return { status: 403, setCookies: [] };
    }

    const headers = new Headers();
    for (const name of SESSION_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    try {
      const session = await this.auth.api.getSession({ headers, returnHeaders: true });
      const status = session.response ? 200 : 401;
      const result: AuthSessionResultCategory = session.response ? "ok" : "no-session";
      console.info(JSON.stringify(makeAuthSessionLog(status, result, Date.now() - started)));
      return session.response
        ? {
            status,
            authUserId: session.response.user.id,
            setCookies: responseCookies(session.headers),
          }
        : { status, setCookies: responseCookies(session.headers) };
    } catch {
      console.info(JSON.stringify(makeAuthSessionLog(500, "error", Date.now() - started)));
      return { status: 500, setCookies: [] };
    }
  }

  fetch() {
    return new Response(null, { status: 404 });
  }
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
