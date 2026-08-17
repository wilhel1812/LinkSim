import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSearchLocations = async () => (await import("./geocode")).searchLocations;
const response = (id = "1") => new Response(JSON.stringify({
  results: [{ id, label: `Place ${id}`, lat: 59.91, lon: 10.75 }],
}), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://app.example.test", hostname: "app.example.test" } },
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("searchLocations", () => {
  it("normalizes queries and rejects values outside 3-256 without fetching", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(response());
    const searchLocations = await loadSearchLocations();
    await expect(searchLocations("ab")).resolves.toEqual([]);
    await expect(searchLocations("x".repeat(257))).resolves.toEqual([]);
    await searchLocations("  O\u0308SLO   Sentrum ");
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain("q=%C3%B6slo+sentrum");
  });

  it("coalesces identical in-flight calls and reuses the five-minute cache", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(globalThis.fetch).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const searchLocations = await loadSearchLocations();
    const first = searchLocations("Oslo");
    const second = searchLocations("  oslo ");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    resolve(response());
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: "1", label: "Place 1", lat: 59.91, lon: 10.75 }],
      [{ id: "1", label: "Place 1", lat: 59.91, lon: 10.75 }],
    ]);
    await searchLocations("OSLO");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds the client cache at 300 entries", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => response(new URL(String(input)).searchParams.get("q")!));
    const searchLocations = await loadSearchLocations();
    for (let index = 0; index < 301; index += 1) await searchLocations(`place ${String(index).padStart(3, "0")}`);
    expect(globalThis.fetch).toHaveBeenCalledTimes(301);
    await searchLocations("place 000");
    expect(globalThis.fetch).toHaveBeenCalledTimes(302);
  });

  it("never falls back directly to Nominatim from a production browser", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const searchLocations = await loadSearchLocations();
    await expect(searchLocations("Bergen")).rejects.toThrow("Geocode lookup failed (404)");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).not.toContain("nominatim.openstreetmap.org");
  });

  it("surfaces stable local rate-limit responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("Too many requests", { status: 429, headers: { "retry-after": "1" } }));
    const searchLocations = await loadSearchLocations();
    await expect(searchLocations("Trondheim")).rejects.toThrow("Search rate limit reached. Please wait a moment.");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
