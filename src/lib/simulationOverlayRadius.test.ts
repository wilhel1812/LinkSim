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
    expect(optionsForSelectionCount(1)).toEqual(["20", "50", "100", "200"]);
    expect(optionsForSelectionCount(2)).toEqual(["20", "50", "100", "200"]);
    expect(defaultOptionForSelectionCount(1)).toBe("20");
    expect(defaultOptionForSelectionCount(3)).toBe("20");
  });

  it("normalizes invalid option to context default", () => {
    expect(normalizeOverlayRadiusOptionForSelectionCount(1, "50")).toBe("50");
    expect(normalizeOverlayRadiusOptionForSelectionCount(2, "auto")).toBe("20");
  });

  it("uses fixed values in single-site mode", () => {
    const radius = resolveEffectiveOverlayRadiusKm({
      selectionCount: 1,
      option: "100",
      selectedSingleSite: site,
      srtmTiles: [mkTile("N59E010")],
      isTerrainFetching: false,
    });
    expect(radius).toBe(100);
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
    expect(resolveTargetOverlayRadiusKm(1, "20")).toBe(20);
    expect(resolveTargetOverlayRadiusKm(1, "200")).toBe(200);
    expect(resolveTargetOverlayRadiusKm(3, "100")).toBe(100);
  });

  it("caps loaded radius conservatively to available 30m tiles", () => {
    const capped = resolveLoadedOverlayRadiusCapKm([site], 200, [mkTile("N59E010")], 20);
    expect(capped).toBe(20);
  });
});
