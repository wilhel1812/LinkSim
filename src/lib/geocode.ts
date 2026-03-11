export type GeocodeResult = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

export const searchLocations = async (query: string): Promise<GeocodeResult[]> => {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
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
    throw new Error(`Geocode lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as Array<{
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
  }>;

  return payload
    .map((item) => ({
      id: String(item.place_id),
      label: item.display_name,
      lat: Number(item.lat),
      lon: Number(item.lon),
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
};
