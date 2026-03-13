import { handleOptions } from "../_lib/http";
import { getClientAddress, takeRateLimitToken } from "../_lib/rateLimit";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const DATASET_TO_BUCKET: Record<string, string> = {
  "30m": "https://copernicus-dem-30m.s3.amazonaws.com",
  "90m": "https://copernicus-dem-90m.s3.amazonaws.com",
};

const rateLimitIdentityFor = (request: Request): string => {
  const accessEmail = (request.headers.get("cf-access-authenticated-user-email") ?? "").trim().toLowerCase();
  if (accessEmail) return `user:${accessEmail}`;
  const clientIp = getClientAddress(request);
  if (clientIp && clientIp !== "unknown") return `ip:${clientIp}`;
  const userAgent = (request.headers.get("user-agent") ?? "").trim().toLowerCase();
  if (userAgent) return `ua:${userAgent}`;
  return "anon";
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/copernicus\//, "");
  const [dataset, ...restParts] = upstreamPath.split("/");
  const bucket = DATASET_TO_BUCKET[dataset];
  if (!bucket || !restParts.length) {
    return new Response("Unsupported Copernicus path", { status: 400 });
  }
  const objectPath = restParts.join("/");
  if (!objectPath.endsWith(".tif") && objectPath !== "tileList.txt") {
    return new Response("Unsupported object", { status: 400 });
  }
  const isTileList = objectPath === "tileList.txt";

  const limiter = takeRateLimitToken({
    key: `proxy:copernicus:${isTileList ? "tilelist" : "tile"}:${rateLimitIdentityFor(request)}`,
    limit: isTileList
      ? parsePerMinuteLimit(
          env.PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE,
          parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 240),
        )
      : parsePerMinuteLimit(
          env.PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE,
          parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 2400),
        ),
  });
  if (!limiter.allowed) {
    return new Response("Rate limit reached", {
      status: 429,
      headers: { "retry-after": String(limiter.retryAfterSec) },
    });
  }

  const upstream = new URL(`${bucket}/${objectPath}${url.search}`);
  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") ?? "*/*",
      ...(request.headers.get("range") ? { range: request.headers.get("range")! } : {}),
    },
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
