export const GEOCODE_QUERY_MIN_CHARS = 3;
export const GEOCODE_QUERY_MAX_CHARS = 256;
export const GEOCODE_RESULT_MAX_RECORDS = 6;
export const GEOCODE_RESPONSE_MAX_BYTES = 64 * 1024;
export const GEOCODE_RESPONSE_MAX_DEPTH = 3;
export const GEOCODE_CACHE_TTL_MS = 5 * 60_000;
export const GEOCODE_CLIENT_CACHE_MAX_ENTRIES = 300;
export const GEOCODE_PROVIDER_TIMEOUT_MS = 10_000;

export type GeocodeResultValue = { id: string; label: string; lat: number; lon: number };

export const normalizeGeocodeQuery = (value: string): string =>
  value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

const coordinatePattern = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u;

export const validateNominatimResults = (payload: unknown): GeocodeResultValue[] => {
  if (!Array.isArray(payload) || payload.length > GEOCODE_RESULT_MAX_RECORDS) throw new Error("Geocode provider response must be a bounded array.");
  return payload.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Geocode provider result is invalid.");
    const item = raw as { place_id?: unknown; display_name?: unknown; lat?: unknown; lon?: unknown };
    if (!Number.isSafeInteger(item.place_id) || (item.place_id as number) < 0
      || typeof item.display_name !== "string" || !item.display_name.trim() || item.display_name.length > 512
      || typeof item.lat !== "string" || item.lat.length > 32 || !coordinatePattern.test(item.lat)
      || typeof item.lon !== "string" || item.lon.length > 32 || !coordinatePattern.test(item.lon)) {
      throw new Error("Geocode provider result fields are invalid.");
    }
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error("Geocode provider coordinates are out of range.");
    }
    return { id: String(item.place_id), label: item.display_name.trim(), lat, lon };
  });
};

export const validateGeocodeApiResults = (payload: unknown): GeocodeResultValue[] => {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) throw new Error("Geocode API response is invalid.");
  const results = (payload as { results: unknown[] }).results;
  if (results.length > GEOCODE_RESULT_MAX_RECORDS) throw new Error("Geocode API response has too many results.");
  return results.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Geocode API result is invalid.");
    const item = raw as Partial<GeocodeResultValue>;
    if (typeof item.id !== "string" || !item.id || item.id.length > 64
      || typeof item.label !== "string" || !item.label.trim() || item.label.length > 512
      || typeof item.lat !== "number" || !Number.isFinite(item.lat) || item.lat < -90 || item.lat > 90
      || typeof item.lon !== "number" || !Number.isFinite(item.lon) || item.lon < -180 || item.lon > 180) {
      throw new Error("Geocode API result fields are invalid.");
    }
    return { id: item.id, label: item.label.trim(), lat: item.lat, lon: item.lon };
  });
};
