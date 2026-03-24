import { describe, expect, it } from "vitest";
import { buildDeepLinkUrl, parseDeepLinkFromLocation, slugifyName } from "./deepLink";

describe("deepLink", () => {
  it("parses old v1 deep link payload and converts to v2", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/",
      search: "?dl=1&sim=sim-123&link=lnk-1&ov=passfail&lat=60.1&lon=9.2&z=11.5&b=0&p=0",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toMatchObject({
      version: 2,
      simulationId: "sim-123",
    });
  });

  it("rejects unsupported deep link versions", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/",
      search: "?dl=3&sim=sim-123",
    });
    expect(parsed).toEqual({ ok: false, reason: "invalid_version" });
  });

  it("returns missing_sim when deep-link params are absent", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/",
      search: "?foo=bar",
    });
    expect(parsed).toEqual({ ok: false, reason: "missing_sim" });
  });

  it("parses v2 path with just simulation", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/høgevarde",
      search: "?dl=2",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toBeUndefined();
    expect(parsed.payload.selectedLinkSlugs).toBeUndefined();
  });

  it("parses v2 path with single site", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/høgevarde/fyrisjøen",
      search: "?dl=2",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["fyrisjøen"]);
  });

  it("parses v2 path with multiple sites (multi-site selection)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/høgevarde/fyrisjøen+hoeg-router",
      search: "?dl=2",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["fyrisjøen", "hoeg-router"]);
  });

  it("parses v2 path with link (two sites in <>)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/høgevarde/fyrisjøen<>hoeg-router",
      search: "?dl=2",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("høgevarde");
    expect(parsed.payload.selectedLinkSlugs).toEqual(["fyrisjøen", "hoeg-router"]);
  });

  it("builds v2 URL with just simulation", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-999",
        simulationSlug: "høgevarde",
      },
      "https://linksim.pages.dev",
    );
    expect(url).toContain("dl=2");
    expect(url).toContain("sim=sim-999");
    expect(decodeURIComponent(new URL(url).pathname)).toBe("/høgevarde");
  });

  it("builds v2 URL with multiple selected sites", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-999",
        simulationSlug: "høgevarde",
        selectedSiteSlugs: ["fyrisjøen", "hoeg-router", "fagerlinattan"],
      },
      "https://linksim.pages.dev",
    );
    expect(decodeURIComponent(new URL(url).pathname)).toBe("/høgevarde/fyrisjøen+hoeg-router+fagerlinattan");
  });

  it("builds v2 URL with link selection", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-999",
        simulationSlug: "høgevarde",
        selectedLinkSlugs: ["fyrisjøen", "hoeg-router"],
      },
      "https://linksim.pages.dev",
    );
    expect(decodeURIComponent(new URL(url).pathname)).toBe("/høgevarde/fyrisjøen<>hoeg-router");
  });

  it("slugifies names preserving unicode and stripping delimiters", () => {
    expect(slugifyName(" NOR HØGEVARDE / test ")).toBe("nor-høgevarde-test");
    expect(slugifyName("site+name")).toBe("sitename");
    expect(slugifyName("site<>name")).toBe("sitename");
    expect(slugifyName("site/name")).toBe("sitename");
  });

  it("handles query-only old format with sim_slug", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/",
      search: "?dl=1&sim=sim-123&sim_slug=my-sim",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("my-sim");
    expect(parsed.payload.simulationId).toBe("sim-123");
  });
});
