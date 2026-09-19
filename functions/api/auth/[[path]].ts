import { hasExactRequestOrigin, isExposedAuthRoute, requiresMutationOrigin } from "../../_lib/apiRoutePolicy";
import type { Env } from "../../_lib/types";

const FORWARDED_HEADERS = [
  "cookie",
  "origin",
  "content-type",
  "accept",
  "user-agent",
  "cf-connecting-ip",
  "x-captcha-response",
] as const;

const hardened = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const empty = (status: number) => hardened(new Response(null, { status }));

const forwardedRequest = async (request: Request): Promise<Request> => {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(request.url, {
    method: request.method,
    headers,
    body: requiresMutationOrigin(request) ? await request.arrayBuffer() : undefined,
  });
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!isExposedAuthRoute(request)) return empty(404);
  if (requiresMutationOrigin(request) && !hasExactRequestOrigin(request)) return empty(403);
  if (!env.AUTH) return empty(503);

  try {
    const response = await env.AUTH.getByName("auth").handleAuth(
      await forwardedRequest(request),
    );
    return hardened(response);
  } catch {
    return empty(503);
  }
};
