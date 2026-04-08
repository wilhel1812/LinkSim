import { describe, expect, it } from "vitest";
import {
  defaultOptionForSelectionCount,
  normalizeOverlayRadiusOptionForSelectionCount,
  optionsForSelectionCount,
  resolveEffectiveOverlayRadiusKm,
  resolveLoadedOverlayRadiusCapKm,
  resolveTargetOverlayRadiusKm,
} from "./simulationOverlayRadius";
import type { Site, SrtmTile } from "../types/radio";

const site: Pick<Site, "position"> = { position: { lat: 59.9, lon: 10.7 } };
const mkTile = (key: string, sourceId = "copernicus30"): SrtmTile => ({
  key,
  latStart: 59,
  lonStart: 10,
  size: 1201,
  arcSecondSpacing: 3,
  elevations: new Int16Array(1201 * 1201),
  sourceId,
});

describe("simulationOverlayRadius", () => {
  it("exposes expected options by selection context", () => {
    expect(optionsForSelectionCount(1)).toEqual(["auto", "100", "200", "500"]);
    expect(optionsForSelectionCount(2)).toEqual(["20", "50", "100"]);
    expect(defaultOptionForSelectionCount(1)).toBe("auto");
    expect(defaultOptionForSelectionCount(3)).toBe("20");
  });

  it("normalizes invalid option to context default", () => {
    expect(normalizeOverlayRadiusOptionForSelectionCount(1, "50")).toBe("auto");
    expect(normalizeOverlayRadiusOptionForSelectionCount(2, "auto")).toBe("20");
  });

  it("uses tile-aware auto radius in single-site mode", () => {
    const radius = resolveEffectiveOverlayRadiusKm({
      selectionCount: 1,
      option: "auto",
      selectedSingleSite: site,
      srtmTiles: [
        mkTile("N59E010"),
        mkTile("N60E010"),
        mkTile("N58E010"),
        mkTile("N59E009"),
        mkTile("N59E011"),
        mkTile("N60E009"),
        mkTile("N60E011"),
        mkTile("N58E009"),
        mkTile("N58E011"),
      ],
      isTerrainFetching: false,
    });
    expect(radius).toBeGreaterThan(50);
  });

  it("uses fixed values outside single-site mode", () => {
    const radius = resolveEffectiveOverlayRadiusKm({
      selectionCount: 2,
      option: "100",
      selectedSingleSite: null,
      srtmTiles: [],
      isTerrainFetching: false,
    });
    expect(radius).toBe(100);
  });

  it("resolves target radius by context and option", () => {
    expect(resolveTargetOverlayRadiusKm(1, "auto")).toBe(100);
    expect(resolveTargetOverlayRadiusKm(1, "500")).toBe(500);
    expect(resolveTargetOverlayRadiusKm(3, "100")).toBe(100);
  });

  it("caps loaded radius conservatively to available 30m tiles", () => {
    const capped = resolveLoadedOverlayRadiusCapKm([site], 500, [mkTile("N59E010")], 20);
    expect(capped).toBe(20);
  });
});
