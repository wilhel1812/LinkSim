import { getClientAddress, takeRateLimitToken } from "../_lib/rateLimit";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const CACHE_TTL_SEC = 300;

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();

    if (!query) return withCors(request, json({ results: [] }));
    if (query.length < 3) {
      return withCors(request, json({ error: "Search query must be at least 3 characters." }, { status: 400 }));
    }

    const limitPerMinute = parsePerMinuteLimit(env.GEOCODE_RATE_LIMIT_PER_MINUTE, 20);
    const address = getClientAddress(request);
    const limiter = takeRateLimitToken({ key: `geocode:${address}`, limit: limitPerMinute });
    if (!limiter.allowed) {
      return withCors(
        request,
        json(
          { error: "Geocode rate limit reached. Please wait and try again." },
          {
            status: 429,
            headers: {
              "retry-after": String(limiter.retryAfterSec),
            },
          },
        ),
      );
    }

    const normalized = query.toLowerCase();
    const cacheUrl = new URL(request.url);
    cacheUrl.search = "";
    cacheUrl.searchParams.set("q", normalized);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return withCors(request, cached);

    const upstream = new URL("https://nominatim.openstreetmap.org/search");
    upstream.searchParams.set("q", query);
    upstream.searchParams.set("format", "jsonv2");
    upstream.searchParams.set("limit", "6");
    upstream.searchParams.set("addressdetails", "0");

    const response = await fetch(upstream.toString(), {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Geocode lookup failed (${response.status})`);
    }

    const payload = (await response.json()) as NominatimResult[];
    const results = payload
      .map((item) => ({
        id: String(item.place_id),
        label: item.display_name,
        lat: Number(item.lat),
        lon: Number(item.lon),
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));

    const apiResponse = json(
      { results },
      {
        headers: {
          "cache-control": `public, max-age=${CACHE_TTL_SEC}`,
        },
      },
    );
    await cache.put(cacheKey, apiResponse.clone());
    return withCors(request, apiResponse);
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
