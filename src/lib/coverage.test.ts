import { describe, expect, it } from "vitest";
import { buildCoverage, buildCoverageAsync } from "./coverage";
import { defaultPropagationEnvironment } from "./propagationEnvironment";
import type { Network, RadioSystem, Site } from "../types/radio";

const sites: Site[] = [
  {
    id: "s1",
    name: "One",
    position: { lat: 59.9, lon: 10.7 },
    groundElevationM: 100,
    antennaHeightM: 20,
    txPowerDbm: 22,
    txGainDbi: 2,
    rxGainDbi: 2,
    cableLossDb: 1,
  },
  {
    id: "s2",
    name: "Two",
    position: { lat: 59.95, lon: 10.85 },
    groundElevationM: 130,
    antennaHeightM: 16,
    txPowerDbm: 22,
    txGainDbi: 2,
    rxGainDbi: 2,
    cableLossDb: 1,
  },
];

const systems: RadioSystem[] = [
  {
    id: "sys-a",
    name: "Base",
    txPowerDbm: 30,
    txGainDbi: 12,
    rxGainDbi: 12,
    cableLossDb: 1,
    antennaHeightM: 24,
  },
];

const network: Network = {
  id: "n1",
  name: "Test",
  frequencyMHz: 433,
  bandwidthKhz: 250,
  spreadFactor: 11,
  codingRate: 5,
  memberships: [
    { siteId: "s1", systemId: "sys-a" },
    { siteId: "s2", systemId: "sys-a" },
  ],
};

describe("buildCoverage", () => {
  it("creates non-empty coverage in BestSite mode", () => {
    const result = buildCoverage("BestSite", network, sites, systems, "FSPL", defaultPropagationEnvironment());
    expect(result.length).toBeGreaterThan(100);
    expect(Number.isFinite(result[0].valueDbm)).toBe(true);
  });

  it("creates route samples in Route mode", () => {
    const result = buildCoverage("Route", network, sites, systems, "FSPL", defaultPropagationEnvironment());
    expect(result).toHaveLength(120);
  });

  it("changes computed values when propagation model changes", () => {
    const fspl = buildCoverage("Polar", network, sites, systems, "FSPL", defaultPropagationEnvironment());
    const twoRay = buildCoverage("Polar", network, sites, systems, "TwoRay", defaultPropagationEnvironment());
    const maxDiff = fspl.reduce((max, sample, index) => {
      const diff = Math.abs(sample.valueDbm - twoRay[index].valueDbm);
      return Math.max(max, diff);
    }, 0);

    expect(maxDiff).toBeGreaterThan(0.1);
  });

  it("supports ITM mode generation", () => {
    const itm = buildCoverage("BestSite", network, sites, systems, "ITM", defaultPropagationEnvironment());
    expect(itm.length).toBeGreaterThan(100);
    expect(Number.isFinite(itm[0].valueDbm)).toBe(true);
  });

  it("buildCoverageAsync matches sync output shape", async () => {
    const sync = buildCoverage("Polar", network, sites, systems, "FSPL", defaultPropagationEnvironment());
    const asyncResult = await buildCoverageAsync("Polar", network, sites, systems, "FSPL", defaultPropagationEnvironment());
    expect(asyncResult).toHaveLength(sync.length);
    expect(Math.abs(asyncResult[0].valueDbm - sync[0].valueDbm)).toBeLessThan(0.0001);
  });
});
