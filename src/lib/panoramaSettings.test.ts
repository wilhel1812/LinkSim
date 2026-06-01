import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PANORAMA_SETTINGS,
  PANORAMA_SETTINGS_STORAGE_KEY,
  persistPanoramaSettings,
  readPanoramaSettings,
} from "./panoramaSettings";

describe("panoramaSettings", () => {
  it("returns defaults when no settings are stored", () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn().mockReturnValue(null) });

    expect(readPanoramaSettings()).toEqual(DEFAULT_PANORAMA_SETTINGS);

    vi.unstubAllGlobals();
  });

  it("reads stored settings and normalizes invalid values", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(JSON.stringify({
        exaggeration: 50,
        showLabels: false,
        terrainDistanceHeatmap: true,
      })),
    });

    expect(readPanoramaSettings()).toEqual({
      exaggeration: 20,
      showLabels: false,
      terrainDistanceHeatmap: true,
    });

    vi.unstubAllGlobals();
  });

  it("falls back per field for malformed stored settings and storage errors", () => {
    const getItem = vi.fn().mockReturnValue(JSON.stringify({
      exaggeration: "large",
      showLabels: "yes",
      terrainDistanceHeatmap: null,
    }));
    vi.stubGlobal("localStorage", { getItem });

    expect(readPanoramaSettings()).toEqual(DEFAULT_PANORAMA_SETTINGS);

    getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPanoramaSettings()).toEqual(DEFAULT_PANORAMA_SETTINGS);

    vi.unstubAllGlobals();
  });

  it("persists normalized settings with best-effort storage", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });

    persistPanoramaSettings({
      exaggeration: 0,
      showLabels: false,
      terrainDistanceHeatmap: true,
    });
    expect(setItem).toHaveBeenCalledWith(PANORAMA_SETTINGS_STORAGE_KEY, JSON.stringify({
      exaggeration: 1,
      showLabels: false,
      terrainDistanceHeatmap: true,
    }));

    setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => persistPanoramaSettings(DEFAULT_PANORAMA_SETTINGS)).not.toThrow();

    vi.unstubAllGlobals();
  });
});
