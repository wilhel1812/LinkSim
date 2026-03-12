import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchElevations } from "./elevationService";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("fetchElevations", () => {
  it("returns empty output for empty coordinate lists", async () => {
    await expect(fetchElevations([])).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("chunks coordinates and merges elevation responses", async () => {
    const coords = Array.from({ length: 55 }, (_, index) => ({
      lat: 59.0 + index * 0.001,
      lon: 10.0 + index * 0.001,
    }));

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elevation: Array.from({ length: 50 }, (_, i) => 100 + i) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elevation: [200, 201, 202, 203, 204] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const result = await fetchElevations(coords);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain("latitude=");
    expect(String(vi.mocked(globalThis.fetch).mock.calls[1]?.[0])).toContain("longitude=");
    expect(result).toHaveLength(55);
    expect(result[0]).toBe(100);
    expect(result[54]).toBe(204);
  });

  it("throws useful error on upstream failures", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("fail", { status: 503 }));

    await expect(fetchElevations([{ lat: 59.9, lon: 10.7 }])).rejects.toThrow("Elevation API failed with status 503");
  });
});
