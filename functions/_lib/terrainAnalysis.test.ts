import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeLinkMock, boundingBoxMock, readRastersMock } = vi.hoisted(() => ({
  analyzeLinkMock: vi.fn(),
  boundingBoxMock: vi.fn(() => [9, 60, 10, 61]),
  readRastersMock: vi.fn(),
}));

vi.mock("../../src/lib/propagation", () => ({ analyzeLink: analyzeLinkMock }));

vi.mock("geotiff", () => ({
  fromArrayBuffer: vi.fn(async () => ({
    getImage: async () => ({
      getWidth: () => 3601,
      getHeight: () => 3601,
      getBoundingBox: boundingBoxMock,
      getGDALNoData: () => null,
      readRasters: readRastersMock,
    }),
  })),
}));

import { analyzeTerrainLink, loadCopernicusTilesForPath } from "./terrainAnalysis";
import type { Env } from "./types";

describe("calculation API GLO-30 terrain loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    analyzeLinkMock.mockReset();
    boundingBoxMock.mockReset();
    boundingBoxMock.mockReturnValue([9, 60, 10, 61]);
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

  it("requests only adjacent longitude tiles across the antimeridian", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await loadCopernicusTilesForPath(
      { lat: 10.1, lon: 179.9 },
      { lat: 10.2, lon: -179.9 },
      "https://linksim.link/api/v1/calculate",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([expect.stringContaining("N10_00_E179"), expect.stringContaining("N10_00_W180")]),
    );
  });

  it("rejects overlarge terrain enumeration before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadCopernicusTilesForPath(
        { lat: -80, lon: 0.1 },
        { lat: 80, lon: 2.1 },
        "https://linksim.link/api/v1/calculate",
      ),
    ).rejects.toThrow("256 tiles");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps terrain sampling on the short antimeridian path", async () => {
    boundingBoxMock
      .mockReturnValueOnce([179, 10, 180, 11])
      .mockReturnValueOnce([-180, 10, -179, 11]);
    readRastersMock.mockImplementation(async (options: { width: number; height: number }) =>
      new Int16Array(options.width * options.height).fill(100),
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
    analyzeLinkMock.mockImplementation((_link, _from, to, _model, terrainSampler) => {
      expect(to.position.lon).toBeCloseTo(180.1);
      expect(terrainSampler({ lat: 10.15, lon: 180.05 })).toBe(100);
      return {
        distanceKm: 22,
        fsplDb: 100,
        pathLossDb: 101,
        terrainObstructed: false,
        worstFresnelClearanceM: 1,
        worstFresnelClearancePercent: 100,
      };
    });
    const site = {
      name: "Site",
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
      antennaHeightM: 2,
    };

    await analyzeTerrainLink(
      {} as Env,
      "https://linksim.link/api/v1/calculate",
      { ...site, lat: 10.1, lon: 179.9 },
      { ...site, lat: 10.2, lon: -179.9 },
      868,
      100,
    );

    expect(analyzeLinkMock).toHaveBeenCalledTimes(1);
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
