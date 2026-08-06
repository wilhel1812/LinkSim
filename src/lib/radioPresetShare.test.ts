import { describe, expect, it } from "vitest";
import { defaultPropagationEnvironment } from "./propagationEnvironment";
import {
  buildRadioPresetShareHash,
  parseRadioPresetShareHash,
  RADIO_PRESET_SHARE_MAX_ENCODED_LENGTH,
} from "./radioPresetShare";

const defaults = {
  frequencyPresetId: "custom-source",
  frequencyMHz: 869.618,
  bandwidthKhz: 62.5,
  spreadFactor: 8,
  codingRate: 5,
  regionCode: "EU_868",
  rxSensitivityTargetDbm: -130,
  environmentLossDb: 3,
  propagationEnvironment: defaultPropagationEnvironment(),
  autoPropagationEnvironment: false,
};

describe("radioPresetShare", () => {
  it("round trips a complete preset with a unicode name", () => {
    const hash = buildRadioPresetShareHash({ name: "Høgevarde 📡", defaults });
    expect(hash).toMatch(/^#preset=[A-Za-z0-9_-]+$/);
    expect(parseRadioPresetShareHash(hash)).toEqual({
      ok: true,
      preset: { name: "Høgevarde 📡", defaults: { ...defaults, frequencyPresetId: "custom" } },
    });
  });

  it("rejects malformed, oversized, and unsupported payloads", () => {
    expect(parseRadioPresetShareHash("#preset=not-json")).toMatchObject({ ok: false });
    expect(parseRadioPresetShareHash(`#preset=${"a".repeat(RADIO_PRESET_SHARE_MAX_ENCODED_LENGTH + 1)}`)).toEqual({
      ok: false,
      reason: "too_large",
    });
    const unsupported = btoa(JSON.stringify({ v: 2, name: "Future", defaults }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(parseRadioPresetShareHash(`#preset=${unsupported}`)).toEqual({ ok: false, reason: "unsupported_version" });
  });

  it("strictly validates names and radio/environment values", () => {
    expect(() => buildRadioPresetShareHash({ name: " ", defaults })).toThrow(/name/i);
    expect(() => buildRadioPresetShareHash({ name: "x".repeat(81), defaults })).toThrow(/name/i);
    expect(() => buildRadioPresetShareHash({ name: "Bad frequency", defaults: { ...defaults, frequencyMHz: 0 } })).toThrow(/frequency/i);
    expect(() => buildRadioPresetShareHash({ name: "Bad SF", defaults: { ...defaults, spreadFactor: 13 } })).toThrow(/spread factor/i);
    expect(() => buildRadioPresetShareHash({ name: "Bad CR", defaults: { ...defaults, codingRate: 4 } })).toThrow(/coding rate/i);
    expect(() => buildRadioPresetShareHash({ name: "Bad climate", defaults: { ...defaults, propagationEnvironment: { ...defaults.propagationEnvironment, radioClimate: "Moon" as never } } })).toThrow(/climate/i);
    expect(() => buildRadioPresetShareHash({ name: "Bad automatic mode", defaults: { ...defaults, autoPropagationEnvironment: "yes" as never } })).toThrow(/automatic environment/i);
  });
});
