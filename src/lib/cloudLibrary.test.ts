import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCloudLibrary, pushCloudLibrary } from "./cloudLibrary";

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
    expect(result).toEqual({ siteLibrary: [{ id: "s1" }], simulationPresets: [] });
  });

  it("throws conflict-specific error for private site reference conflicts", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, conflicts: ["simulation_private_site_reference"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      pushCloudLibrary({
        siteLibrary: [],
        simulationPresets: [{ id: "sim-1", name: "North Link" }],
      }),
    ).rejects.toThrow(
      "Cannot publish/shared simulation(s) with private Library Site references: North Link.",
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

  it("throws parsed API error for non-OK responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, statusText: "Forbidden" }),
    );

    await expect(fetchCloudLibrary()).rejects.toThrow("403 Forbidden: Forbidden");
  });
});
