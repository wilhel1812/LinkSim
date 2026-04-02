import { describe, expect, it } from "vitest";
import { canonicalizeSimulationLookupKey } from "./db";

describe("canonicalizeSimulationLookupKey", () => {
  it("keeps unicode and emoji slugs stable", () => {
    expect(canonicalizeSimulationLookupKey("💩")).toBe("💩");
    expect(canonicalizeSimulationLookupKey("🏝~🌋")).toBe("🏝🌋");
  });

  it("normalizes spacing, casing, and delimiter characters", () => {
    expect(canonicalizeSimulationLookupKey("  Blefjell  ")).toBe("blefjell");
    expect(canonicalizeSimulationLookupKey("My + Sim / Name")).toBe("my-sim-name");
  });
});
