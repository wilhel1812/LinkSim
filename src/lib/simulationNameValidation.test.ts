import { describe, expect, it } from "vitest";
import {
  duplicateSimulationNameMessage,
  hasDuplicateSimulationNameForOwner,
} from "./simulationNameValidation";

describe("hasDuplicateSimulationNameForOwner", () => {
  const entries = [
    { id: "sim-1", name: "Relay Plan", ownerUserId: "user-a" },
    { id: "sim-2", name: "Mountain Mesh", ownerUserId: "user-a" },
    { id: "sim-3", name: "Relay Plan", ownerUserId: "user-b" },
  ];

  it("detects duplicates only within same owner scope", () => {
    expect(hasDuplicateSimulationNameForOwner(entries, "relay plan", "user-a")).toBe(true);
    expect(hasDuplicateSimulationNameForOwner(entries, "relay plan", "user-b")).toBe(true);
    expect(hasDuplicateSimulationNameForOwner(entries, "relay plan", "user-c")).toBe(false);
  });

  it("ignores the current simulation when renaming", () => {
    expect(hasDuplicateSimulationNameForOwner(entries, "relay plan", "user-a", "sim-1")).toBe(false);
  });
});

describe("duplicateSimulationNameMessage", () => {
  it("returns a user-facing duplicate-name error", () => {
    expect(duplicateSimulationNameMessage("Relay Plan")).toContain("already exists");
  });
});
