import { describe, expect, it } from "vitest";
import {
  CARTO_KEY,
  DEFAULT_BASEMAP_STYLE_ID,
  getLocalFallbackStyle,
  getOpenFreeMapFallbackStyle,
  getStylesForCategory,
  nextBasemapFallbackStage,
  transformCartoRequest,
  resolveBasemapSelection,
} from "./basemaps";
import type { CustomBasemapSource } from "./basemapPreferences";

describe("resolveBasemapSelection — defaults and fallback", () => {
  it("resolves the default style without fallback", () => {
    const result = resolveBasemapSelection(DEFAULT_BASEMAP_STYLE_ID, "light", "blue");
    expect(result.styleId).toBe(DEFAULT_BASEMAP_STYLE_ID);
    expect(result.fallbackReason).toBeNull();
  });

  it("falls back to default for unknown styleId", () => {
    const result = resolveBasemapSelection("unknown-style-xyz", "light", "blue");
    expect(result.styleId).toBe(DEFAULT_BASEMAP_STYLE_ID);
    expect(result.fallbackReason).not.toBeNull();
  });
});

describe("custom basemap resolution", () => {
  const sources: CustomBasemapSource[] = [
    { id: "style", name: "My style", kind: "style", lightUrl: "https://maps.test/light.json", darkUrl: "https://maps.test/dark.json", attribution: "My data", attributionUrl: "https://maps.test/credits" },
    { id: "raster", name: "My raster", kind: "raster-xyz", lightUrl: "https://tiles.test/{z}/{x}/{y}.png", darkUrl: "https://tiles.test/{z}/{x}/{y}.png", attribution: "Raster data", maxZoom: 17, tileSize: 512 },
  ];

  it("resolves account sources with theme URL, attribution, and raster metadata", () => {
    expect(resolveBasemapSelection("custom:style", "dark", "blue", sources)).toMatchObject({ style: "https://maps.test/dark.json", attribution: "My data", provider: "custom" });
    const raster = resolveBasemapSelection("custom:raster", "light", "blue", sources);
    expect(raster.maxZoom).toBe(17);
    expect((raster.style as unknown as { sources: { customRaster: { tiles: string[]; tileSize: number } } }).sources.customRaster).toMatchObject({ tiles: ["https://tiles.test/{z}/{x}/{y}.png"], tileSize: 512 });
    expect(getStylesForCategory("custom", sources).map((entry) => entry.id)).toEqual(["custom:style", "custom:raster"]);
  });

  it("falls back without persisting when an account source was deleted elsewhere", () => {
    const result = resolveBasemapSelection("custom:missing", "light", "blue", sources);
    expect(result.styleId).toBe(DEFAULT_BASEMAP_STYLE_ID);
    expect(result.fallbackReason).toContain("Unknown basemap style");
  });
});

describe("CARTO availability", () => {
  it("keeps CARTO styles selectable only when the deployment shared key exists", () => {
    const carto = getStylesForCategory("street").find((entry) => entry.id === "street-positron");
    expect(carto).toMatchObject({ requiresKey: true, available: CARTO_KEY.length > 0, provider: "carto" });
  });
});

describe("npolar styles", () => {
  it.each(["topo-npolar", "photo-npolar-satellite", "photo-npolar-orthophoto"] as const)(
    "resolves %s without fallback",
    (styleId) => {
      const result = resolveBasemapSelection(styleId, "light", "blue");
      expect(result.styleId).toBe(styleId);
      expect(result.provider).toBe("npolar");
      expect(result.fallbackReason).toBeNull();
    },
  );
});

describe("MapTiler Topo dark auto-switch", () => {
  it("resolves to topo-v2 URL in light mode", () => {
    const result = resolveBasemapSelection("topo-topo", "light", "blue");
    // topo-topo requires MAPTILER key; if unavailable it falls back — either way check the provider type
    if (result.styleId === "topo-topo") {
      expect(result.style).toContain("topo-v2");
      expect(result.style).not.toContain("topo-v2-dark");
    }
  });

  it("resolves to topo-v2-dark URL in dark mode when available", () => {
    const result = resolveBasemapSelection("topo-topo", "dark", "blue");
    if (result.styleId === "topo-topo") {
      expect(result.style).toContain("topo-v2-dark");
    }
  });

  it("topo-topo is listed in topographic category", () => {
    const styles = getStylesForCategory("topographic");
    expect(styles.some((s) => s.id === "topo-topo")).toBe(true);
  });
});

describe("Street category dark auto-switch", () => {
  it("LinkSim pairs OpenFreeMap Positron light with Fiord dark", () => {
    expect(resolveBasemapSelection("street-linksim", "light", "blue").style).toContain("openfreemap.org/styles/positron");
    expect(resolveBasemapSelection("street-linksim", "dark", "blue").style).toContain("openfreemap.org/styles/fiord");
  });

  it("lists all five untinted OpenFreeMap styles", () => {
    const ids = getStylesForCategory("street").filter((entry) => entry.provider === "openfreemap").map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining(["street-ofm-positron", "street-ofm-bright", "street-ofm-liberty", "street-ofm-dark", "street-ofm-fiord"]));
  });
});

