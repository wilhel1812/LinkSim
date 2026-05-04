import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const ZERO_RECT = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
};

describe("mapEditor store slice", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let useAppStore: any;

  beforeEach(async () => {
    storage.mock.clear();
    vi.resetModules();
    ({ useAppStore } = await import("./appStore"));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes mapEditor as null", () => {
    const state = useAppStore.getState();
    expect(state.mapEditor).toBeNull();
  });

  it("openMapEditor sets the editor state", () => {
    const payload = {
      kind: "site" as const,
      resourceId: "site-abc",
      isNew: false,
      label: "Test Site",
      anchorRect: { top: 100, right: 200, bottom: 120, left: 160, width: 40, height: 20 },
    };
    useAppStore.getState().openMapEditor(payload);
    expect(useAppStore.getState().mapEditor).toEqual(payload);
  });

  it("openMapEditor works for isNew=true with null resourceId", () => {
    const payload = {
      kind: "site" as const,
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: ZERO_RECT,
    };
    useAppStore.getState().openMapEditor(payload);
    expect(useAppStore.getState().mapEditor).toEqual(payload);
  });

  it("openMapEditor stores seeded new site payloads", () => {
    const payload = {
      kind: "site" as const,
      resourceId: null,
      isNew: true,
      label: "New Site",
      anchorRect: ZERO_RECT,
      siteSeed: {
        lat: 60.123,
        lon: 10.456,
        name: "MQTT Hill",
        insertIntoSimulation: true,
        sourceMeta: {
          sourceType: "mqtt-feed",
          sourceUrl: "/meshmap/nodes.json",
          nodeId: "node-1",
        },
      },
    };
    useAppStore.getState().openMapEditor(payload);
    expect(useAppStore.getState().mapEditor).toEqual(payload);
  });

  it("openMapEditor works for kind=link", () => {
    const payload = {
      kind: "link" as const,
      resourceId: "link-xyz",
      isNew: false,
      label: "Link A–B",
      anchorRect: ZERO_RECT,
    };
    useAppStore.getState().openMapEditor(payload);
    expect(useAppStore.getState().mapEditor?.kind).toBe("link");
    expect(useAppStore.getState().mapEditor?.resourceId).toBe("link-xyz");
  });

  it("openMapEditor works for kind=simulation", () => {
    const payload = {
      kind: "simulation" as const,
      resourceId: "sim-1",
      isNew: false,
      label: "My Sim",
      anchorRect: ZERO_RECT,
    };
    useAppStore.getState().openMapEditor(payload);
    expect(useAppStore.getState().mapEditor?.kind).toBe("simulation");
  });

  it("openMapEditor stores seeded new simulation payloads", () => {
    const payload = {
      kind: "simulation" as const,
      resourceId: null,
      isNew: true,
      label: "New Simulation",
      anchorRect: ZERO_RECT,
      simulationSeed: {
        frequencyPresetId: "eu-868",
        autoPropagationEnvironment: false,
      },
    };
    useAppStore.getState().openMapEditor(payload);
    expect(useAppStore.getState().mapEditor).toEqual(payload);
  });

  it("closeMapEditor clears state to null", () => {
    useAppStore.getState().openMapEditor({
      kind: "site" as const,
      resourceId: "s1",
      isNew: false,
      label: "Site",
      anchorRect: ZERO_RECT,
    });
    useAppStore.getState().setMapEditorSiteDraft({ lat: 1, lon: 2, groundElevationM: 3 });
    expect(useAppStore.getState().mapEditor).not.toBeNull();
    useAppStore.getState().closeMapEditor();
    expect(useAppStore.getState().mapEditor).toBeNull();
    expect(useAppStore.getState().mapEditorSiteDraft).toBeNull();
  });

  it("setMapEditorSiteDraft stores active site editor position", () => {
    useAppStore.getState().setMapEditorSiteDraft({ lat: 60.1, lon: 10.2, groundElevationM: 123 });
    expect(useAppStore.getState().mapEditorSiteDraft).toEqual({ lat: 60.1, lon: 10.2, groundElevationM: 123 });
  });

  it("closeMapEditor is a no-op when already null", () => {
    expect(useAppStore.getState().mapEditor).toBeNull();
    expect(() => useAppStore.getState().closeMapEditor()).not.toThrow();
    expect(useAppStore.getState().mapEditor).toBeNull();
  });
});
