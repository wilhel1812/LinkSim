import { describe, expect, it } from "vitest";
import { resolveSingleSiteBonusRadiusKm } from "./singleSiteBonusRadius";
import type { Site, SrtmTile } from "../types/radio";

const site: Pick<Site, "position"> = {
  position: { lat: 59.9, lon: 10.7 },
};

const mkTile = (key: string, sourceId = "copernicus30"): SrtmTile => ({
  key,
  latStart: 59,
  lonStart: 10,
  size: 1201,
  arcSecondSpacing: 3,
  elevations: new Int16Array(1201 * 1201),
  sourceId,
});

describe("resolveSingleSiteBonusRadiusKm", () => {
  it("keeps base radius when no 30m tiles are loaded", () => {
    const radius = resolveSingleSiteBonusRadiusKm(site, [], { baseRadiusKm: 20, maxRadiusKm: 100 });
    expect(radius).toBe(20);
  });

  it("ignores non-30m loaded tiles for bonus expansion", () => {
    const radius = resolveSingleSiteBonusRadiusKm(site, [mkTile("N59E010", "copernicus90")], {
      baseRadiusKm: 20,
      maxRadiusKm: 100,
    });
    expect(radius).toBe(20);
  });

  it("stays conservative when surrounding 30m coverage is not full-circle", () => {
    const radius = resolveSingleSiteBonusRadiusKm(
      site,
      [mkTile("N59E010"), mkTile("N60E010"), mkTile("N59E011")],
      { baseRadiusKm: 20, maxRadiusKm: 100 },
    );
    expect(radius).toBe(20);
  });

  it("expands and respects the maximum cap when fully covered around the site", () => {
    const tiles = [
      mkTile("N59E010"),
      mkTile("N60E010"),
      mkTile("N58E010"),
      mkTile("N59E009"),
      mkTile("N59E011"),
      mkTile("N60E009"),
      mkTile("N60E011"),
      mkTile("N58E009"),
      mkTile("N58E011"),
    ];
    const radius = resolveSingleSiteBonusRadiusKm(site, tiles, { baseRadiusKm: 20, maxRadiusKm: 100 });
    expect(radius).toBeGreaterThan(50);
    expect(radius).toBeLessThanOrEqual(100);
  });
});