describe("Stadia Stamen Toner dark auto-switch", () => {
  it("artistic-toner resolves to stamen_toner in light mode", () => {
    const result = resolveBasemapSelection("artistic-toner", "light", "blue");
    expect(result.styleId).toBe("artistic-toner");
    expect(result.style).toContain("stamen_toner");
    expect(result.style).not.toContain("stamen_toner_dark");
  });

  it("artistic-toner resolves to stamen_toner_dark in dark mode", () => {
    const result = resolveBasemapSelection("artistic-toner", "dark", "blue");
    expect(result.style).toContain("stamen_toner_dark");
  });
});

describe("Themed styles", () => {
  it("street-linksim isThemed is true", () => {
    const result = resolveBasemapSelection("street-linksim", "light", "blue");
    expect(result.isThemed).toBe(true);
  });

  it("keeps blue Fiord unchanged and tints Fiord for other color themes", () => {
    expect(resolveBasemapSelection("street-linksim", "dark", "blue").isThemed).toBe(false);
    for (const colorTheme of ["pink", "red", "green", "neutral"] as const) {
      expect(resolveBasemapSelection("street-linksim", "dark", colorTheme).isThemed).toBe(true);
    }
  });

  it("terrain-outdoors isThemed is true", () => {
    const result = resolveBasemapSelection("terrain-outdoors", "light", "blue");
    expect(result.isThemed).toBe(true);
  });

  it("topo-topo isThemed is true when available", () => {
    const result = resolveBasemapSelection("topo-topo", "light", "blue");
    // If topo-topo is available (MAPTILER key present), isThemed should be true.
    // If it fell back to street-linksim, isThemed is also true.
    expect(result.isThemed).toBe(true);
  });

  it("street-positron isThemed is false", () => {
    const result = resolveBasemapSelection("street-positron", "light", "blue");
    if (result.styleId === "street-positron") expect(result.isThemed).toBe(false);
    else expect(result.fallbackReason).toContain("API key");
  });
});

describe("getStylesForCategory", () => {
  it("street category contains street-linksim as first entry", () => {
    const styles = getStylesForCategory("street");
    expect(styles[0].id).toBe("street-linksim");
  });

  it("terrain category contains terrain-outdoors", () => {
    const styles = getStylesForCategory("terrain");
    expect(styles.some((s) => s.id === "terrain-outdoors")).toBe(true);
  });

  it("topographic category has global entries before regional entries", () => {
    const styles = getStylesForCategory("topographic");
    const globalIdx = styles.findIndex((s) => !s.regional);
    const regionalIdx = styles.findIndex((s) => s.regional);
    if (globalIdx !== -1 && regionalIdx !== -1) {
      expect(globalIdx).toBeLessThan(regionalIdx);
    }
  });

  it("regional category returns 4 regional entries", () => {
    const styles = getStylesForCategory("regional");
    expect(styles).toHaveLength(4);
    expect(styles.every((s) => s.regional !== undefined)).toBe(true);
  });

  it("regional category lists Kartverket before NPolar entries", () => {
    const styles = getStylesForCategory("regional");
    const kartverketIdx = styles.findIndex((s) => s.id === "topo-kartverket");
    const npolarIdx = styles.findIndex((s) => s.id === "topo-npolar");
    expect(kartverketIdx).toBeLessThan(npolarIdx);
  });

  it("artistic category contains artistic-toner and artistic-watercolor", () => {
    const styles = getStylesForCategory("artistic");
    expect(styles.some((s) => s.id === "artistic-toner")).toBe(true);
    expect(styles.some((s) => s.id === "artistic-watercolor")).toBe(true);
  });
});

describe("basemap fallback style", () => {
  it("uses OpenFreeMap LinkSim when a provider fails", () => {
    const expected = resolveBasemapSelection("street-linksim", "light", "blue").style;
    const fallback = getOpenFreeMapFallbackStyle("light", "blue");
    expect(fallback).toEqual(expected);
  });

  it("has a provider-independent local fallback", () => {
    const fallback = getLocalFallbackStyle("dark", "blue");
    expect(fallback.sources).toEqual({});
    expect(fallback.layers[0]).toMatchObject({ type: "background" });
  });

  it("only adds the shared CARTO key to CARTO basemap hosts", () => {
    expect(transformCartoRequest("https://a.basemaps.cartocdn.com/light_all/1/1/1.png", "abc").url).toContain("key=abc");
    expect(transformCartoRequest("https://custom.test/style.json?x=1", "abc").url).toBe("https://custom.test/style.json?x=1");
  });

  it("advances selected source to OpenFreeMap and then the local background", () => {
    expect(nextBasemapFallbackStage("selected", "street-maptiler")).toBe("openfreemap");
    expect(nextBasemapFallbackStage("openfreemap", "street-maptiler")).toBe("local");
    expect(nextBasemapFallbackStage("selected", DEFAULT_BASEMAP_STYLE_ID)).toBe("local");
    expect(nextBasemapFallbackStage("local", "street-maptiler")).toBe("local");
  });
});
