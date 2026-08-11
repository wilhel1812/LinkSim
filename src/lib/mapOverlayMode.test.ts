import { describe, expect, it } from "vitest";
import { meshExtensionSiteDigest, overlayGuideTitleForMode, overlayModesForSelectionCount } from "./mapOverlayMode";
import type { Site } from "../types/radio";

describe("map overlay modes", () => {
  it("treats no selection as all Simulation Sites for Mesh Extension", () => {
    expect(overlayModesForSelectionCount(0, 0)).not.toContain("mesh-extension");
    expect(overlayModesForSelectionCount(0, 4)).toContain("mesh-extension");
    expect(overlayModesForSelectionCount(1, 4)).toContain("mesh-extension");
    expect(overlayModesForSelectionCount(2, 4)).toContain("mesh-extension");
    expect(overlayModesForSelectionCount(3, 4)).toContain("mesh-extension");
  });

  it("keeps existing selection defaults separate from manual mode availability", () => {
    expect(overlayModesForSelectionCount(1)).toContain("passfail");
    expect(overlayModesForSelectionCount(2)).toContain("relay");
  });

  it("provides the Mesh Extension guide title", () => {
    expect(overlayGuideTitleForMode("mesh-extension")).toBe("Mesh Extension");
  });

  it("invalidates mesh-extension identity when location, terrain, or radio values change", () => {
    const site: Site = {
      id: "a",
      name: "A",
      position: { lat: 60, lon: 10 },
      groundElevationM: 100,
      antennaHeightM: 5,
      txPowerDbm: 22,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
    };
    const baseline = meshExtensionSiteDigest([site]);

    expect(meshExtensionSiteDigest([{ ...site, position: { ...site.position, lat: 60.1 } }])).not.toBe(baseline);
    expect(meshExtensionSiteDigest([{ ...site, groundElevationM: 120 }])).not.toBe(baseline);
    expect(meshExtensionSiteDigest([{ ...site, txPowerDbm: 24 }])).not.toBe(baseline);
    expect(meshExtensionSiteDigest([{ ...site, antennaMode: "directional", antennaAzimuthDeg: 0 }])).not.toBe(baseline);
    expect(meshExtensionSiteDigest([{ ...site, antennaMode: "directional", antennaAzimuthDeg: 90 }])).not.toBe(
      meshExtensionSiteDigest([{ ...site, antennaMode: "directional", antennaAzimuthDeg: 0 }]),
    );
  });
});
