import { describe, expect, it } from "vitest";
import { computeSourceCentricRxMetrics } from "./passFailState";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

const fromSite: Site = {
  id: "a",
  name: "A",
  position: { lat: 59.9, lon: 10.7 },
  groundElevationM: 100,
  antennaHeightM: 2,
  txPowerDbm: 22,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const link: Link = {
  id: "lnk",
  fromSiteId: "a",
  toSiteId: "b",
  frequencyMHz: 869.618,
  txPowerDbm: 22,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const environment: PropagationEnvironment = {
  radioClimate: "Continental Temperate",
  polarization: "Vertical",
  clutterHeightM: 0,
  groundDielectric: 15,
  groundConductivity: 0.005,
  atmosphericBendingNUnits: 301,
};

describe("computeSourceCentricRxMetrics", () => {
  it("detects terrain obstruction for long flat low-antenna links when terrain sampler is provided", () => {
    const flatSampler = () => 100;

    const result = computeSourceCentricRxMetrics(
      61.2,
      10.7,
      fromSite,
      link,
      2,
      2,
      flatSampler,
      64,
      environment,
    );

    expect(result.terrainObstructed).toBe(true);
    expect(Number.isFinite(result.rxDbm)).toBe(true);
  });
});
