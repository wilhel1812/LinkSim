import { describe, expect, it } from "vitest";
import { collapseSiteGainToTx, getSyncedSiteGainPair, shouldUseSeparateSiteGain } from "./siteGainFields";

describe("site gain fields", () => {
  it("uses the single gain mode when tx and rx gains match", () => {
    expect(shouldUseSeparateSiteGain(7, 7)).toBe(false);
  });

  it("uses separate gain mode when existing tx and rx gains differ", () => {
    expect(shouldUseSeparateSiteGain(9, 3)).toBe(true);
  });

  it("maps the single gain field to both persisted tx and rx gain values", () => {
    expect(getSyncedSiteGainPair(12)).toEqual({ txGainDbi: 12, rxGainDbi: 12 });
  });

  it("copies tx gain to rx gain when separate gain mode is disabled", () => {
    expect(collapseSiteGainToTx(8)).toEqual({ txGainDbi: 8, rxGainDbi: 8 });
  });
});
