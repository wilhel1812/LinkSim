import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCloudSite,
  deleteCloudSimulation,
  fetchCloudLibrary,
  pushCloudLibrary,
  restoreCloudSimulation,
} from "./cloudLibrary";
import { LIBRARY_BATCH_MAX_RECORDS, LIBRARY_REQUEST_MAX_BYTES } from "./libraryLimits";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("fetchCloudLibrary delta sync", () => {
  it("calls /api/library with no query params by default", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ siteLibrary: [], simulationPresets: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await fetchCloudLibrary();
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/library");
  });

  it("appends ?since= when since option is provided", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ siteLibrary: [], simulationPresets: [], isDelta: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await fetchCloudLibrary({ since: "2026-01-01T00:00:00.000Z" });
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(decodeURIComponent(String(url))).toContain("since=2026-01-01T00:00:00.000Z");
  });

  it("returns isDelta: true when server responds with isDelta", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ siteLibrary: [], simulationPresets: [], isDelta: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await fetchCloudLibrary({ since: "2026-01-01T00:00:00.000Z" });
    expect(result.isDelta).toBe(true);
  });

  it("returns isDelta: false/undefined for full fetch", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ siteLibrary: [], simulationPresets: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await fetchCloudLibrary();
    expect(result.isDelta).toBeFalsy();
  });

  it("drains cursor pages, runs one recovery delta, and returns only the completed recovery cutoff", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [{ id: "site-1" }],
        simulationPresets: [],
        deletedSiteIds: [],
        deletedSimulationIds: [],
        syncCutoff: "2026-08-14T10:00:00.000Z",
        nextCursor: "base-page-2",
        isDelta: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [],
        simulationPresets: [{ id: "sim-1" }],
        deletedSiteIds: [],
        deletedSimulationIds: [],
        syncCutoff: "2026-08-14T10:00:00.000Z",
        isDelta: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [{ id: "site-1", name: "Updated" }],
        simulationPresets: [],
        deletedSiteIds: [],
        deletedSimulationIds: ["sim-1"],
        syncCutoff: "2026-08-14T10:00:01.000Z",
        isDelta: true,
      }), { status: 200 }));

    await expect(fetchCloudLibrary()).resolves.toEqual({
      siteLibrary: [{ id: "site-1", name: "Updated" }],
      simulationPresets: [],
      deletedSiteIds: [],
      deletedSimulationIds: ["sim-1"],
      isDelta: false,
      syncCutoff: "2026-08-14T10:00:01.000Z",
    });
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => decodeURIComponent(String(url)))).toEqual([
      "/api/library",
      "/api/library?cursor=base-page-2",
      "/api/library?since=2026-08-14T10:00:00.000Z",
    ]);
  });

  it("rejects a failed later page without returning a checkpoint", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [], simulationPresets: [], syncCutoff: "2026-08-14T10:00:00.000Z", nextCursor: "next",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unavailable" }), { status: 503, statusText: "Unavailable" }));

    await expect(fetchCloudLibrary()).rejects.toThrow("503 Unavailable: Unavailable");
  });

  it("lets an active recovery record override a deletion from the base window", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [], simulationPresets: [], deletedSimulationIds: ["sim-1"],
        syncCutoff: "2026-08-14T10:00:00.000Z",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        siteLibrary: [], simulationPresets: [{ id: "sim-1", status: "active" }], deletedSimulationIds: [],
        syncCutoff: "2026-08-14T10:00:01.000Z", isDelta: true,
      }), { status: 200 }));

    await expect(fetchCloudLibrary()).resolves.toMatchObject({
      simulationPresets: [{ id: "sim-1", status: "active" }],
      deletedSimulationIds: [],
      syncCutoff: "2026-08-14T10:00:01.000Z",
    });
  });
});

