import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSearchLocations = async () => {
  const module = await import("./geocode");
  return module.searchLocations;
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://app.example.test" } },
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("searchLocations", () => {
  it("returns empty results for blank and too-short queries", async () => {
    const searchLocations = await loadSearchLocations();

    await expect(searchLocations("")).resolves.toEqual([]);
    await expect(searchLocations("ab")).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses local API and reuses in-memory cache", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ id: "1", label: "Oslo", lat: 59.91, lon: 10.75 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const searchLocations = await loadSearchLocations();
    const first = await searchLocations("Oslo");
    const second = await searchLocations("oslo");

    expect(first).toEqual([{ id: "1", label: "Oslo", lat: 59.91, lon: 10.75 }]);
    expect(second).toEqual(first);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to upstream nominatim when local endpoint is unavailable", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ place_id: 7, display_name: "Bergen", lat: "60.39", lon: "5.32" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const searchLocations = await loadSearchLocations();
    const results = await searchLocations("Bergen");

    expect(results).toEqual([{ id: "7", label: "Bergen", lat: 60.39, lon: 5.32 }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[1]?.[0])).toContain("nominatim.openstreetmap.org/search");
  });

  it("surfaces local rate-limit responses without upstream fallback", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("Too many requests", { status: 429 }));
    const searchLocations = await loadSearchLocations();

    await expect(searchLocations("Trondheim")).rejects.toThrow("Search rate limit reached. Please wait a moment.");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
