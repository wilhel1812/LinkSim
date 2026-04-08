import { describe, expect, it } from "vitest";
import { simulationAreaBoundsForSites } from "./simulationArea";

describe("simulationAreaBoundsForSites", () => {
  it("uses explicit single-site radius override when provided", () => {
    const bounds = simulationAreaBoundsForSites([{ position: { lat: 59.9, lon: 10.7 } }], {
      singleSiteRadiusKm: 60,
    });
    expect(bounds).not.toBeNull();
    expect((bounds?.latSpanDeg ?? 0) * 111.32).toBeGreaterThan(100);
  });

  it("keeps default behavior for multi-site selections", () => {
    const bounds = simulationAreaBoundsForSites(
      [
        { position: { lat: 59.9, lon: 10.7 } },
        { position: { lat: 60.0, lon: 10.8 } },
      ],
      { singleSiteRadiusKm: 100 },
    );
    expect(bounds).not.toBeNull();
    expect((bounds?.latSpanDeg ?? 0) * 111.32).toBeLessThan(70);
  });

  it("applies overlayRadiusKm buffer for multi-site selections", () => {
    const bounds = simulationAreaBoundsForSites(
      [
        { position: { lat: 59.9, lon: 10.7 } },
        { position: { lat: 60.0, lon: 10.8 } },
      ],
      { overlayRadiusKm: 100 },
    );
    expect(bounds).not.toBeNull();
    expect((bounds?.latSpanDeg ?? 0) * 111.32).toBeGreaterThan(200);
  });
});
