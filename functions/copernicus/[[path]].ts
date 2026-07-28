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

const RATE_LIMIT_SOURCE_HEADER = "X-Rate-Limit-Source";

const rateLimitIdentityFor = (request: Request): string => {
  const accessEmail = (request.headers.get("cf-access-authenticated-user-email") ?? "").trim().toLowerCase();
  if (accessEmail) return `user:${accessEmail}`;
  const clientIp = getClientAddress(request);
  if (clientIp && clientIp !== "unknown") return `ip:${clientIp}`;
  const userAgent = (request.headers.get("user-agent") ?? "").trim().toLowerCase();
  if (userAgent) return `ua:${userAgent}`;
  return "anon";
};

const addRateLimitHeaders = (headers: Headers, limiter: { allowed: boolean; remaining: number; retryAfterSec: number }, limit: number): void => {
  headers.set("X-Rate-Limit-Limit", String(limit));
  headers.set("X-Rate-Limit-Remaining", String(Math.max(0, limiter.remaining)));
  headers.set("X-Rate-Limit-Window", String(limiter.retryAfterSec));
};

const parseRateLimit = (env: Env, isTileList: boolean): number => isTileList
  ? parsePerMinuteLimit(
      env.PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE,
      parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 240),
    )
  : parsePerMinuteLimit(
      env.PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE,
      parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 2400),
    );

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
  const shouldUseCache = request.method === "GET";

  const upstream = new URL(`${bucket}/${objectPath}${url.search}`);
  const cacheKey = new Request(request.url, { method: "GET" });
  const cache = caches.default;

  const cached = shouldUseCache ? await cache.match(cacheKey) : null;
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Cache-Status", "HIT");
    headers.set(RATE_LIMIT_SOURCE_HEADER, "none");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const rateLimitKey = `proxy:copernicus:${isTileList ? "tilelist" : "tile"}:${rateLimitIdentityFor(request)}`;
  const limit = parseRateLimit(env, isTileList);
  const limiter = takeRateLimitToken({ key: rateLimitKey, limit });
  if (!limiter.allowed) {
    const headers = new Headers({
      "retry-after": String(limiter.retryAfterSec),
      "X-Cache-Status": "MISS",
      [RATE_LIMIT_SOURCE_HEADER]: "proxy",
      "cache-control": "no-store",
    });
    addRateLimitHeaders(headers, limiter, limit);
    return new Response("Rate limit reached", { status: 429, headers });
  }

  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") ?? "*/*",
      ...(request.headers.get("range") ? { range: request.headers.get("range")! } : {}),
    },
  });

  if (response.ok) {
    const headers = new Headers(response.headers);
    headers.set("X-Cache-Status", "MISS");
    headers.set(RATE_LIMIT_SOURCE_HEADER, "none");
    headers.set("cache-control", isTileList ? "public, max-age=3600, s-maxage=21600" : "public, max-age=86400, s-maxage=604800");
    headers.delete("set-cookie");
    addRateLimitHeaders(headers, limiter, limit);
    const cacheable = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    if (shouldUseCache) {
      await cache.put(cacheKey, cacheable.clone());
    }
    return cacheable;
  }

  const missHeaders = new Headers(response.headers);
  missHeaders.set("X-Cache-Status", "MISS");
  missHeaders.set(RATE_LIMIT_SOURCE_HEADER, response.status === 429 ? "upstream" : "none");
  missHeaders.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: missHeaders });
};
