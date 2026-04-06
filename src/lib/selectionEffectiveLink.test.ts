import { describe, expect, it } from "vitest";
import type { Link, Site } from "../types/radio";
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
  it("uses saved link for selected pair and preserves saved radio overrides", () => {
    const links: Link[] = [
      {
        id: "saved",
        name: "A-B",
        fromSiteId: "site-a",
        toSiteId: "site-b",
        frequencyMHz: 433,
        txPowerDbm: 30,
        txGainDbi: 9,
        rxGainDbi: 7,
        cableLossDb: 0.5,
      },
    ];

    const effective = buildSelectionEffectiveLink({
      links,
      fromSite: siteA,
      toSite: siteB,
      frequencyMHz: 868,
    });

    expect(effective).toMatchObject({
      id: "saved",
      fromSiteId: "site-a",
      toSiteId: "site-b",
      frequencyMHz: 868,
      txPowerDbm: 30,
      txGainDbi: 9,
      rxGainDbi: 7,
      cableLossDb: 0.5,
    });
  });

  it("matches saved link regardless of selected direction", () => {
    const links: Link[] = [
      {
        id: "saved",
        fromSiteId: "site-a",
        toSiteId: "site-b",
        frequencyMHz: 433,
      },
    ];

    const effective = buildSelectionEffectiveLink({
      links,
      fromSite: siteB,
      toSite: siteA,
      frequencyMHz: 868,
    });

    expect(effective?.id).toBe("saved");
    expect(effective?.frequencyMHz).toBe(868);
  });

  it("builds temporary link from Site radio when no saved pair exists", () => {
    const effective = buildSelectionEffectiveLink({
      links: [],
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
