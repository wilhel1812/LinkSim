import { describe, expect, it } from "vitest";
import { encodeHistoryDetails, decodeHistoryDetails } from "./historyDetails";

const details = () => ({
  changedFields: ["snapshot", "visibility", "sharedWith"],
  diff: {
    snapshot: { before: { sites: Array.from({ length: 80 }, (_, id) => ({ id, name: "Synthetic ø Site", position: { lat: 60, lon: 10 } })) }, after: { sites: [] } },
    visibility: { before: "public", after: "private" },
    sharedWith: { before: [{ userId: "previous-reader", role: "viewer" }], after: [] },
  },
  revertedFromChangeId: 4,
});

describe("lossless history details", () => {
  it("retains queryable permissions and reconstructs exact original JSON without another row", async () => {
    const raw = JSON.stringify(details(), null, 1);
    const encoded = await encodeHistoryDetails(raw);
    expect(encoded.length).toBeLessThan(raw.length / 2);
    expect(JSON.parse(encoded).diff.visibility).toEqual(details().diff.visibility);
    expect(JSON.parse(encoded).diff.sharedWith).toEqual(details().diff.sharedWith);
    expect(JSON.parse(encoded).diff.snapshot).toBeUndefined();
    expect(JSON.parse(encoded).revertedFromChangeId).toBe(4);
    expect(await decodeHistoryDetails(encoded)).toBe(raw);
    expect(await encodeHistoryDetails(encoded)).toBe(encoded);
  });
  it("keeps old, small, malformed and unknown-envelope records untouched", async () => {
    for (const raw of ['null', '[]', '{', '{"diff":{"name":{"before":"a","after":"b"}}}', '{"__linksimHistoryV1":{"future":true}}']) {
      expect(await encodeHistoryDetails(raw)).toBe(raw);
    }
    expect(await decodeHistoryDetails('{"old":1}')).toBe('{"old":1}');
  });
  it("does not silently decode corrupt or future formats", async () => {
    const encoded = JSON.parse(await encodeHistoryDetails(JSON.stringify(details())));
    encoded.__linksimHistoryV1.bytes++;
    await expect(decodeHistoryDetails(JSON.stringify(encoded))).rejects.toThrow();
    encoded.__linksimHistoryV1.encoding = "future";
    await expect(decodeHistoryDetails(JSON.stringify(encoded))).rejects.toThrow();
  });
  it("bounds expansion before decompression", async () => {
    await expect(decodeHistoryDetails(JSON.stringify({ __linksimHistoryV1: { encoding: "gzip-base64", bytes: 2000001, body: "" } }))).rejects.toThrow();
  });
});
