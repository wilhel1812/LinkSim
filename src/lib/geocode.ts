import {
  GEOCODE_CACHE_TTL_MS,
  GEOCODE_CLIENT_CACHE_MAX_ENTRIES,
  GEOCODE_QUERY_MAX_CHARS,
  GEOCODE_QUERY_MIN_CHARS,
  normalizeGeocodeQuery,
  validateGeocodeApiResults,
  type GeocodeResultValue,
} from "./geocodeLimits";

export type GeocodeResult = GeocodeResultValue;

const cache = new Map<string, { expiresAt: number; results: GeocodeResult[] }>();
const inFlight = new Map<string, Promise<GeocodeResult[]>>();

const cacheResults = (key: string, results: GeocodeResult[]): void => {
  cache.delete(key);
  while (cache.size >= GEOCODE_CLIENT_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS, results });
};

export const searchLocations = async (query: string): Promise<GeocodeResult[]> => {
  const key = normalizeGeocodeQuery(query);
  if (key.length < GEOCODE_QUERY_MIN_CHARS || key.length > GEOCODE_QUERY_MAX_CHARS) return [];

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.results;
  }
  if (cached && cached.expiresAt <= Date.now()) cache.delete(key);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const localApiUrl = new URL("/api/geocode", window.location.origin);
  localApiUrl.searchParams.set("q", key);

  const request = (async () => {
    const response = await fetch(localApiUrl.toString(), {
      headers: {
        accept: "application/json",
      },
    });
    if (response.ok) {
      const results = validateGeocodeApiResults(await response.json());
      cacheResults(key, results);
      return results;
    }
    if (response.status === 429) {
      throw new Error("Search rate limit reached. Please wait a moment.");
    }
    throw new Error(`Geocode lookup failed (${response.status})`);
  })();
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
};
