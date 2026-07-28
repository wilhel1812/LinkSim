import { describe, expect, it } from "vitest";
import { normalizeTerrainDataset } from "./terrainDataset";

describe("normalizeTerrainDataset", () => {
  it.each(["copernicus30", "copernicus90", "srtm1", "srtm3", "legacySrtmThird", undefined])(
    "normalizes legacy value %s to GLO-30",
    (value) => {
      expect(normalizeTerrainDataset(value)).toBe("copernicus30");
    },
  );
});
