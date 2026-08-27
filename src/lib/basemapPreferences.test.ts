import { describe, expect, it } from "vitest";
import {
  BasemapPreferenceError,
  customBasemapStyleId,
  normalizeUserBasemapPreferences,
} from "./basemapPreferences";

describe("normalizeUserBasemapPreferences", () => {
  it("normalizes style and raster sources, including dark URL fallback", () => {
    const result = normalizeUserBasemapPreferences({
      version: 1,
      customSources: [
        { id: " alpine ", name: " Alpine ", kind: "style", lightUrl: "https://maps.test/style.json?key=browser-safe", attribution: " Map data " },
        { id: "raster", name: "Raster", kind: "raster-xyz", lightUrl: "https://tiles.test/{z}/{x}/{y}.png", attribution: "Tiles", maxZoom: 17, tileSize: 512 },
      ],
    });
    expect(result.customSources[0]).toMatchObject({ id: "alpine", name: "Alpine" });
    expect(result.customSources[0]).not.toHaveProperty("darkUrl");
    expect(result.customSources[1]).toMatchObject({ maxZoom: 17, tileSize: 512 });
    expect(result.customSources[1]).not.toHaveProperty("darkUrl");
    expect(customBasemapStyleId("alpine")).toBe("custom:alpine");
  });

  it.each([
    [{ version: 1, customSources: [{ id: "x", name: "Map", kind: "style", lightUrl: "https://user:pass@maps.test/style.json", attribution: "Data" }] }, "credentials"],
    [{ version: 1, customSources: [{ id: "x", name: "Map", kind: "raster-xyz", lightUrl: "https://tiles.test/{z}/{x}.png", attribution: "Data", maxZoom: 18, tileSize: 256 }] }, "{y}"],
    [{ version: 1, customSources: Array.from({ length: 21 }, (_, index) => ({ id: `x-${index}`, name: `Map ${index}`, kind: "style", lightUrl: "https://maps.test/style.json", attribution: "Data" })) }, "20"],
  ])("rejects invalid preferences", (input, message) => {
    expect(() => normalizeUserBasemapPreferences(input, { strict: true })).toThrow(message);
  });

  it("recovers malformed stored data to an empty preference", () => {
    expect(normalizeUserBasemapPreferences({ version: 999, customSources: "bad" })).toEqual({ version: 1, customSources: [] });
    expect(BasemapPreferenceError).toBeDefined();
  });
});
