export type GeocodeResult = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; results: GeocodeResult[] }>();

const mapNominatimResults = (payload: NominatimResult[]): GeocodeResult[] =>
  payload
    .map((item) => ({
      id: String(item.place_id),
      label: item.display_name,
      lat: Number(item.lat),
      lon: Number(item.lon),
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));

export const searchLocations = async (query: string): Promise<GeocodeResult[]> => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (trimmed.length < 3) return [];

  const key = trimmed.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  if (cached && cached.expiresAt <= Date.now()) cache.delete(key);

  const localApiUrl = new URL("/api/geocode", window.location.origin);
  localApiUrl.searchParams.set("q", trimmed);

  try {
    const response = await fetch(localApiUrl.toString(), {
      headers: {
        accept: "application/json",
      },
    });
    if (response.ok) {
      const payload = (await response.json()) as { results?: GeocodeResult[] } | NominatimResult[];
      const results = Array.isArray(payload)
        ? mapNominatimResults(payload)
        : Array.isArray(payload.results)
          ? payload.results
          : [];
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results });
      return results;
    }
    if (response.status === 429) {
      throw new Error("Search rate limit reached. Please wait a moment.");
    }
    if (response.status !== 404) {
      throw new Error(`Geocode lookup failed (${response.status})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("rate limit")) throw error;
    // Fall through to direct upstream lookup for local Vite dev without Functions.
  }

  const upstreamUrl = new URL("https://nominatim.openstreetmap.org/search");
  upstreamUrl.searchParams.set("q", trimmed);
  upstreamUrl.searchParams.set("format", "jsonv2");
  upstreamUrl.searchParams.set("limit", "6");
  upstreamUrl.searchParams.set("addressdetails", "0");

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  if (!upstreamResponse.ok) {
    throw new Error(`Geocode lookup failed (${upstreamResponse.status})`);
  }
  const upstreamPayload = (await upstreamResponse.json()) as NominatimResult[];
  const results = mapNominatimResults(upstreamPayload);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results });
  return results;
};
