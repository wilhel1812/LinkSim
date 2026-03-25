import { describe, expect, it } from "vitest";
import { buildDeepLinkUrl, canonicalizeDeepLinkKey, parseDeepLinkFromLocation, slugifyName } from "./deepLink";

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

  it("parses v2 path with just simulation (no query params)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Høgevarde",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toBeUndefined();
    expect(parsed.payload.selectedLinkSlugs).toBeUndefined();
  });

  it("parses v2 path with single site", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Høgevarde/Fyrisjøen",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["Fyrisjøen"]);
  });

  it("parses v2 path with multiple sites (multi-site selection)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Høgevarde/Fyrisjøen+HOEG-ROUTER",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["Fyrisjøen", "HOEG-ROUTER"]);
  });

  it("parses v2 path with link (two sites in ~)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Høgevarde/Fyrisjøen~HOEG-ROUTER",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedLinkSlugs).toEqual(["Fyrisjøen", "HOEG-ROUTER"]);
  });

  it("parses legacy <> link delimiter", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Høgevarde/Fyrisjøen<>HOEG-ROUTER",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.selectedLinkSlugs).toEqual(["Fyrisjøen", "HOEG-ROUTER"]);
  });

  it("parses encoded unicode path with encoded <> delimiter", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/%F0%9F%92%A9/%F0%9F%8F%9D%EF%B8%8F%3C%3E%F0%9F%8C%8B",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("💩");
    expect(parsed.payload.selectedLinkSlugs).toEqual(["🏝️", "🌋"]);
  });

  it("builds v2 URL with just simulation (no query params)", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-999",
        simulationSlug: "Høgevarde",
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/Høgevarde");
  });

  it("builds v2 URL with multiple selected sites", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-999",
        simulationSlug: "Høgevarde",
        selectedSiteSlugs: ["Fyrisjøen", "HOEG-ROUTER", "Fagerlinattan"],
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/Høgevarde/Fyrisjøen+HOEG-ROUTER+Fagerlinattan");
  });

  it("builds v2 URL with link selection", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-999",
        simulationSlug: "Høgevarde",
        selectedLinkSlugs: ["Fyrisjøen", "HOEG-ROUTER"],
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/Høgevarde/Fyrisjøen~HOEG-ROUTER");
  });

  it("builds and parses korean simulation/site paths", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        simulationId: "sim-kor",
        simulationSlug: "한국조선",
        selectedSiteSlugs: ["남산-서울-타워", "평양텔레비죤탑"],
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/한국조선/남산-서울-타워+평양텔레비죤탑");

    const parsed = parseDeepLinkFromLocation({ pathname: "/한국조선/남산-서울-타워+평양텔레비죤탑", search: "" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("한국조선");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["남산-서울-타워", "평양텔레비죤탑"]);
  });

  it("slugifies names preserving unicode and case, stripping delimiters", () => {
    expect(slugifyName(" NOR HØGEVARDE / test ")).toBe("NOR-HØGEVARDE-test");
    expect(slugifyName("site+name")).toBe("sitename");
    expect(slugifyName("site<>name")).toBe("sitename");
    expect(slugifyName("site~name")).toBe("sitename");
    expect(slugifyName("site/name")).toBe("sitename");
    expect(slugifyName("🏝️")).toBe("🏝️");
  });

  it("canonicalizes keys for matching existing normalized slugs", () => {
    expect(canonicalizeDeepLinkKey("Blefjell")).toBe("blefjell");
    expect(canonicalizeDeepLinkKey("Høgevarde")).toBe("høgevarde");
    expect(canonicalizeDeepLinkKey("%F0%9F%92%A9")).toBe("💩");
    expect(canonicalizeDeepLinkKey("한국조선")).toBe("한국조선");
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
