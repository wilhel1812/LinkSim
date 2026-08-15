import { readBoundedJsonResponse } from "../_lib/boundedUpstream";
import { ApiRequestError, errorResponse, handleOptions, json, withCors } from "../_lib/http";
import { getClientAddress, parsePerMinuteLimit, takeRateLimitToken } from "../_lib/rateLimit";
import type { Env } from "../_lib/types";
import {
  GEOCODE_CACHE_TTL_MS,
  GEOCODE_PROVIDER_TIMEOUT_MS,
  GEOCODE_QUERY_MAX_CHARS,
  GEOCODE_QUERY_MIN_CHARS,
  GEOCODE_RESPONSE_MAX_BYTES,
  GEOCODE_RESPONSE_MAX_DEPTH,
  GEOCODE_RESULT_MAX_RECORDS,
  normalizeGeocodeQuery,
  validateNominatimResults,
} from "../../src/lib/geocodeLimits";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const query = normalizeGeocodeQuery(url.searchParams.get("q") ?? "");

    if (!query) return withCors(request, json({ results: [] }));
    if (query.length < GEOCODE_QUERY_MIN_CHARS || query.length > GEOCODE_QUERY_MAX_CHARS) {
      return withCors(request, json({ error: "Search query must be between 3 and 256 characters." }, { status: 400 }));
    }

    const cacheUrl = new URL(request.url);
    cacheUrl.search = "";
    cacheUrl.searchParams.set("q", query);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return withCors(request, cached);

    const callerLimit = parsePerMinuteLimit(env.GEOCODE_RATE_LIMIT_PER_MINUTE, 60);
    const caller = takeRateLimitToken({ key: `geocode:${getClientAddress(request)}`, limit: callerLimit });
    if (!caller.allowed) {
      return withCors(request, json({ error: "Search rate limit reached. Please wait a moment." }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(caller.retryAfterSec) },
      }));
    }
    const providerGate = takeRateLimitToken({ key: "geocode:provider-cache-miss", limit: 1, windowMs: 1_000 });
    if (!providerGate.allowed) {
      return withCors(request, json({ error: "Search rate limit reached. Please wait a moment." }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(providerGate.retryAfterSec) },
      }));
    }

    const upstream = new URL("https://nominatim.openstreetmap.org/search");
    upstream.searchParams.set("q", query);
    upstream.searchParams.set("format", "jsonv2");
    upstream.searchParams.set("limit", "6");
    upstream.searchParams.set("addressdetails", "0");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODE_PROVIDER_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(upstream.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "LinkSim/1.0 (https://linksim.link; geocode lookup)",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new ApiRequestError("Geocode lookup timed out.", 504, "geocode_timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429) {
      const rawRetry = response.headers.get("retry-after") ?? "";
      const retryAfter = /^\d{1,4}$/u.test(rawRetry) && Number(rawRetry) >= 1 && Number(rawRetry) <= 3_600 ? rawRetry : "1";
      await response.body?.cancel().catch(() => undefined);
      return withCors(request, json({ error: "Search rate limit reached. Please wait a moment." }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": retryAfter },
      }));
    }
    if (!response.ok) throw new ApiRequestError(`Geocode lookup failed (${response.status}).`, 502, "geocode_upstream");
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new ApiRequestError("Geocode provider returned an invalid response.", 502, "geocode_upstream");
    }
    let results;
    try {
      const { value } = await readBoundedJsonResponse<unknown>(response, {
        maxBytes: GEOCODE_RESPONSE_MAX_BYTES,
        maxRecords: GEOCODE_RESULT_MAX_RECORDS,
        maxDepth: GEOCODE_RESPONSE_MAX_DEPTH,
      });
      results = validateNominatimResults(value);
    } catch {
      throw new ApiRequestError("Geocode provider returned an invalid response.", 502, "geocode_upstream");
    }

    const apiResponse = json(
      { results },
      {
        headers: {
          "cache-control": `public, max-age=${Math.floor(GEOCODE_CACHE_TTL_MS / 1_000)}`,
        },
      },
    );
    await cache.put(cacheKey, apiResponse.clone());
    return withCors(request, apiResponse);
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
