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

const NORMAL_GRID = 24;
const HIGH_GRID = 42;

describe("buildCoverage", () => {
  it("creates non-empty coverage at normal resolution (24×24 grid)", () => {
    const result = buildCoverage(NORMAL_GRID, network, sites, systems, "FSPL", defaultPropagationEnvironment());
    expect(result.length).toBeGreaterThan(100);
    expect(Number.isFinite(result[0].valueDbm)).toBe(true);
  });

  it("creates more samples at high resolution (42×42 grid)", () => {
    const normal = buildCoverage(NORMAL_GRID, network, sites, systems, "FSPL", defaultPropagationEnvironment());
    const high = buildCoverage(HIGH_GRID, network, sites, systems, "FSPL", defaultPropagationEnvironment());
    expect(high.length).toBeGreaterThan(normal.length);
  });

  it("changes computed values when propagation model changes", () => {
    const fspl = buildCoverage(NORMAL_GRID, network, sites, systems, "FSPL", defaultPropagationEnvironment());
    const twoRay = buildCoverage(NORMAL_GRID, network, sites, systems, "TwoRay", defaultPropagationEnvironment());
    const maxDiff = fspl.reduce((max, sample, index) => {
      const diff = Math.abs(sample.valueDbm - twoRay[index].valueDbm);
      return Math.max(max, diff);
    }, 0);

    expect(maxDiff).toBeGreaterThan(0.1);
  });

  it("supports ITM model", () => {
    const itm = buildCoverage(NORMAL_GRID, network, sites, systems, "ITM", defaultPropagationEnvironment());
    expect(itm.length).toBeGreaterThan(100);
    expect(Number.isFinite(itm[0].valueDbm)).toBe(true);
  });

  it("buildCoverageAsync matches sync output shape", async () => {
    const sync = buildCoverage(NORMAL_GRID, network, sites, systems, "FSPL", defaultPropagationEnvironment());
    const asyncResult = await buildCoverageAsync(NORMAL_GRID, network, sites, systems, "FSPL", defaultPropagationEnvironment());
    expect(asyncResult).toHaveLength(sync.length);
    expect(Math.abs(asyncResult[0].valueDbm - sync[0].valueDbm)).toBeLessThan(0.0001);
  });
});
