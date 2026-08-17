import { describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const mock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
  vi.stubGlobal("localStorage", mock);
  vi.stubGlobal("window", { localStorage: mock, setTimeout, clearTimeout });
  return { data };
});

vi.mock("../lib/coverage", () => ({ buildCoverage: vi.fn(() => []), clearTerrainLossCache: vi.fn() }));
vi.mock("../lib/elevationService", () => ({ fetchElevations: vi.fn(async () => [123]) }));

describe("appStore persisted Library validation", () => {
  it("boots with valid records, quarantines malformed records, and removes the legacy signature", async () => {
    storage.data.clear();
    storage.data.set("rmw-site-library-v1", JSON.stringify([
      {
        id: "site-valid", name: "Valid", position: { lat: 60, lon: 10 }, createdAt: "2026-08-16T00:00:00.000Z",
        groundElevationM: 100, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
      },
      null,
      {
        id: "site-invalid", name: "Invalid", position: { lat: 100, lon: 10 },
        groundElevationM: 100, antennaHeightM: 2, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
      },
    ]));
    storage.data.set("rmw-sim-presets-v1", "not-json");
    storage.data.set("linksim-sync-signature-v1", JSON.stringify({ private: "payload" }));

    const { useAppStore } = await import("./appStore");

    expect(useAppStore.getState().siteLibrary.map((entry) => entry.id)).toEqual(["site-valid"]);
    expect(useAppStore.getState().simulationPresets).toEqual([]);
    const quarantine = JSON.parse(storage.data.get("linksim-library-quarantine-v1") ?? "[]") as Array<{ id: string | null }>;
    expect(quarantine).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: null }),
      expect.objectContaining({ id: "site-invalid" }),
    ]));
    expect(storage.data.has("linksim-sync-signature-v1")).toBe(false);
    expect(storage.data.get("rmw-site-library-v1")).not.toContain("site-invalid");
  });
});
