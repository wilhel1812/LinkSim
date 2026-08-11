import { describe, expect, it } from "vitest";
import {
  antennaPatternSignature,
  antennaAttenuationDb,
  effectiveDirectionalGainDbi,
  orientationTowardSite,
  resolvePreviewSiteOrientations,
  resolveSiteAntennaPattern,
} from "./antennaPattern";
import type { Site } from "../types/radio";

const site = (patch: Partial<Site> = {}): Site => ({
  id: "a",
  name: "A",
  position: { lat: 60, lon: 10 },
  groundElevationM: 100,
  antennaHeightM: 10,
  txPowerDbm: 22,
  txGainDbi: 9,
  rxGainDbi: 9,
  cableLossDb: 1,
  ...patch,
});

describe("directional antenna pattern", () => {
  it("keeps legacy and omnidirectional sites unattenuated", () => {
    expect(antennaAttenuationDb(site(), { azimuthDeg: 180, elevationDeg: 45 })).toBe(0);
    expect(resolveSiteAntennaPattern(site()).mode).toBe("omnidirectional");
  });

  it("uses full gain on boresight and independent horizontal and vertical beamwidths", () => {
    const antenna = site({
      antennaMode: "directional",
      antennaAzimuthDeg: 350,
      antennaTiltDeg: 10,
      antennaHorizontalBeamwidthDeg: 60,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });

    expect(antennaAttenuationDb(antenna, { azimuthDeg: 350, elevationDeg: 10 })).toBe(0);
    expect(antennaAttenuationDb(antenna, { azimuthDeg: 20, elevationDeg: 10 })).toBeCloseTo(3);
    expect(antennaAttenuationDb(antenna, { azimuthDeg: 350, elevationDeg: 25 })).toBeCloseTo(3);
  });

  it("wraps north and caps combined side and rear attenuation", () => {
    const antenna = site({
      antennaMode: "directional",
      antennaAzimuthDeg: 350,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 60,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });

    expect(antennaAttenuationDb(antenna, { azimuthDeg: 10, elevationDeg: 0 })).toBeCloseTo(4 / 3);
    expect(antennaAttenuationDb(antenna, { azimuthDeg: 170, elevationDeg: -80 })).toBe(25);
    expect(effectiveDirectionalGainDbi(9, antenna, { azimuthDeg: 170, elevationDeg: 0 })).toBe(-16);
  });

  it("normalizes invalid directional settings to documented defaults", () => {
    expect(resolveSiteAntennaPattern(site({
      antennaMode: "directional",
      antennaAzimuthDeg: 725,
      antennaTiltDeg: 120,
      antennaHorizontalBeamwidthDeg: 0,
      antennaVerticalBeamwidthDeg: 500,
      antennaMaxAttenuationDb: 100,
    }))).toEqual({
      mode: "directional",
      azimuthDeg: 5,
      tiltDeg: 90,
      horizontalBeamwidthDeg: 1,
      verticalBeamwidthDeg: 180,
      maxAttenuationDb: 60,
    });
  });

  it("changes the cache signature for every effective directional setting", () => {
    const directional = site({
      antennaMode: "directional",
      antennaAzimuthDeg: 10,
      antennaTiltDeg: 2,
      antennaHorizontalBeamwidthDeg: 60,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });
    const signature = antennaPatternSignature(directional);

    expect(antennaPatternSignature({ ...directional, antennaAzimuthDeg: 11 })).not.toBe(signature);
    expect(antennaPatternSignature({ ...directional, antennaTiltDeg: 3 })).not.toBe(signature);
    expect(antennaPatternSignature({ ...directional, antennaHorizontalBeamwidthDeg: 61 })).not.toBe(signature);
    expect(antennaPatternSignature({ ...directional, antennaVerticalBeamwidthDeg: 31 })).not.toBe(signature);
    expect(antennaPatternSignature({ ...directional, antennaMaxAttenuationDb: 26 })).not.toBe(signature);
    expect(antennaPatternSignature({ ...directional, antennaMode: "omnidirectional" })).not.toBe(signature);
    expect(antennaPatternSignature(site({ antennaAzimuthDeg: 90 }))).toBe(antennaPatternSignature(site()));
  });

  it("derives upward and downward pointing from antenna-tip elevations", () => {
    const valley = site({ position: { lat: 60, lon: 10 }, groundElevationM: 100, antennaHeightM: 2 });
    const summit = site({ id: "b", position: { lat: 60.01, lon: 10 }, groundElevationM: 1100, antennaHeightM: 10 });
    const upward = orientationTowardSite(valley, summit);
    const downward = orientationTowardSite(summit, valley);

    expect(upward.azimuthDeg).toBeCloseTo(0, 4);
    expect(upward.elevationDeg).toBeGreaterThan(0);
    expect(downward.azimuthDeg).toBeCloseTo(180, 4);
    expect(downward.elevationDeg).toBeLessThan(0);
  });

  it("resolves tracked orientation from pending source and target geometry", () => {
    const tracked = site({
      antennaMode: "directional",
      antennaTargetSiteId: "b",
      antennaAzimuthDeg: 0,
      antennaTiltDeg: 0,
    });
    const target = site({ id: "b", position: { lat: 60.01, lon: 10 } });

    const targetMovedEast = resolvePreviewSiteOrientations([tracked, target], {
      b: { position: { lat: 60, lon: 10.02 }, groundElevationM: target.groundElevationM },
    });
    expect(targetMovedEast[0].antennaAzimuthDeg).toBeCloseTo(90, 1);

    const sourceMovedEast = resolvePreviewSiteOrientations([tracked, target], {
      a: { position: { lat: 60.01, lon: 10.02 }, groundElevationM: tracked.groundElevationM },
    });
    expect(sourceMovedEast[0].antennaAzimuthDeg).toBeCloseTo(270, 1);
  });
});
