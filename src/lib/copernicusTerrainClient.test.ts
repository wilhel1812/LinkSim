import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("geotiff", () => ({
  fromArrayBuffer: vi.fn(async () => ({
    getImage: async () => ({
      getWidth: () => 2,
      getHeight: () => 2,
      getBoundingBox: () => [9, 60, 10, 61],
      getGDALNoData: () => null,
      readRasters: async () => new Int16Array([1, 2, 3, 4]),
    }),
  })),
}));

import {
  copernicus30PathForTileKey,
  loadCopernicus30TilesByKeys,
} from "./copernicusTerrainClient";

const installEmptyCache = () => {
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      open: vi.fn(async () => ({
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
      })),
      delete: vi.fn(async () => true),
    },
  });
};

describe("Copernicus GLO-30 tile loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installEmptyCache();
    vi.stubGlobal("Worker", undefined);
  });

  it.each([
    ["N60E009", "Copernicus_DSM_COG_10_N60_00_E009_00_DEM"],
    ["S05W123", "Copernicus_DSM_COG_10_S05_00_W123_00_DEM"],
  ])("builds deterministic paths for %s", (key, objectName) => {
    expect(copernicus30PathForTileKey(key)).toBe(
      `/copernicus/30m/${objectName}/${objectName}.tif`,
    );
  });

  it("never runs more than two tile requests concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }),
    );

    const result = await loadCopernicus30TilesByKeys(
      ["N60E009", "N60E010", "N61E009", "N61E010"],
      { concurrency: 2 },
    );

    expect(result.tiles).toHaveLength(4);
    expect(result.failedTiles).toEqual([]);
    expect(maxActive).toBe(2);
  });

  it("retries one transient response but not a permanent 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N60E009", "N60E010"], {
      concurrency: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.tiles).toHaveLength(1);
    expect(result.failedTiles).toEqual(["N60E010"]);
  });

  it("aborts active work without reporting cancellation as a failed tile", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Stopped", "AbortError")),
              { once: true },
            );
          }),
      ),
    );

    const loading = loadCopernicus30TilesByKeys(["N60E009"], {
      concurrency: 1,
      signal: controller.signal,
    });
    controller.abort(new DOMException("Stopped", "AbortError"));

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });
});
