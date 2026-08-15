import { describe, expect, it } from "vitest";
import {
  buildBufferedSelectionArea,
  defaultOptionForSelectionCount,
  normalizeOverlayRadiusOptionForSelectionCount,
  optionsForSelectionCount,
  resolveMissingOverlayTerrainTileKeys,
  resolveOverlayRadiusOptionForSelectionTransition,
  resolveRequiredOverlayTerrainTileKeys,
  resolveTargetOverlayRadiusKm,
} from "./simulationOverlayRadius";
import type { Site, SrtmTile } from "../types/radio";
import { loadingOverlayCoordinates } from "./simulationLoadingOverlay";
import { tilesForBounds } from "./terrainTiles";

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
    expect(defaultOptionForSelectionCount(1)).toBe("50");
    expect(defaultOptionForSelectionCount(3)).toBe("20");
  });

  it("normalizes invalid option to context default", () => {
    expect(normalizeOverlayRadiusOptionForSelectionCount(1, "50")).toBe("50");
    expect(normalizeOverlayRadiusOptionForSelectionCount(2, "auto")).toBe("20");
    expect(normalizeOverlayRadiusOptionForSelectionCount(1, "auto")).toBe("50");
  });

  it("resets to context defaults when switching between single and non-single selection", () => {
    expect(
      resolveOverlayRadiusOptionForSelectionTransition({
        previousSelectionCount: 1,
        selectionCount: 2,
        option: "50",
      }),
    ).toBe("20");
    expect(
      resolveOverlayRadiusOptionForSelectionTransition({
        previousSelectionCount: 2,
        selectionCount: 1,
        option: "20",
      }),
    ).toBe("50");
  });

  it("resolves target radius by context and option", () => {
    expect(resolveTargetOverlayRadiusKm(1, "20")).toBe(20);
    expect(resolveTargetOverlayRadiusKm(1, "200")).toBe(200);
    expect(resolveTargetOverlayRadiusKm(3, "100")).toBe(100);
  });

  it("reports every missing GLO-30 tile for the full selected radius", () => {
    const missing = resolveMissingOverlayTerrainTileKeys([site], 200, [mkTile("N59E010")]);

    expect(missing.length).toBeGreaterThan(1);
    expect(missing).not.toContain("N59E010");
  });

  it("resolves adjacent terrain keys for sites across the antimeridian", () => {
    const keys = resolveRequiredOverlayTerrainTileKeys(
      [
        { position: { lat: 10.1, lon: 179.9 } },
        { position: { lat: 10.2, lon: -179.9 } },
      ],
      20,
    );

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.endsWith("E179") || key.endsWith("W180"))).toBe(true);
  });

  it("rejects an ordinary wide site set at the terrain tile cap", () => {
    expect(() =>
      resolveRequiredOverlayTerrainTileKeys(
        [
          { position: { lat: 10.1, lon: -100 } },
          { position: { lat: 10.1, lon: 0 } },
          { position: { lat: 10.1, lon: 100 } },
        ],
        20,
      ),
    ).toThrow("256 tiles");
  });

  it("builds a short dateline mask that contains nearby samples but not Greenwich", () => {
    const area = buildBufferedSelectionArea(
      [
        { position: { lat: 10.1, lon: 179.9 } },
        { position: { lat: 10.2, lon: -179.9 } },
      ],
      20,
    );

    expect(area).not.toBeNull();
    expect(area?.bounds.minLon).toBeGreaterThan(-181);
    expect(area?.bounds.minLon).toBeLessThan(-180);
    expect(area?.bounds.maxLon).toBeGreaterThan(-180);
    expect(area?.bounds.maxLon).toBeLessThan(-179);
    const coordinates = loadingOverlayCoordinates(area!.bounds);
    const sourceLongitudes = coordinates.map(([lon]) => lon);
    expect((Math.min(...sourceLongitudes) + Math.max(...sourceLongitudes)) / 2).toBeCloseTo(-180);
    expect(Math.max(...sourceLongitudes) - Math.min(...sourceLongitudes)).toBeLessThan(1);
    expect(
      tilesForBounds(
        area!.bounds.minLat,
        area!.bounds.maxLat,
        area!.bounds.minLon,
        area!.bounds.maxLon,
      ).every((key) => key.endsWith("E179") || key.endsWith("W180")),
    ).toBe(true);
    expect(area?.contains(10.15, 179.95)).toBe(true);
    expect(area?.contains(10.15, -179.95)).toBe(true);
    expect(area?.contains(10.15, 0)).toBe(false);
  });
});
