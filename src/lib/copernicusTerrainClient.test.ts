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
import { sampleSrtmElevation } from "./srtm";

const TILE_INDEX_CACHE_KEY = "linksim-copernicus-tile-index-v1";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
};

const catalogEntryFor = (key: string): string => {
  const match = /^([NS])(\d{2})([EW])(\d{3})$/.exec(key);
  if (!match) throw new Error(`Unexpected key: ${key}`);
  const [, ns, lat, ew, lon] = match;
  return `Copernicus_DSM_COG_10_${ns}${lat}_00_${ew}${lon}_00_DEM`;
};

const catalogResponse = (keys: string[]): Response =>
  new Response(keys.map(catalogEntryFor).join("\n"), { status: 200 });

const seedCatalogCache = (keys: string[], fetchedAtMs = Date.now()) => {
  localStorageMock.setItem(
    TILE_INDEX_CACHE_KEY,
    JSON.stringify({ copernicus30: { fetchedAtMs, keys } }),
  );
};

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
    storage.clear();
    installEmptyCache();
    vi.stubGlobal("localStorage", localStorageMock);
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
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/tileList.txt")) {
          return catalogResponse(["N60E009", "N60E010", "N61E009", "N61E010"]);
        }
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

  it("rejects more than 256 requested keys before catalog, cache, or tile requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const keys = Array.from({ length: 257 }, (_, index) =>
      `${index < 180 ? "N00" : "N01"}E${String(index % 180).padStart(3, "0")}`,
    );

    await expect(loadCopernicus30TilesByKeys(keys)).rejects.toThrow("256 tiles");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });

  it("rejects invalid requested keys before catalog, cache, or tile requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCopernicus30TilesByKeys(["invalid"])).rejects.toThrow("Invalid terrain tile key");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });

  it("rejects impossible requested coordinates before catalog, cache, or tile requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCopernicus30TilesByKeys(["N90E000"])).rejects.toThrow("Invalid terrain tile key");
    await expect(loadCopernicus30TilesByKeys(["N00E180"])).rejects.toThrow("Invalid terrain tile key");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });

  it("retries one transient response but not a permanent 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(catalogResponse(["N60E009", "N60E010"]))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N60E009", "N60E010"], {
      concurrency: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.tiles).toHaveLength(1);
    expect(result.failedTiles).toEqual(["N60E010"]);
    expect(result.seaLevelTiles).toEqual([]);
  });

  it("creates zero-elevation tiles for catalog-confirmed ocean cells without requesting their TIFFs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/tileList.txt")) return catalogResponse(["N70E018"]);
      if (requestUrl.includes("N70_00_E018_00")) {
        return new Response(new Uint8Array([1]), { status: 200 });
      }
      throw new Error(`Unexpected ocean TIFF request: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N70E016", "N70E017", "N70E018"]);

    expect(result.failedTiles).toEqual([]);
    expect(result.seaLevelTiles).toEqual(["N70E016", "N70E017"]);
    expect(result.tiles.map((tile) => tile.key).sort()).toEqual(["N70E016", "N70E017", "N70E018"]);
    expect(sampleSrtmElevation(result.tiles, 70.5, 16.5)).toBe(0);
    expect(sampleSrtmElevation(result.tiles, 70.5, 17.5)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a fresh compact catalog cache without fetching the catalog", async () => {
    seedCatalogCache(["N70E018"]);
    const fetchMock = vi.fn(async () => {
      throw new Error("No request expected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N70E016"]);

    expect(result.seaLevelTiles).toEqual(["N70E016"]);
    expect(result.failedTiles).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a stale catalog cache when refreshing the catalog fails", async () => {
    seedCatalogCache(["N70E018"], 1);
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N70E016"]);

    expect(result.seaLevelTiles).toEqual(["N70E016"]);
    expect(result.failedTiles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches a corrupt catalog cache", async () => {
    localStorageMock.setItem(TILE_INDEX_CACHE_KEY, "{bad-json");
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/tileList.txt")) return catalogResponse(["N70E018"]);
      throw new Error(`Unexpected TIFF request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N70E016"]);

    expect(result.seaLevelTiles).toEqual(["N70E016"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorageMock.getItem(TILE_INDEX_CACHE_KEY) ?? "null")).toEqual(
      expect.objectContaining({
        copernicus30: expect.objectContaining({ keys: ["N70E018"] }),
      }),
    );
  });

  it("does not infer ocean when no catalog is available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCopernicus30TilesByKeys(["N70E016"]);

    expect(result.tiles).toEqual([]);
    expect(result.seaLevelTiles).toEqual([]);
    expect(result.failedTiles).toEqual(["N70E016"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts active work without reporting cancellation as a failed tile", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, init?: RequestInit) => {
          if (String(url).endsWith("/tileList.txt")) return Promise.resolve(catalogResponse(["N60E009"]));
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Stopped", "AbortError")),
              { once: true },
            );
          });
        },
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
