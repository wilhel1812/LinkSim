import { describe, expect, it } from "vitest";
import { analyzeLink, buildProfile } from "./propagation";
import type { Link, Site } from "../types/radio";

const a: Site = {
  id: "a",
  name: "A",
  position: { lat: 59.9, lon: 10.7 },
  groundElevationM: 100,
  antennaHeightM: 30,
};

const b: Site = {
  id: "b",
  name: "B",
  position: { lat: 59.92, lon: 10.82 },
  groundElevationM: 120,
  antennaHeightM: 25,
};

const link: Link = {
  id: "lnk",
  fromSiteId: "a",
  toSiteId: "b",
  frequencyMHz: 5800,
  txPowerDbm: 30,
  txGainDbi: 19,
  rxGainDbi: 19,
  cableLossDb: 1.5,
};

describe("analyzeLink", () => {
  it("returns finite RF metrics for FSPL", () => {
    const result = analyzeLink(link, a, b, "FSPL");

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(Number.isFinite(result.pathLossDb)).toBe(true);
    expect(Number.isFinite(result.rxLevelDbm)).toBe(true);
    expect(result.pathLossDb).toBeCloseTo(result.fsplDb, 6);
  });

  it("returns different path loss for TwoRay at longer paths", () => {
    const farB: Site = {
      ...b,
      position: { lat: 63.1, lon: 14.8 },
      antennaHeightM: 8,
    };
    const lowA: Site = { ...a, antennaHeightM: 10 };

    const fspl = analyzeLink(link, lowA, farB, "FSPL");
    const twoRay = analyzeLink(link, lowA, farB, "TwoRay");

    expect(twoRay.pathLossDb).not.toBeCloseTo(fspl.pathLossDb, 1);
  });

  it("supports ITM mode with additional excess loss compared to FSPL", () => {
    const itm = analyzeLink(link, a, b, "ITM");
    const fspl = analyzeLink(link, a, b, "FSPL");
    expect(itm.pathLossDb).toBeGreaterThanOrEqual(fspl.pathLossDb);
  });
});

describe("buildProfile", () => {
  it("builds the requested sample count", () => {
    const profile = buildProfile(link, a, b, undefined, 64);
    expect(profile).toHaveLength(64);
    expect(profile[0].distanceKm).toBe(0);
    expect(profile[63].distanceKm).toBeGreaterThan(profile[0].distanceKm);
  });
});
