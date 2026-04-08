import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const mock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", mock);
  vi.stubGlobal("window", {
    localStorage: mock,
    setTimeout,
    clearTimeout,
  });
  return { mock };
});

vi.mock("../lib/coverage", () => ({
  buildCoverage: vi.fn(() => []),
}));

vi.mock("../lib/elevationService", () => ({
  fetchElevations: vi.fn(async () => [123]),
}));

describe("appStore basemap changes", () => {
  beforeEach(() => {
    storage.mock.clear();
    vi.resetModules();
  });

  it("does not trigger simulation recompute when basemap provider/style changes", async () => {
    const recomputeCoverage = vi.fn();
    vi.doMock("./coverageStore", () => ({
      useCoverageStore: {
        getState: () => ({ recomputeCoverage }),
      },
      setAppStoreBridge: vi.fn(),
    }));

    const { useAppStore } = await import("./appStore");
    const state = useAppStore.getState();
    state.setBasemapProvider("carto");
    state.setBasemapStylePreset("normal");

    expect(recomputeCoverage).not.toHaveBeenCalled();
  });
});
