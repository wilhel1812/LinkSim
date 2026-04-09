import { describe, expect, it } from "vitest";
import { azimuthFromToDeg, buildPanorama, destinationForDistanceKm, earthCurvatureDropM, qualityToSampling } from "./panorama";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

const site: Site = {
  id: "site-a",
  name: "A",
  position: { lat: 59.9, lon: 10.7 },
  groundElevationM: 120,
  antennaHeightM: 10,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const link: Link = {
  id: "lnk",
  fromSiteId: "site-a",
  toSiteId: "site-b",
  frequencyMHz: 869.5,
};

const env: PropagationEnvironment = {
  radioClimate: "Maritime Temperate (Land)",
  polarization: "Vertical",
  clutterHeightM: 0,
  groundDielectric: 15,
  groundConductivity: 0.005,
  atmosphericBendingNUnits: 301,
};

describe("panorama", () => {
  it("provides expected quality defaults", () => {
    expect(qualityToSampling("drag")).toEqual({ azimuthStepDeg: 5, radialSamples: 64 });
    expect(qualityToSampling("full")).toEqual({ azimuthStepDeg: 1, radialSamples: 192 });
  });

  it("calculates geodesic helpers in expected range", () => {
    const point = destinationForDistanceKm(site.position, 90, 10);
    expect(point.lat).toBeGreaterThan(59);
    expect(point.lon).toBeGreaterThan(site.position.lon);
    const az = azimuthFromToDeg(site.position, point);
    expect(az).toBeGreaterThan(80);
    expect(az).toBeLessThan(100);
    expect(earthCurvatureDropM(10, 1.33)).toBeGreaterThan(4);
  });

  it("builds panorama rays and node projections", () => {
    const result = buildPanorama({
      selectedSite: site,
      effectiveLink: link,
      propagationEnvironment: env,
      rxSensitivityTargetDbm: -120,
      environmentLossDb: 0,
      quality: "drag",
      terrainSampler: () => 120,
      nodeCandidates: [
        {
          id: "n1",
          name: "N1",
          lat: 59.95,
          lon: 10.8,
          groundElevationM: 140,
          antennaHeightM: 8,
          rxGainDbi: 2,
        },
      ],
      options: { baseRadiusKm: 50, maxRadiusKm: 80 },
    });

    expect(result.rays.length).toBe(72);
    expect(result.radiusPolicyKm).toBe(50);
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].state).toMatch(/pass_|fail_/);
    expect(result.maxAngleDeg).toBeGreaterThan(result.minAngleDeg);
  });
});
