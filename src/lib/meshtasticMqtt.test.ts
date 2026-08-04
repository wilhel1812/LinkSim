import { describe, expect, it } from "vitest";

import { mergeMeshmapNodes, parseMeshmapLikeFeed } from "./meshtasticMqtt";

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
});
