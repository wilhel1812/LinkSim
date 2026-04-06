import { describe, expect, it } from "vitest";
import type { Link, Site } from "../types/radio";
import { stripRedundantLinkRadioOverrides } from "./linkRadio";

const fromSite: Site = {
  id: "from",
  name: "From",
  position: { lat: 1, lon: 1 },
  groundElevationM: 10,
  antennaHeightM: 2,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const toSite: Site = {
  id: "to",
  name: "To",
  position: { lat: 2, lon: 2 },
  groundElevationM: 12,
  antennaHeightM: 3,
  txPowerDbm: 21,
  txGainDbi: 3,
  rxGainDbi: 4,
  cableLossDb: 1.5,
};

const baseLink: Link = {
  id: "link-1",
  fromSiteId: "from",
  toSiteId: "to",
  frequencyMHz: 868,
};

describe("stripRedundantLinkRadioOverrides", () => {
  it("keeps overrides that differ from Site defaults", () => {
    const result = stripRedundantLinkRadioOverrides(
      {
        ...baseLink,
        txPowerDbm: 33,
        txGainDbi: 8,
        rxGainDbi: 9,
        cableLossDb: 0.2,
      },
      fromSite,
      toSite,
    );

    expect(result.txPowerDbm).toBe(33);
    expect(result.txGainDbi).toBe(8);
    expect(result.rxGainDbi).toBe(9);
    expect(result.cableLossDb).toBe(0.2);
  });

  it("keeps explicit overrides when values match Site defaults", () => {
    const result = stripRedundantLinkRadioOverrides(
      {
        ...baseLink,
        txPowerDbm: fromSite.txPowerDbm,
        txGainDbi: fromSite.txGainDbi,
        rxGainDbi: toSite.rxGainDbi,
        cableLossDb: fromSite.cableLossDb,
      },
      fromSite,
      toSite,
    );

    expect(result.txPowerDbm).toBe(fromSite.txPowerDbm);
    expect(result.txGainDbi).toBe(fromSite.txGainDbi);
    expect(result.rxGainDbi).toBe(toSite.rxGainDbi);
    expect(result.cableLossDb).toBe(fromSite.cableLossDb);
  });
});
