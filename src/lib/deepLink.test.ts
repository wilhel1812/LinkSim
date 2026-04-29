import { describe, expect, it } from "vitest";
import {
  buildDeepLinkPathname,
  buildDeepLinkUrl,
  buildSettingsPath,
  canonicalizeDeepLinkKey,
  matchSettingsPath,
  parseDeepLinkFromLocation,
  slugifyName,
} from "./deepLink";

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

  it("parses v2 path with username and just simulation (no query params)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Owner/Høgevarde",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.username).toBe("Owner");
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toBeUndefined();
    expect(parsed.payload.selectedLinkSlugs).toBeUndefined();
  });

  it("parses v2 path with single site", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Owner/Høgevarde/Fyrisjøen",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.username).toBe("Owner");
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["Fyrisjøen"]);
  });

  it("parses v2 path with multiple sites (multi-site selection)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Owner/Høgevarde/Fyrisjøen+HOEG-ROUTER",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedSiteSlugs).toEqual(["Fyrisjøen", "HOEG-ROUTER"]);
  });

  it("parses v2 path with link (two sites in ~)", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Owner/Høgevarde/Fyrisjøen~HOEG-ROUTER",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.simulationSlug).toBe("Høgevarde");
    expect(parsed.payload.selectedLinkSlugs).toEqual(["Fyrisjøen", "HOEG-ROUTER"]);
  });

  it("parses legacy <> link delimiter", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Owner/Høgevarde/Fyrisjøen<>HOEG-ROUTER",
      search: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.selectedLinkSlugs).toEqual(["Fyrisjøen", "HOEG-ROUTER"]);
  });

  it("parses encoded unicode path with encoded <> delimiter", () => {
    const parsed = parseDeepLinkFromLocation({
      pathname: "/Owner/%F0%9F%92%A9/%F0%9F%8F%9D%EF%B8%8F%3C%3E%F0%9F%8C%8B",
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
        username: "Owner",
        simulationId: "sim-999",
        simulationSlug: "Høgevarde",
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/Owner/Høgevarde");
  });

  it("builds v2 URL with multiple selected sites", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        username: "Owner",
        simulationId: "sim-999",
        simulationSlug: "Høgevarde",
        selectedSiteSlugs: ["Fyrisjøen", "HOEG-ROUTER", "Fagerlinattan"],
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/Owner/Høgevarde/Fyrisjøen+HOEG-ROUTER+Fagerlinattan");
  });

  it("builds v2 URL with link selection", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        username: "Owner",
        simulationId: "sim-999",
        simulationSlug: "Høgevarde",
        selectedLinkSlugs: ["Fyrisjøen", "HOEG-ROUTER"],
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/Owner/Høgevarde/Fyrisjøen~HOEG-ROUTER");
  });

  it("builds and parses korean simulation/site paths", () => {
    const url = buildDeepLinkUrl(
      {
        version: 2,
        username: "사용자",
        simulationId: "sim-kor",
        simulationSlug: "한국조선",
        selectedSiteSlugs: ["남산-서울-타워", "평양텔레비죤탑"],
      },
      "https://linksim.pages.dev",
    );
    expect(url).toBe("https://linksim.pages.dev/사용자/한국조선/남산-서울-타워+평양텔레비죤탑");

    const parsed = parseDeepLinkFromLocation({ pathname: "/사용자/한국조선/남산-서울-타워+평양텔레비죤탑", search: "" });
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
    expect(slugifyName("🏝️")).toBe("🏝");
  });

  it("canonicalizes keys for matching existing normalized slugs", () => {
    expect(canonicalizeDeepLinkKey("Blefjell")).toBe("blefjell");
    expect(canonicalizeDeepLinkKey("Høgevarde")).toBe("høgevarde");
    expect(canonicalizeDeepLinkKey("%F0%9F%92%A9")).toBe("💩");
    expect(canonicalizeDeepLinkKey("🏝️")).toBe("🏝");
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

  it("builds pathname for simulation only", () => {
    const pathname = buildDeepLinkPathname("Owner", "Høgevarde");
    expect(pathname).toBe("/Owner/Høgevarde");
  });

  it("builds pathname with selected site slugs", () => {
    const pathname = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedSiteSlugs: ["Fyrisjøen", "HOEG-ROUTER"],
    });
    expect(pathname).toBe("/Owner/Høgevarde/Fyrisjøen+HOEG-ROUTER");
  });

  it("builds pathname with selected link slugs", () => {
    const pathname = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedLinkSlugs: ["Fyrisjøen", "HOEG-ROUTER"],
    });
    expect(pathname).toBe("/Owner/Høgevarde/Fyrisjøen~HOEG-ROUTER");
  });

  it("builds pathname ignoring link slugs when fewer or more than 2", () => {
    const pathnameOne = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedLinkSlugs: ["Fyrisjøen"],
    });
    expect(pathnameOne).toBe("/Owner/Høgevarde");

    const pathnameThree = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedLinkSlugs: ["A", "B", "C"],
    });
    expect(pathnameThree).toBe("/Owner/Høgevarde");
  });

  it("prefers link slugs over site slugs when both present with 2 links", () => {
    const pathname = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedLinkSlugs: ["Fyrisjøen", "HOEG-ROUTER"],
      selectedSiteSlugs: ["Fyrisjøen", "HOEG-ROUTER", "Extra"],
    });
    expect(pathname).toBe("/Owner/Høgevarde/Fyrisjøen~HOEG-ROUTER");
  });

  it("falls back to site slugs when link slugs not exactly 2", () => {
    const pathname = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedLinkSlugs: ["Fyrisjøen"],
      selectedSiteSlugs: ["Fyrisjøen", "HOEG-ROUTER"],
    });
    expect(pathname).toBe("/Owner/Høgevarde/Fyrisjøen+HOEG-ROUTER");
  });

  it("returns / for empty simulation slug", () => {
    const pathname = buildDeepLinkPathname("Owner", "");
    expect(pathname).toBe("/");

    const pathnameNull = buildDeepLinkPathname("", "Høgevarde");
    expect(pathnameNull).toBe("/");
  });

  it("strips delimiter characters from slugs", () => {
    const pathname = buildDeepLinkPathname("Owner+Name", "Test+Sim", {
      selectedSiteSlugs: ["Site~One", "Site+Two"],
    });
    expect(pathname).toBe("/OwnerName/TestSim/SiteOne+SiteTwo");
  });

  it("builds pathname with single site", () => {
    const pathname = buildDeepLinkPathname("Owner", "Høgevarde", {
      selectedSiteSlugs: ["Fyrisjøen"],
    });
    expect(pathname).toBe("/Owner/Høgevarde/Fyrisjøen");
  });

  it("builds pathname for unicode simulation and sites", () => {
    const pathname = buildDeepLinkPathname("사용자", "한국조선", {
      selectedSiteSlugs: ["남산-서울-타워", "평양텔레비죤탑"],
    });
    expect(pathname).toBe("/사용자/한국조선/남산-서울-타워+평양텔레비죤탑");
  });

  it("treats /settings as a reserved path head (no simulation parsed)", () => {
    const parsed = parseDeepLinkFromLocation({ pathname: "/settings", search: "" });
    expect(parsed).toEqual({ ok: false, reason: "missing_sim" });
  });

  it("treats /settings/profile as a reserved path head (no simulation parsed)", () => {
    const parsed = parseDeepLinkFromLocation({ pathname: "/settings/profile", search: "" });
    expect(parsed).toEqual({ ok: false, reason: "missing_sim" });
  });

  describe("matchSettingsPath", () => {
    it("returns null for unrelated paths", () => {
      expect(matchSettingsPath("/")).toBeNull();
      expect(matchSettingsPath("/Høgevarde")).toBeNull();
      expect(matchSettingsPath("/Høgevarde/site")).toBeNull();
    });

    it("matches /settings without a section", () => {
      expect(matchSettingsPath("/settings")).toEqual({ matched: true, section: null });
      expect(matchSettingsPath("/settings/")).toEqual({ matched: true, section: null });
    });

    it("matches /settings/<known-section>", () => {
      expect(matchSettingsPath("/settings/profile")).toEqual({ matched: true, section: "profile" });
      expect(matchSettingsPath("/settings/preferences")).toEqual({ matched: true, section: "preferences" });
      expect(matchSettingsPath("/settings/admin")).toEqual({ matched: true, section: "admin" });
    });

    it("matches /settings/<unknown-section> as settings with null section", () => {
      expect(matchSettingsPath("/settings/unknown")).toEqual({ matched: true, section: null });
    });

    it("is case-insensitive on the settings head", () => {
      expect(matchSettingsPath("/Settings")).toEqual({ matched: true, section: null });
      expect(matchSettingsPath("/SETTINGS/Profile")).toEqual({ matched: true, section: "profile" });
    });
  });

  describe("buildSettingsPath", () => {
    it("returns /settings without a section", () => {
      expect(buildSettingsPath()).toBe("/settings");
      expect(buildSettingsPath(null)).toBe("/settings");
    });

    it("returns /settings/<section> when provided", () => {
      expect(buildSettingsPath("profile")).toBe("/settings/profile");
      expect(buildSettingsPath("preferences")).toBe("/settings/preferences");
      expect(buildSettingsPath("admin")).toBe("/settings/admin");
    });
  });
});
