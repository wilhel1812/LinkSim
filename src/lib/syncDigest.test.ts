import { describe, expect, it } from "vitest";
import { computeSyncPayloadDigest } from "./syncDigest";

describe("computeSyncPayloadDigest", () => {
  it("is compact and independent of object and collection ordering", async () => {
    const first = {
      siteLibrary: [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha", nested: { z: 2, a: 1 } }],
      simulationPresets: [{ id: "sim-b", name: "B" }, { id: "sim-a", name: "A" }],
    };
    const reordered = {
      simulationPresets: [{ name: "A", id: "sim-a" }, { name: "B", id: "sim-b" }],
      siteLibrary: [{ nested: { a: 1, z: 2 }, name: "Alpha", id: "a" }, { name: "Beta", id: "b" }],
    };

    const digest = await computeSyncPayloadDigest(first);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digest).toBe(await computeSyncPayloadDigest(reordered));
    expect(digest.length).toBeLessThan(JSON.stringify(first).length);
  });

  it("changes when persisted content changes", async () => {
    const original = { siteLibrary: [{ id: "site-1", name: "Alpha" }], simulationPresets: [] };
    const changed = { siteLibrary: [{ id: "site-1", name: "Beta" }], simulationPresets: [] };
    expect(await computeSyncPayloadDigest(original)).not.toBe(await computeSyncPayloadDigest(changed));
  });
});
