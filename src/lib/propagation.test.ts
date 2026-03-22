import { describe, expect, it } from "vitest";
import { analyzeLink, buildProfile } from "./propagation";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

const a: Site = {
  id: "a",
  name: "A",
  position: { lat: 59.9, lon: 10.7 },
  groundElevationM: 100,
  antennaHeightM: 30,
  txPowerDbm: 22,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const b: Site = {
  id: "b",
  name: "B",
  position: { lat: 59.92, lon: 10.82 },
  groundElevationM: 120,
  antennaHeightM: 25,
  txPowerDbm: 22,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
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

const defaultEnvironment: PropagationEnvironment = {
  radioClimate: "Continental Temperate",
  polarization: "Vertical",
  clutterHeightM: 0,
  groundDielectric: 15,
  groundConductivity: 0.005,
  atmosphericBendingNUnits: 301,
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

  it("reports terrain obstruction consistently for long flat low-antenna ITM links", () => {
    const farB: Site = {
      ...b,
      position: { lat: 61.2, lon: 10.82 },
      groundElevationM: 100,
      antennaHeightM: 2,
    };
    const lowA: Site = {
      ...a,
      groundElevationM: 100,
      antennaHeightM: 2,
    };
    const flatSampler = () => 100;

    const itm = analyzeLink(link, lowA, farB, "ITM", flatSampler, {
      terrainSamples: 64,
      environment: defaultEnvironment,
    });
    const fspl = analyzeLink(link, lowA, farB, "FSPL", flatSampler, {
      terrainSamples: 64,
      environment: defaultEnvironment,
    });

    expect(itm.terrainObstructed).toBe(true);
    expect(fspl.terrainObstructed).toBe(false);
  });
});

describe("buildProfile", () => {
  it("builds the requested sample count", () => {
    const profile = buildProfile(link, a, b, undefined, 64);
    expect(profile).toHaveLength(64);
    expect(profile[0].distanceKm).toBe(0);
    expect(profile[63].distanceKm).toBeGreaterThan(profile[0].distanceKm);
  });

  it("uses k-factor for curvature so profile matches LOS model assumptions", () => {
    const farB: Site = {
      ...b,
      position: { lat: 61.2, lon: 10.82 },
      groundElevationM: 100,
      antennaHeightM: 20,
    };
    const flatSampler = () => 100;
    const k1 = buildProfile(link, a, farB, flatSampler, 64, { kFactor: 1 });
    const k2 = buildProfile(link, a, farB, flatSampler, 64, { kFactor: 2 });
    const midIndex = Math.floor(k1.length / 2);

    expect(k1[midIndex].terrainM).toBeGreaterThan(k2[midIndex].terrainM);
  });
});
