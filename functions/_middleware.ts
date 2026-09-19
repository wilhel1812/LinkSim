import { authResponseCookies, verifyAuth, AuthRuntimeUnavailableError } from "./_lib/auth";
import {
  hasExactRequestOrigin,
  requiresApiAuthentication,
  requiresMutationOrigin,
} from "./_lib/apiRoutePolicy";
import { corsRejectionResponse, json, withCors } from "./_lib/http";
import type { AuthRequestData, Env } from "./_lib/types";

const CANONICAL_HOSTS: Readonly<Record<string, string>> = {
  "linksim-staging.pages.dev": "staging.linksim.link",
  "linksim.pages.dev": "linksim.link",
};

const authErrorResponse = (request: Request, status: 401 | 403 | 503, error: string) => {
  const response = withCors(request, json({ error }, { status }));
  response.headers.set("cache-control", "no-store");
  return response;
};

const appendAuthCookies = (response: Response, cookies: string[]): Response => {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const onRequest: PagesFunction<Env> = async ({ request, next, env, data }) => {
  const authData = data as AuthRequestData;
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    const corsRejection = corsRejectionResponse(request);
    if (corsRejection) return corsRejection;
  }

  const canonicalHost = CANONICAL_HOSTS[url.hostname.toLowerCase()];
  if (canonicalHost) {
    url.hostname = canonicalHost;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 308);
  }

  if (!requiresApiAuthentication(request)) {
    const response = await next();
    return url.pathname.startsWith("/api/")
      ? appendAuthCookies(response, authResponseCookies(request, authData))
      : response;
  }

  let auth;
  try {
    auth = await verifyAuth(request, env, authData);
  } catch (error) {
    if (error instanceof AuthRuntimeUnavailableError) {
      return authErrorResponse(request, 503, "Authentication service unavailable.");
    }
    throw error;
  }
  if (!auth) {
    return appendAuthCookies(
      authErrorResponse(request, 401, "Unauthorized."),
      authResponseCookies(request, authData),
    );
  }
  if (
    auth.source === "better-auth"
    && requiresMutationOrigin(request)
    && !hasExactRequestOrigin(request)
  ) {
    return authErrorResponse(request, 403, "Forbidden.");
  }

  return appendAuthCookies(
    await next(),
    authResponseCookies(request, authData),
  );
};
