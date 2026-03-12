export type GeocodeResult = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; results: GeocodeResult[] }>();

export const searchLocations = async (query: string): Promise<GeocodeResult[]> => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (trimmed.length < 3) return [];

  const key = trimmed.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  if (cached && cached.expiresAt <= Date.now()) cache.delete(key);

  const url = new URL("/api/geocode", window.location.origin);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "0");

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Search rate limit reached. Please wait a moment.");
    }
    throw new Error(`Geocode lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as { results?: GeocodeResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    results,
  });

  return results;
};
