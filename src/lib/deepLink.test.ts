import { describe, expect, it } from "vitest";
import { buildDeepLinkUrl, parseDeepLinkFromLocation } from "./deepLink";

describe("deepLink", () => {
  it("parses a complete deep link payload", () => {
    const parsed = parseDeepLinkFromLocation({
      search: "?dl=1&sim=sim-123&link=lnk-1&ov=passfail&lat=60.1&lon=9.2&z=11.5&b=0&p=0",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toMatchObject({
      version: 1,
      simulationId: "sim-123",
      selectedLinkId: "lnk-1",
      overlayMode: "passfail",
      mapViewport: { lat: 60.1, lon: 9.2, zoom: 11.5, bearing: 0, pitch: 0 },
    });
  });

  it("rejects unsupported deep link versions", () => {
    const parsed = parseDeepLinkFromLocation({
      search: "?dl=2&sim=sim-123",
    });
    expect(parsed).toEqual({ ok: false, reason: "invalid_version" });
  });

  it("returns missing_sim when deep-link params are absent", () => {
    const parsed = parseDeepLinkFromLocation({
      search: "?foo=bar",
    });
    expect(parsed).toEqual({ ok: false, reason: "missing_sim" });
  });

  it("builds readable query params", () => {
    const url = buildDeepLinkUrl(
      {
        version: 1,
        simulationId: "sim-999",
        selectedLinkId: "lnk-9",
        overlayMode: "relay",
        mapViewport: {
          lat: 60.1234567,
          lon: 9.9876543,
          zoom: 10.1234,
        },
      },
      "https://linksim.pages.dev",
    );
    expect(url).toContain("dl=1");
    expect(url).toContain("sim=sim-999");
    expect(url).toContain("link=lnk-9");
    expect(url).toContain("ov=relay");
    expect(url).toContain("lat=60.123457");
    expect(url).toContain("lon=9.987654");
    expect(url).toContain("z=10.12");
  });
});
