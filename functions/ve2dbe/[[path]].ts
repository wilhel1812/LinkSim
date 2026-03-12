import { handleOptions } from "../_lib/http";
import { getClientAddress, takeRateLimitToken } from "../_lib/rateLimit";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/ve2dbe/, "");
  const isTileListEndpoint = upstreamPath === "/geodata/gettile.asp";
  const allowsPost = isTileListEndpoint;
  const methodAllowed =
    request.method === "GET" || request.method === "HEAD" || (allowsPost && request.method === "POST");

  if (!methodAllowed) {
    return new Response("Method not allowed", { status: 405 });
  }

  const ip = getClientAddress(request);
  const rateLimitKey = isTileListEndpoint ? `proxy:ve2dbe:tilelist:${ip}` : `proxy:ve2dbe:${ip}`;
  const rateLimit = isTileListEndpoint
    ? parsePerMinuteLimit(env.VE2DBE_TILELIST_RATE_LIMIT_PER_MINUTE, 600)
    : parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 120);
  const limiter = takeRateLimitToken({
    key: rateLimitKey,
    limit: rateLimit,
  });
  if (!limiter.allowed) {
    return new Response("Rate limit reached", {
      status: 429,
      headers: {
        "retry-after": String(limiter.retryAfterSec),
      },
    });
  }

  const upstream = new URL(`https://www.ve2dbe.com${upstreamPath}${url.search}`);
  const contentType = request.headers.get("content-type");
  const shouldForwardBody = request.method === "POST" || request.method === "PUT" || request.method === "PATCH";

  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") ?? "*/*",
      ...(contentType ? { "content-type": contentType } : {}),
    },
    body: shouldForwardBody ? request.body : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
