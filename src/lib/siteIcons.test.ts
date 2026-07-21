import { describe, expect, it } from "vitest";
import {
  isSiteIconKey,
  resolveSiteIconKey,
  suggestSiteIconKey,
} from "./siteIcons";

describe("siteIcons", () => {
  it("suggests a radio tower for antennas at least 10 m high", () => {
    expect(suggestSiteIconKey({ name: "Cabin", antennaHeightM: 10 })).toBe("radio-tower");
    expect(suggestSiteIconKey({ name: "Cabin", antennaHeightM: 9.99 })).toBe("house");
  });

  it.each([
    ["Repeater mast", "radio-tower"],
    ["Family cabin", "house"],
    ["Office roof", "building"],
    ["Summit gateway", "mountain"],
    ["Forest node", "tree"],
    ["Harbour vessel", "ship"],
    ["Mobile truck", "vehicle"],
    ["Plain gateway", "antenna"],
  ] as const)("suggests %s as %s", (name, expected) => {
    expect(suggestSiteIconKey({ name, antennaHeightM: 2 })).toBe(expected);
  });

  it("keeps a valid explicit choice and falls back to Auto for invalid persisted values", () => {
    expect(resolveSiteIconKey({ name: "Tall tower", antennaHeightM: 20, iconKey: "ship" })).toBe("ship");
    expect(resolveSiteIconKey({ name: "Tall tower", antennaHeightM: 20, iconKey: "invalid" })).toBe("radio-tower");
    expect(isSiteIconKey("mountain")).toBe(true);
    expect(isSiteIconKey("invalid")).toBe(false);
  });

  it("matches name keywords as words rather than substrings", () => {
    expect(suggestSiteIconKey({ name: "Carpenter Hill", antennaHeightM: 2 })).toBe("antenna");
  });
});
