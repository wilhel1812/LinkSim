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

const PREFETCH_HEADER = "x-linksim-prefetch";
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

const parseTileCoordinates = (
  objectPath: string,
): { dataset: string; lat: number; lon: number } | null => {
  const tileMatch = objectPath.match(
    /^Copernicus_DSM_COG_(30|90)_((?:N\d{2})|(?:S\d{2}))_00_((?:E\d{3})|(?:W\d{3}))_00_DEM\/(.*)\.tif$/i,
  );
  if (!tileMatch) return null;
  const dataset = tileMatch[1] === "30" ? "30m" : "90m";
  const ns = tileMatch[2];
  const ew = tileMatch[3];
  const nsVal = Number(ns.slice(1));
  const ewVal = Number(ew.slice(1));
  const lat = ns.startsWith("N") ? nsVal : -nsVal;
  const lon = ew.startsWith("E") ? ewVal : -ewVal;
  return { dataset, lat, lon };
};

const neighborOffsets = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const buildNeighborUrls = (
  origin: string,
  dataset: string,
  lat: number,
  lon: number,
): string[] => {
  const res = dataset === "30m" ? "30" : "90";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const originName = `Copernicus_DSM_COG_${res}_${ns}${String(Math.abs(lat)).padStart(2, "0")}_00_${ew}${String(Math.abs(lon)).padStart(3, "0")}_DEM`;
  const originUrl = `${origin}/copernicus/${dataset}/${originName}/${originName}.tif`;
  return neighborOffsets.map(([dLat, dLon]) => {
    const nLat = lat + dLat;
    const nLon = lon + dLon;
    const nNs = nLat >= 0 ? "N" : "S";
    const nEw = nLon >= 0 ? "E" : "W";
    const name = `Copernicus_DSM_COG_${res}_${nNs}${String(Math.abs(nLat)).padStart(2, "0")}_00_${nEw}${String(Math.abs(nLon)).padStart(3, "0")}_DEM`;
    return `${origin}/copernicus/${dataset}/${name}/${name}.tif`;
  }).filter((url) => url !== originUrl);
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

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
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
  const isPrefetchRequest = (request.headers.get(PREFETCH_HEADER) ?? "") === "1";
  const shouldPrefetchNeighbors = env.PROXY_COPERNICUS_PREFETCH_NEIGHBORS === "1";
  const shouldUseCache = request.method === "GET";

  const upstream = new URL(`${bucket}/${objectPath}${url.search}`);
  const cacheKey = new Request(request.url, { method: "GET" });
  const cache = caches.default;

  const cached = shouldUseCache ? await cache.match(cacheKey) : null;
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Cache-Status", "HIT");
    headers.set(RATE_LIMIT_SOURCE_HEADER, "none");
    const response = new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });

    if (!isTileList && shouldPrefetchNeighbors) {
      const coords = parseTileCoordinates(objectPath);
      if (coords) {
        const neighborUrls = buildNeighborUrls(origin, coords.dataset, coords.lat, coords.lon);
        const safePrefetch = async () => {
          try {
            await Promise.allSettled(
              neighborUrls.map((neighborUrl) => {
                const fn = globalThis.fetch;
                if (typeof fn !== "function") return Promise.resolve();
                return fn(neighborUrl, {
                  method: "HEAD",
                  headers: { [PREFETCH_HEADER]: "1" },
                }).catch(() => undefined);
              }),
            );
          } catch {
            // best-effort
          }
        };
        waitUntil(safePrefetch());
      }
    }

    return response;
  }

  if (!isPrefetchRequest) {
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