describe("cloudLibrary client", () => {
  it("returns normalized arrays from API payload", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ siteLibrary: [{ id: "s1" }], simulationPresets: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await fetchCloudLibrary();
    expect(result).toEqual({
      siteLibrary: [{ id: "s1" }],
      simulationPresets: [],
      deletedSiteIds: [],
      deletedSimulationIds: [],
    });
  });

  it("normalizes deletion tombstones from Library responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({
        siteLibrary: [],
        simulationPresets: [],
        deletedSiteIds: ["site-1", null],
        deletedSimulationIds: ["sim-1", 42],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchCloudLibrary()).resolves.toMatchObject({
      deletedSiteIds: ["site-1"],
      deletedSimulationIds: ["sim-1"],
    });
  });

  it("uses dedicated lifecycle requests for Site delete and Simulation delete/restore", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, siteId: "site-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, simulationId: "sim-1", status: "deleted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, simulationId: "sim-1", status: "active" }), { status: 200 }));

    await deleteCloudSite("site-1");
    await deleteCloudSimulation("sim-1");
    await restoreCloudSimulation("sim-1");

    expect(vi.mocked(globalThis.fetch)).toHaveBeenNthCalledWith(
      1,
      "/api/library/sites/site-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(vi.mocked(globalThis.fetch)).toHaveBeenNthCalledWith(
      2,
      "/api/library/simulations/sim-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(vi.mocked(globalThis.fetch)).toHaveBeenNthCalledWith(
      3,
      "/api/library/simulations/sim-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    );
  });

  it("includes simulation names for simulation_name_taken conflicts", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, conflicts: ["simulation_name_taken"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      pushCloudLibrary({
        siteLibrary: [],
        simulationPresets: [{ id: "sim-2", name: "Relay Plan" }],
      }),
    ).rejects.toThrow("Simulation name already exists: Relay Plan. Use unique Simulation names.");
  });

  it("pushes large payloads sequentially in bounded mixed-resource batches", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, conflicts: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    const payload = {
      siteLibrary: Array.from({ length: 25 }, (_, index) => ({ id: `site-${index}`, name: `Site ${index}` })),
      simulationPresets: Array.from({ length: 18 }, (_, index) => ({ id: `sim-${index}`, name: `Simulation ${index}` })),
    };

    await pushCloudLibrary(payload);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
    const batches = vi.mocked(globalThis.fetch).mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as { siteLibrary: unknown[]; simulationPresets: unknown[] });
    expect(batches.map((batch) => batch.siteLibrary.length + batch.simulationPresets.length)).toEqual([
      LIBRARY_BATCH_MAX_RECORDS,
      LIBRARY_BATCH_MAX_RECORDS,
      3,
    ]);
    expect(batches.flatMap((batch) => batch.siteLibrary)).toHaveLength(25);
    expect(batches.flatMap((batch) => batch.simulationPresets)).toHaveLength(18);
  });

  it("also chunks by encoded request bytes when records are individually valid but collectively large", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, conflicts: [] }), { status: 200 }));
    const padding = "x".repeat(250 * 1024);

    await pushCloudLibrary({
      siteLibrary: [],
      simulationPresets: Array.from({ length: 10 }, (_, index) => ({ id: `sim-${index}`, name: `Simulation ${index}`, padding })),
    });

    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(1);
    for (const [, init] of vi.mocked(globalThis.fetch).mock.calls) {
      expect(new TextEncoder().encode(String(init?.body)).byteLength).toBeLessThanOrEqual(LIBRARY_REQUEST_MAX_BYTES);
    }
  });

  it("stops at a rejected chunk so appStore can retain the full dirty set for retry", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, conflicts: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Library quota exceeded." }), {
        status: 422,
        statusText: "Unprocessable Content",
      }));

    await expect(pushCloudLibrary({
      siteLibrary: Array.from({ length: LIBRARY_BATCH_MAX_RECORDS + 1 }, (_, index) => ({
        id: `site-${index}`,
        name: `Site ${index}`,
      })),
      simulationPresets: [],
    })).rejects.toThrow("Library quota exceeded");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it("stops before later chunks when a batch returns HTTP-200 conflicts", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, conflicts: ["site_quota_exceeded"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, conflicts: [] }), { status: 200 }));

    await expect(pushCloudLibrary({
      siteLibrary: Array.from({ length: LIBRARY_BATCH_MAX_RECORDS + 1 }, (_, index) => ({
        id: `site-${index}`,
        name: `Site ${index}`,
      })),
      simulationPresets: [],
    })).rejects.toThrow("site_quota_exceeded");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized non-first record before emitting any batch", async () => {
    await expect(pushCloudLibrary({
      siteLibrary: [{ id: "site-small", name: "Small" }, { id: "site-large", name: "Large", padding: "x".repeat(LIBRARY_REQUEST_MAX_BYTES) }],
      simulationPresets: [],
    })).rejects.toThrow("cannot fit");
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("throws parsed API error for non-OK responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, statusText: "Forbidden" }),
    );

    await expect(fetchCloudLibrary()).rejects.toThrow("403 Forbidden: Forbidden");
  });
});
