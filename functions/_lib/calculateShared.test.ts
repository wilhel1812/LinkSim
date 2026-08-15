import { describe, expect, it } from "vitest";
import { estimateSampleCount, estimateSyncSampleCount, haversineKm, MAX_CALCULATION_BODY_BYTES, MAX_NODE_NAME_LENGTH, normalizeCalculationRequest } from "./calculateShared";

const payload = () => ({ calculation: "link_budget", input: { from_site: "A", to_site: "B", frequency_mhz: 868, nodes: [
  { name: "A", lat: 1, lon: 1 }, { name: "B", lat: 2, lon: 2 },
] } });

describe("calculation request limits", () => {
  it("documents the exact 64 KiB body quota", () => expect(MAX_CALCULATION_BODY_BYTES).toBe(65_536));
  it("accepts names at the boundary and rejects names beyond it", () => {
    const valid = payload(); valid.input.nodes[0].name = "x".repeat(MAX_NODE_NAME_LENGTH); valid.input.from_site = valid.input.nodes[0].name;
    expect(normalizeCalculationRequest(valid).input.nodes[0].name).toHaveLength(80);
    valid.input.nodes[0].name += "x";
    expect(() => normalizeCalculationRequest(valid)).toThrow("may not exceed 80 characters");
  });
  it("counts astral Unicode names by characters", () => {
    const valid = payload(); valid.input.nodes[0].name = "😀".repeat(80); valid.input.from_site = valid.input.nodes[0].name;
    expect(normalizeCalculationRequest(valid).input.nodes[0].name).toBe("😀".repeat(80));
    valid.input.nodes[0].name += "😀";
    expect(() => normalizeCalculationRequest(valid)).toThrow("may not exceed 80 characters");
  });
  it("accepts 20 nodes and rejects 21", () => {
    const valid = payload();
    valid.input.nodes = Array.from({ length: 20 }, (_, index) => ({ name: index === 0 ? "A" : index === 1 ? "B" : `node-${index}`, lat: 1, lon: 1 }));
    expect(normalizeCalculationRequest(valid).input.nodes).toHaveLength(20);
    valid.input.nodes.push({ name: "node-21", lat: 1, lon: 1 });
    expect(() => normalizeCalculationRequest(valid)).toThrow("maximum of 20 sites");
  });
  it.each(["frequency_mhz", "rx_target_dbm", "environment_loss_db"])("rejects non-finite %s", (field) => {
    const invalid = payload(); (invalid.input as unknown as Record<string, unknown>)[field] = Number.POSITIVE_INFINITY;
    expect(() => normalizeCalculationRequest(invalid)).toThrow("must be a valid number");
  });
  it.each(["frequency_mhz", "rx_target_dbm", "environment_loss_db"])("rejects string and boolean numeric coercion for %s", (field) => {
    for (const value of ["1", true]) {
      const invalid = payload(); (invalid.input as unknown as Record<string, unknown>)[field] = value;
      expect(() => normalizeCalculationRequest(invalid)).toThrow("must be a valid number");
    }
  });
  it("rejects non-finite optional node numbers rather than passing them through", () => {
    const invalid = payload(); (invalid.input.nodes[0] as Record<string, unknown>).tx_power_dbm = Number.NaN;
    expect(() => normalizeCalculationRequest(invalid)).toThrow("nodes[0].tx_power_dbm must be a valid number");
  });
  it.each([
    "lat", "lon", "tx_power_dbm", "tx_gain_dbi", "rx_gain_dbi", "cable_loss_db", "antenna_height_m",
    "ground_elevation_m", "antenna_azimuth_deg", "antenna_tilt_deg", "antenna_horizontal_beamwidth_deg",
    "antenna_vertical_beamwidth_deg", "antenna_max_attenuation_db",
  ])("rejects wrong-type and non-finite node numeric field %s", (field) => {
    const wrongType = payload(); (wrongType.input.nodes[0] as Record<string, unknown>)[field] = "1";
    expect(() => normalizeCalculationRequest(wrongType)).toThrow("must be a valid number");
    const nonFinite = payload(); (nonFinite.input.nodes[0] as Record<string, unknown>)[field] = Number.NEGATIVE_INFINITY;
    expect(() => normalizeCalculationRequest(nonFinite)).toThrow("must be a valid number");
  });
  it("keeps exact distance and terrain sample contracts", () => {
    const longitudeFor = (distanceKm: number) => distanceKm / 6371 * 180 / Math.PI;
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: longitudeFor(500) })).toBeCloseTo(500, 9);
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: longitudeFor(2000) })).toBeCloseTo(2000, 9);
    expect(estimateSampleCount(0)).toBe(24);
    expect(estimateSampleCount(2000)).toBe(500);
    expect(estimateSyncSampleCount(0)).toBe(24);
    expect(estimateSyncSampleCount(500)).toBe(72);
  });
});
