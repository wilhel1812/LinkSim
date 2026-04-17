import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASEMAP_STYLE_ID,
  getCartoFallbackStyle,
  getStylesForCategory,
  resolveBasemapSelection,
} from "./basemaps";

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
  it("street-positron resolves to dark-matter in dark mode", () => {
    const result = resolveBasemapSelection("street-positron", "dark", "blue");
    expect(result.styleId).toBe("street-positron");
    expect(result.style).toContain("dark-matter");
  });

  it("street-positron resolves to positron in light mode", () => {
    const result = resolveBasemapSelection("street-positron", "light", "blue");
    expect(result.style).toContain("positron");
    expect(result.style).not.toContain("dark");
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
    expect(result.isThemed).toBe(false);
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
  it("uses CARTO LinkSim themed style when provider fails", () => {
    const expected = resolveBasemapSelection("street-linksim", "light", "blue").style;
    const fallback = getCartoFallbackStyle("light", "blue");
    expect(fallback).toEqual(expected);
  });

  it("adapts fallback style to dark theme", () => {
    const darkFallback = getCartoFallbackStyle("dark", "blue");
    const darkStyle = darkFallback as { sources?: { cartoRaster?: { tiles?: string[] } } };
    const tiles = darkStyle.sources?.cartoRaster?.tiles ?? [];
    expect(tiles.some((tile) => tile.includes("dark_all"))).toBe(true);
  });
});
