import { describe, expect, it } from "vitest";
import type { Site } from "../types/radio";
import { buildSelectionEffectiveLink } from "./selectionEffectiveLink";

const siteA: Site = {
  id: "site-a",
  name: "Alpha",
  position: { lat: 1, lon: 1 },
  groundElevationM: 100,
  antennaHeightM: 2,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 3,
  cableLossDb: 1,
};

const siteB: Site = {
  id: "site-b",
  name: "Beta",
  position: { lat: 2, lon: 2 },
  groundElevationM: 120,
  antennaHeightM: 2,
  txPowerDbm: 27,
  txGainDbi: 4,
  rxGainDbi: 5,
  cableLossDb: 2,
};

describe("buildSelectionEffectiveLink", () => {
  it("builds temporary link from Site radio defaults", () => {
    const effective = buildSelectionEffectiveLink({
      fromSite: siteA,
      toSite: siteB,
      frequencyMHz: 868,
    });

    expect(effective).toMatchObject({
      id: "__selection__",
      fromSiteId: "site-a",
      toSiteId: "site-b",
      frequencyMHz: 868,
      txPowerDbm: siteA.txPowerDbm,
      txGainDbi: siteA.txGainDbi,
      rxGainDbi: siteB.rxGainDbi,
      cableLossDb: siteA.cableLossDb,
    });
  });

  it("keeps temporary selection id regardless of selected direction", () => {
    const effective = buildSelectionEffectiveLink({
      fromSite: siteB,
      toSite: siteA,
      frequencyMHz: 868,
    });

    expect(effective?.id).toBe("__selection__");
    expect(effective?.frequencyMHz).toBe(868);
  });

  it("builds temporary link from Site radio when no saved pair exists", () => {
    const effective = buildSelectionEffectiveLink({
      fromSite: siteA,
      toSite: siteB,
      frequencyMHz: 868,
    });

    expect(effective).toMatchObject({
      id: "__selection__",
      fromSiteId: "site-a",
      toSiteId: "site-b",
      frequencyMHz: 868,
      txPowerDbm: siteA.txPowerDbm,
      txGainDbi: siteA.txGainDbi,
      rxGainDbi: siteB.rxGainDbi,
      cableLossDb: siteA.cableLossDb,
    });
  });
});
