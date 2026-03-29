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
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ip = getClientAddress(request);
  const limiter = takeRateLimitToken({
    key: `proxy:meshmap:${ip}`,
    limit: parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 120),
  });
  if (!limiter.allowed) {
    return new Response("Rate limit reached", {
      status: 429,
      headers: {
        "retry-after": String(limiter.retryAfterSec),
      },
    });
  }

  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/meshmap/, "");
  const upstream = new URL(`https://meshmap.net${upstreamPath}${url.search}`);

  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") ?? "*/*",
    },
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "public, max-age=1800");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
