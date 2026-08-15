import { beforeEach, describe, expect, it, vi } from "vitest";

const { readRastersMock } = vi.hoisted(() => ({ readRastersMock: vi.fn() }));

vi.mock("geotiff", () => ({
  fromArrayBuffer: vi.fn(async () => ({
    getImage: async () => ({
      getWidth: () => 3601,
      getHeight: () => 3601,
      getBoundingBox: () => [9, 60, 10, 61],
      getGDALNoData: () => null,
      readRasters: readRastersMock,
    }),
  })),
}));

import { loadCopernicusTilesForPath } from "./terrainAnalysis";

describe("calculation API GLO-30 terrain loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    readRastersMock.mockReset();
    readRastersMock.mockResolvedValue(new Int16Array([100, 101, 102, 103]));
  });

  it("requests deterministic GLO-30 objects without tile lists or GLO-90", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicusTilesForPath(
      { lat: 60.1, lon: 9.1 },
      { lat: 60.2, lon: 9.2 },
      "https://linksim.link/api/v1/calculate",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://linksim.link/copernicus/30m/Copernicus_DSM_COG_10_N60_00_E009_00_DEM/Copernicus_DSM_COG_10_N60_00_E009_00_DEM.tif",
    );
    expect(result.tileKeys).toEqual(["N60E009:copernicus30"]);
  });

  it("returns no terrain when the public GLO-30 object is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    await expect(
      loadCopernicusTilesForPath(
        { lat: 60.1, lon: 9.1 },
        { lat: 60.2, lon: 9.2 },
        "https://linksim.link/api/v1/calculate",
      ),
    ).resolves.toEqual({ tiles: [], tileKeys: [] });
  });

  it("observes cancellation while GeoTIFF raster decoding is in progress", async () => {
    let finishDecode: ((value: Int16Array) => void) | undefined;
    readRastersMock.mockReturnValueOnce(new Promise<Int16Array>((resolve) => { finishDecode = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
    const controller = new AbortController();

    const loading = loadCopernicusTilesForPath(
      { lat: 60.1, lon: 9.1 },
      { lat: 60.2, lon: 9.2 },
      "https://linksim.link/api/v1/calculate",
      controller.signal,
    );
    await vi.waitFor(() => expect(readRastersMock).toHaveBeenCalledTimes(1));
    controller.abort();
    finishDecode?.(new Int16Array([100, 101, 102, 103]));

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });
});
