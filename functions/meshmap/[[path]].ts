import { stripSensitiveProxyResponseHeaders } from "../_lib/proxy";
import { getClientAddress, parsePerMinuteLimit, takeRateLimitToken } from "../_lib/rateLimit";
import { readBoundedJsonResponse } from "../_lib/boundedUpstream";
import type { Env } from "../_lib/types";
import { MESHMAP_MAX_RECORDS, MESHMAP_MAX_RESPONSE_BYTES } from "../../src/lib/nodeFeedLimits";

const MESHMAP_PATH = "/meshmap/nodes.json";
const MESHMAP_UPSTREAM = "https://meshmap.net/nodes.json";
const SUCCESS_CACHE_CONTROL = "public, max-age=1800";

const passiveHeaders = (
  contentType: string,
  filename: string,
  cacheControl: string,
  extra?: HeadersInit,
): Headers => {
  const headers = new Headers(extra);
  headers.set("content-type", contentType);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", cacheControl);
  return stripSensitiveProxyResponseHeaders(headers);
};

const localError = (message: string, status: number, extra?: HeadersInit): Response =>
  new Response(message, {
    status,
    headers: passiveHeaders("text/plain; charset=utf-8", "nodes.txt", "no-store", extra),
  });

const isJsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.pathname !== MESHMAP_PATH) return localError("Not found", 404);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return localError("Method not allowed", 405, { allow: "GET, HEAD" });
  }
  if (url.search) return localError("Query parameters are not allowed", 400);

  const limiter = takeRateLimitToken({
    key: `proxy:meshmap:${getClientAddress(request)}`,
    limit: parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 120, 1),
  });
  if (!limiter.allowed) {
    return localError("Rate limit reached", 429, {
      "retry-after": String(limiter.retryAfterSec),
      "x-rate-limit-source": "proxy",
    });
  }

  let response: Response;
  try {
    response = await fetch(MESHMAP_UPSTREAM, {
      method: request.method,
      headers: { accept: "application/json" },
    });
  } catch {
    return localError("MeshMap upstream request failed", 502);
  }

  if (!response.ok) {
    const extra = new Headers();
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) extra.set("retry-after", retryAfter);
    if (response.status === 429) extra.set("x-rate-limit-source", "upstream");
    return localError("MeshMap upstream request failed", response.status, extra);
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    return localError("MeshMap upstream returned an unsupported content type", 502);
  }

  let body: BodyInit | null = null;
  if (request.method !== "HEAD") {
    try {
      body = (await readBoundedJsonResponse(response, {
        maxBytes: MESHMAP_MAX_RESPONSE_BYTES,
        maxRecords: MESHMAP_MAX_RECORDS,
      })).bytes;
    } catch {
      return localError("MeshMap upstream returned an invalid or oversized node feed", 502);
    }
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: passiveHeaders("application/json; charset=utf-8", "nodes.json", SUCCESS_CACHE_CONTROL),
  });
};
