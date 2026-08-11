import { describe, expect, it } from "vitest";
import {
  SIMULATION_COLOR_PRESETS,
  classifyAutoLinkState,
  normalizeSimulationColor,
  normalizeSiteIconColors,
  resolveAutoLinkStateColor,
  resolveAutoLinkStateForLink,
} from "./simulationColors";

describe("simulation colors", () => {
  it("exposes the approved rainbow presets", () => {
    expect(SIMULATION_COLOR_PRESETS.map((entry) => entry.label)).toEqual([
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Blue",
      "Purple",
    ]);
  });

  it("normalizes supported hex colors and rejects invalid values", () => {
    expect(normalizeSimulationColor("#ABC")).toBe("#aabbcc");
    expect(normalizeSimulationColor("#12aBcF")).toBe("#12abcf");
    expect(normalizeSimulationColor("red")).toBeNull();
    expect(normalizeSimulationColor("#abcd")).toBeNull();
  });

  it("normalizes site colors only for current simulation sites", () => {
    expect(
      normalizeSiteIconColors(
        { alpha: "#ABC", beta: "invalid", stale: "#123456" },
        ["alpha", "beta"],
      ),
    ).toEqual({ alpha: "#aabbcc" });
  });

  it.each([
    [true, false, "pass_clear"],
    [true, true, "pass_blocked"],
    [false, false, "fail_clear"],
    [false, true, "fail_blocked"],
  ] as const)("classifies pass=%s blocked=%s as %s", (pass, blocked, expected) => {
    expect(
      classifyAutoLinkState({
        rxDbm: pass ? -109 : -111,
        environmentLossDb: 10,
        rxSensitivityTargetDbm: -120,
        terrainObstructed: blocked,
      }),
    ).toBe(expected);
  });

  it("maps the four states to the existing profile color scheme", () => {
    const colors = {
      success: "#00aa44",
      warning: "#ffcc00",
      danger: "#dd0033",
    };
    expect(resolveAutoLinkStateColor("pass_clear", colors)).toBe(colors.success);
    expect(resolveAutoLinkStateColor("pass_blocked", colors)).toBe(colors.warning);
    expect(resolveAutoLinkStateColor("fail_blocked", colors)).toBe(colors.danger);
    expect(resolveAutoLinkStateColor("fail_clear", colors)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("recalculates the selected Link state in the temporarily flipped direction", () => {
    const from = {
      id: "from", name: "From", position: { lat: 60, lon: 10 }, groundElevationM: 0,
      antennaHeightM: 2, txPowerDbm: 30, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 0,
    };
    const to = {
      id: "to", name: "To", position: { lat: 60.01, lon: 10.01 }, groundElevationM: 0,
      antennaHeightM: 2, txPowerDbm: -30, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 0,
    };
    const input = {
      link: { id: "link", fromSiteId: "from", toSiteId: "to", frequencyMHz: 869.618 },
      sites: [from, to],
      environmentLossDb: 0,
      rxSensitivityTargetDbm: -100,
      propagationEnvironment: {
        radioClimate: "Continental Temperate" as const,
        polarization: "Vertical" as const,
        clutterHeightM: 0,
        groundDielectric: 15,
        groundConductivity: 0.005,
        atmosphericBendingNUnits: 301,
      },
      autoPropagationEnvironment: false,
      terrainSampler: () => 0,
    };

    expect(resolveAutoLinkStateForLink({ ...input, reversed: false })).toMatch(/^pass_/);
    expect(resolveAutoLinkStateForLink({ ...input, reversed: true })).toMatch(/^fail_/);
  });

  it("changes Auto Link state when reciprocal directional endpoints point away", () => {
    const from = {
      id: "from", name: "From", position: { lat: 60, lon: 10 }, groundElevationM: 0,
      antennaHeightM: 2, txPowerDbm: 30, txGainDbi: 6, rxGainDbi: 6, cableLossDb: 0,
      antennaMode: "directional" as const, antennaAzimuthDeg: 27, antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 30, antennaVerticalBeamwidthDeg: 30, antennaMaxAttenuationDb: 60,
    };
    const to = {
      ...from,
      id: "to",
      name: "To",
      position: { lat: 60.01, lon: 10.01 },
      antennaAzimuthDeg: 207,
    };
    const input = {
      link: { id: "link", fromSiteId: "from", toSiteId: "to", frequencyMHz: 869.618 },
      environmentLossDb: 0,
      rxSensitivityTargetDbm: -100,
      propagationEnvironment: {
        radioClimate: "Continental Temperate" as const,
        polarization: "Vertical" as const,
        clutterHeightM: 0,
        groundDielectric: 15,
        groundConductivity: 0.005,
        atmosphericBendingNUnits: 301,
      },
      autoPropagationEnvironment: false,
      terrainSampler: () => 0,
      reversed: false,
    };

    expect(resolveAutoLinkStateForLink({ ...input, sites: [from, to] })).toMatch(/^pass_/);
    expect(resolveAutoLinkStateForLink({
      ...input,
      sites: [
        { ...from, antennaAzimuthDeg: 207 },
        { ...to, antennaAzimuthDeg: 27 },
      ],
    })).toMatch(/^fail_/);
  });
});
