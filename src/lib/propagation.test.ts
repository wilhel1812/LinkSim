import { describe, expect, it } from "vitest";
import { analyzeLink, buildProfile } from "./propagation";
import { fsplDb, itmApproxDb } from "./rfModels";
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
  it("returns finite RF metrics", () => {
    const result = analyzeLink(link, a, b, "ITM");

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(Number.isFinite(result.pathLossDb)).toBe(true);
    expect(Number.isFinite(result.rxLevelDbm)).toBe(true);
  });

  it("ITM adds excess path loss compared to free-space baseline", () => {
    const distanceKm = 1;
    const frequencyMHz = 5800;
    const txH = a.antennaHeightM;
    const rxH = b.antennaHeightM;
    expect(itmApproxDb(distanceKm, frequencyMHz, txH, rxH)).toBeGreaterThanOrEqual(
      fsplDb(distanceKm, frequencyMHz),
    );
  });

  it("reports terrain obstruction for long flat low-antenna links when terrain sampler is provided", () => {
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

    const result = analyzeLink(link, lowA, farB, "ITM", flatSampler, {
      terrainSamples: 64,
      environment: defaultEnvironment,
    });

    expect(result.terrainObstructed).toBe(true);
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

  it("uses only endpoint interpolation plus Earth bulge when terrain samples are missing", () => {
    const profile = buildProfile(link, a, b, undefined, 16, { kFactor: 1 });
    const totalDistanceKm = profile[profile.length - 1]?.distanceKm ?? 0.001;
    const effectiveRadiusM = 6_371_000;

    for (let i = 0; i < profile.length; i += 1) {
      const point = profile[i];
      const t = i / (profile.length - 1);
      const dTotalM = Math.max(1, totalDistanceKm * 1000);
      const x = dTotalM * t;
      const bulgeM = (x * (dTotalM - x)) / (2 * effectiveRadiusM);
      const expectedBaseM = a.groundElevationM + (b.groundElevationM - a.groundElevationM) * t;
      expect(point.terrainM).toBeCloseTo(expectedBaseM + bulgeM, 6);
    }
  });
});
