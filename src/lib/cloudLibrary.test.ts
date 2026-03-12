import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCloudLibrary, pushCloudLibrary } from "./cloudLibrary";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
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

    await expect(pushCloudLibrary({ siteLibrary: [], simulationPresets: [] })).rejects.toThrow(
      "Cannot publish/shared a simulation that references private library sites.",
    );
  });

  it("throws parsed API error for non-OK responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, statusText: "Forbidden" }),
    );

    await expect(fetchCloudLibrary()).rejects.toThrow("403 Forbidden: Forbidden");
  });
});
