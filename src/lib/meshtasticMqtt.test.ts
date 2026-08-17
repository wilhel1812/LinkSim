import { describe, expect, it, vi } from "vitest";

import {
  formatPositionPrecision,
  getPositionPrecisionBounds,
  mergeMeshmapNodes,
  parseMeshmapLikeFeed,
  fetchMeshmapNodes,
} from "./meshtasticMqtt";

describe("node feed normalization", () => {
  it("normalizes legacy MeshMap and normalized adapter payloads", () => {
    expect(
      parseMeshmapLikeFeed({
        "!meshmap": {
          longName: "MeshMap node",
          latitude: 601000000,
          longitude: 102000000,
          altitude: 123,
          lastMapReport: 1_800_000_000,
        },
      }),
    ).toEqual([
      expect.objectContaining({
        nodeId: "!meshmap",
        lat: 60.1,
        lon: 10.2,
        updatedAt: 1_800_000_000_000,
      }),
    ]);

    expect(
      parseMeshmapLikeFeed([
        { nodeId: "!norway", longName: "Norway node", lat: 61.2, lon: 11.3, updatedAt: 1_800_000_200_000 },
      ]),
    ).toEqual([
      expect.objectContaining({ nodeId: "!norway", lat: 61.2, lon: 11.3, updatedAt: 1_800_000_200_000 }),
    ]);
  });

  it("normalizes integer position precision bits from numeric and string feed values", () => {
    expect(
      parseMeshmapLikeFeed({
        "!numeric": { lat: 60.1, lon: 10.2, precision: 16 },
        "!string": { lat: 61.2, lon: 11.3, precision: "32" },
      }),
    ).toEqual([
      expect.objectContaining({ nodeId: "!numeric", positionPrecisionBits: 16 }),
      expect.objectContaining({ nodeId: "!string", positionPrecisionBits: 32 }),
    ]);
  });

  it.each([undefined, 0, -1, 1.5, 33, "invalid"])(
    "treats invalid position precision %s as unavailable",
    (precision) => {
      expect(
        parseMeshmapLikeFeed({
          "!node": { lat: 60.1, lon: 10.2, precision },
        }),
      ).toEqual([
        expect.not.objectContaining({ positionPrecisionBits: expect.anything() }),
      ]);
    },
  );

  it("calculates the exact coordinate quantization bounds", () => {
    expect(getPositionPrecisionBounds({ lat: 60.55, lon: 11.55, positionPrecisionBits: 16 })).toEqual({
      minLat: 60.5467232,
      maxLat: 60.5532768,
      minLon: 11.5467232,
      maxLon: 11.5532768,
    });

    expect(getPositionPrecisionBounds({ lat: -33.9, lon: -151.2, positionPrecisionBits: 32 })).toEqual({
      minLat: -33.90000005,
      maxLat: -33.89999995,
      minLon: -151.20000005,
      maxLon: -151.19999995,
    });

    expect(getPositionPrecisionBounds({ lat: 78.2, lon: 15.6, positionPrecisionBits: 16 })).toEqual({
      minLat: 78.1967232,
      maxLat: 78.2032768,
      minLon: 15.5967232,
      maxLon: 15.6032768,
    });

    expect(getPositionPrecisionBounds({ lat: 78.2, lon: 15.6 })).toBeNull();
  });

  it("formats approximate precision and full or unavailable states", () => {
    expect(formatPositionPrecision(10)).toBe("Position precision: 10 bits · ≈23.3 km");
    expect(formatPositionPrecision(16)).toBe("Position precision: 16 bits · ≈364 m");
    expect(formatPositionPrecision(32)).toBe("Position precision: full (32 bits)");
    expect(formatPositionPrecision(undefined)).toBe("Position precision unavailable");
  });

  it("deduplicates enabled sources by canonical node id and prefers the newest report", () => {
    expect(
      mergeMeshmapNodes([
        [
          { nodeId: "!ABC123", longName: "Older", lat: 60, lon: 10, updatedAt: 100 },
        ],
        [
          { nodeId: "abc123", longName: "Newer", lat: 61, lon: 11, updatedAt: 200 },
          { nodeId: "!other", longName: "Other", lat: 62, lon: 12 },
        ],
      ]),
    ).toEqual([
      expect.objectContaining({ nodeId: "!abc123", longName: "Newer" }),
      expect.objectContaining({ nodeId: "!other" }),
    ]);
  });

  it("caps normalized sources at 20,000 and combined deduped nodes at 25,000", () => {
    const source = Array.from({ length: 20_001 }, (_, index) => ({ nodeId: `!${String(index).padStart(5, "0")}`, lat: 60, lon: 10 }));
    expect(parseMeshmapLikeFeed(source)).toHaveLength(20_000);
    const left = source.slice(0, 20_000) as ReturnType<typeof parseMeshmapLikeFeed>;
    const right = Array.from({ length: 20_000 }, (_, index) => ({ nodeId: `!r${String(index).padStart(5, "0")}`, lat: 61, lon: 11 }));
    expect(mergeMeshmapNodes([left, right])).toHaveLength(25_000);
  });

  it("rejects oversized custom feeds and falls back only to a bounded cache", async () => {
    const cache = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => cache.get(key) ?? null,
      setItem: (key: string, value: string) => cache.set(key, value),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      fetchMock.mockResolvedValueOnce(new Response("[]", { headers: { "content-length": String(5 * 1024 * 1024 + 1) } }));
      await expect(fetchMeshmapNodes({ sourceUrl: "/declared-oversize" })).rejects.toThrow("size limit");

      const chunkedOversize = () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
        },
      });
      fetchMock.mockResolvedValueOnce(new Response(chunkedOversize()));
      await expect(fetchMeshmapNodes({ sourceUrl: "/chunked-oversize" })).rejects.toThrow("size limit");

      const tooMany = Array.from({ length: 20_001 }, (_, index) => ({ nodeId: `!${index}`, lat: 60, lon: 10 }));
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(tooMany)));
      await expect(fetchMeshmapNodes({ sourceUrl: "/record-oversize" })).rejects.toThrow("record limit");

      const exact = Array.from({ length: 20_000 }, (_, index) => ({ nodeId: `!cache${String(index).padStart(5, "0")}`, lat: 60, lon: 10 }));
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(exact)));
      const fresh = await fetchMeshmapNodes({ sourceUrl: "/bounded-source" });
      expect(fresh.nodes).toHaveLength(20_000);
      expect(JSON.parse(cache.get("rmw-node-source-cache-v1:/bounded-source")!).nodes).toHaveLength(20_000);

      fetchMock.mockResolvedValueOnce(new Response("[]", { headers: { "content-length": String(5 * 1024 * 1024 + 1) } }));
      const fallback = await fetchMeshmapNodes({ sourceUrl: "/bounded-source" });
      expect(fallback).toMatchObject({ fromCache: true, networkError: true });
      expect(fallback.nodes).toHaveLength(20_000);

      fetchMock.mockResolvedValueOnce(new Response(chunkedOversize()));
      expect(await fetchMeshmapNodes({ sourceUrl: "/bounded-source" })).toMatchObject({
        fromCache: true,
        networkError: true,
      });

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(tooMany)));
      expect(await fetchMeshmapNodes({ sourceUrl: "/bounded-source" })).toMatchObject({
        fromCache: true,
        networkError: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
