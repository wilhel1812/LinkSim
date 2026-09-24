import { beforeEach, describe, expect, it, vi } from "vitest";

const maplibre = vi.hoisted(() => ({
  setWorkerUrl: vi.fn(),
}));

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: maplibre.setWorkerUrl,
}));

vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({
  default: "/assets/maplibre-worker.js",
}));

describe("configureMapLibreWorker", () => {
  beforeEach(() => {
    maplibre.setWorkerUrl.mockClear();
  });

  it("configures MapLibre's bundled vector-tile worker once", async () => {
    const { configureMapLibreWorker } = await import("./maplibreWorker");

    configureMapLibreWorker();
    configureMapLibreWorker();

    expect(maplibre.setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(maplibre.setWorkerUrl).toHaveBeenCalledWith("/assets/maplibre-worker.js");
  });
});
