import { describe, expect, it } from "vitest";
import { resolveRetryDelayMs, type RetryPolicy } from "./copernicusTerrainClient";

const policy: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 3000,
};

describe("copernicus retry delay", () => {
  it("uses exponential backoff when retry-after is absent", () => {
    expect(resolveRetryDelayMs(policy, 1, null)).toBe(500);
    expect(resolveRetryDelayMs(policy, 2, null)).toBe(1000);
    expect(resolveRetryDelayMs(policy, 3, null)).toBe(2000);
  });

  it("caps retry delay to configured max", () => {
    const response = new Response("", {
      status: 429,
      headers: { "retry-after": "120" },
    });
    expect(resolveRetryDelayMs(policy, 1, response)).toBe(3000);
  });

  it("respects retry-after when lower than cap", () => {
    const response = new Response("", {
      status: 429,
      headers: { "retry-after": "2" },
    });
    expect(resolveRetryDelayMs(policy, 2, response)).toBe(2000);
  });
});

describe("endpoint tile key partition", () => {
  it("correctly partitions tiles into priority and remaining", () => {
    const candidateKeys = ["N60E009", "N60E010", "N61E009", "N61E010", "N62E009", "N62E010"];
    const priorityKeys = new Set(["N60E009", "N60E010", "N61E009"]);
    const priorityKeysList = candidateKeys.filter((k) => priorityKeys.has(k));
    const remainingKeys = candidateKeys.filter((k) => !priorityKeys.has(k));
    expect(priorityKeysList.sort()).toEqual(["N60E009", "N60E010", "N61E009"]);
    expect(remainingKeys.sort()).toEqual(["N61E010", "N62E009", "N62E010"]);
  });

  it("treats empty priority set as no priority", () => {
    const candidateKeys = ["N60E009", "N60E010"];
    const priorityKeys = new Set<string>();
    const priorityKeysList = candidateKeys.filter((k) => priorityKeys.has(k));
    const remainingKeys = candidateKeys.filter((k) => !priorityKeys.has(k));
    expect(priorityKeysList).toEqual([]);
    expect(remainingKeys.sort()).toEqual(["N60E009", "N60E010"]);
  });

  it("endpoint keys cover 3x3 neighborhood around a site", () => {
    const siteLat = 60.5;
    const siteLon = 9.7;
    const endpointKeys = new Set<string>();
    for (const dLat of [-1, 0, 1]) {
      for (const dLon of [-1, 0, 1]) {
        const lat = siteLat + dLat;
        const lon = siteLon + dLon;
        const ns = lat >= 0 ? "N" : "S";
        const ew = lon >= 0 ? "E" : "W";
        endpointKeys.add(`${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`);
      }
    }
    expect(endpointKeys).toContain("N59E009");
    expect(endpointKeys).toContain("N60E009");
    expect(endpointKeys).toContain("N61E009");
    expect(endpointKeys).toContain("N59E010");
    expect(endpointKeys).toContain("N60E010");
    expect(endpointKeys).toContain("N61E010");
    expect(endpointKeys.size).toBe(9);
  });
});
