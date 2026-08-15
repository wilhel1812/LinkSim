import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock, analyzeTerrainLinkMock, terrainJobsPostMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
  analyzeTerrainLinkMock: vi.fn(),
  terrainJobsPostMock: vi.fn(),
}));

vi.mock("../../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  parsePerMinuteLimit: (raw: string | undefined, fallback: number) => raw ? Number(raw) : fallback,
  takeRateLimitToken: takeRateLimitTokenMock,
}));

vi.mock("../../_lib/terrainAnalysis", () => ({
  analyzeTerrainLink: analyzeTerrainLinkMock,
}));

vi.mock("./calculate.jobs", () => ({
  queueTerrainCalculationJob: terrainJobsPostMock,
}));

import { onRequestPost } from "./calculate";

type TestEnv = {
  DB: unknown;
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE?: string;
};

const mkCtx = (request: Request, env: TestEnv) =>
  ({ request, env } as unknown as Parameters<typeof onRequestPost>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  getClientAddressMock.mockReturnValue("203.0.113.1");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 99, retryAfterSec: 0 });
  analyzeTerrainLinkMock.mockResolvedValue({
    distanceKm: 0.55,
    baselineFsplDb: 86.1,
    terrainPenaltyDb: 42.6,
    totalPathLossDb: 128.7,
    terrainObstructed: true,
    maxIntrusionM: 14,
    fresnelClearancePercent: -20,
    samplesUsed: 24,
    tilesFetched: ["N59E010:copernicus30"],
    fromGroundM: 21,
    toGroundM: 11,
  });
  terrainJobsPostMock.mockResolvedValue(
    new Response(
      JSON.stringify({ job_id: "calc_job_123", status: "queued", message: "Job queued." }),
      { status: 202, headers: { "content-type": "application/json" } },
    ),
  );
});

describe("api/v1/calculate", () => {
  const mkPayload = () => ({
    calculation: "link_budget",
    input: {
      from_site: "Site A",
      to_site: "Site B",
      frequency_mhz: 868,
      rx_target_dbm: -120,
      environment_loss_db: 0,
      nodes: [
        { name: "Site A", lat: 0.1, lon: 0.1 },
        { name: "Site B", lat: 0.9, lon: 0.9 },
      ],
    },
  });

  const bodyAtSize = (size: number): string => {
    const base = JSON.stringify({ ...mkPayload(), padding: "" });
    return `${base.slice(0, -2)}${"x".repeat(size - new TextEncoder().encode(base).byteLength)}"}`;
  };

  const bodyAtDepth = (depth: number): string => {
    let padding: unknown = 0;
    for (let level = 1; level < depth; level += 1) padding = [padding];
    return JSON.stringify({ ...mkPayload(), padding });
  };

  it("accepts exactly 64 KiB and rejects 64 KiB plus one with stable 413", async () => {
    const accepted = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", headers: { "content-type": "application/json" }, body: bodyAtSize(65_536),
    }), { DB: {} }));
    expect(accepted.status).toBe(200);
    const callsAfterAccepted = analyzeTerrainLinkMock.mock.calls.length;
    const rejected = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", headers: { "content-type": "application/json" }, body: bodyAtSize(65_537),
    }), { DB: {} }));
    expect(rejected.status).toBe(413);
    expect(analyzeTerrainLinkMock).toHaveBeenCalledTimes(callsAfterAccepted);
  });

  it("accepts depth 10, rejects depth 11 with stable 422, and ignores braces in strings", async () => {
    const acceptedDepth = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", headers: { "content-type": "application/json" }, body: bodyAtDepth(10),
    }), { DB: {} }));
    expect(acceptedDepth.status).toBe(200);
    const rejectedDepth = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", headers: { "content-type": "application/json" }, body: bodyAtDepth(11),
    }), { DB: {} }));
    expect(rejectedDepth.status).toBe(422);
    const braces = mkPayload(); braces.input.nodes[0].name = "A {{{{{{{{{{{"; braces.input.from_site = braces.input.nodes[0].name;
    const accepted = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(braces),
    }), { DB: {} }));
    expect(accepted.status).toBe(200);
  });

  it("preserves bounded JSON 422 status for malformed JSON and invalid UTF-8", async () => {
    for (const body of ["{", new Uint8Array([0xff])]) {
      const response = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", { method: "POST", body }), { DB: {} }));
      expect(response.status).toBe(422);
    }
  });

  it("returns 429 when edge proxy limiter denies request", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 9 });
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mkPayload()),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {}, CALC_API_PROXY_RATE_LIMIT_PER_MINUTE: "2" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    await expect(res.json()).resolves.toEqual({
      error: "Calculation API rate limit reached. Please wait and try again.",
    });
    expect(analyzeTerrainLinkMock).not.toHaveBeenCalled();
  });

  it("returns app-style summary with terrain-derived fields", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(mkPayload()),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      calculation: string;
      result: {
        summary: string;
        pass_fail_label: string;
        from_ground_elevation_m: number;
        to_ground_elevation_m: number;
        from_antenna_height_m: number;
        to_antenna_height_m: number;
        terrain_tiles_loaded: string[];
      };
    };

    expect(body.calculation).toBe("link_budget");
    expect(body.result.summary).toMatch(/LOS (clear|blocked) \+ (pass|fail) at .* \(.* dBm after env loss\)/);
    expect(body.result.pass_fail_label).toMatch(/^LOS (clear|blocked) \+ (pass|fail)$/);
    expect(body.result.from_ground_elevation_m).toBe(21);
    expect(body.result.to_ground_elevation_m).toBe(11);
    expect(body.result.from_antenna_height_m).toBe(2);
    expect(body.result.to_antenna_height_m).toBe(2);
    expect(body.result.terrain_tiles_loaded).toEqual(["N59E010:copernicus30"]);
  });

  it("accepts exactly 500 km and rejects above the synchronous distance ceiling", async () => {
    const payloadFor = (distanceKm: number) => {
      const value = mkPayload();
      value.input.nodes = [{ name: "Site A", lat: 0, lon: 0 }, { name: "Site B", lat: 0, lon: distanceKm / 6371 * 180 / Math.PI }];
      return value;
    };
    const exact = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", body: JSON.stringify(payloadFor(500)),
    }), { DB: {} }));
    expect(exact.status).toBe(200);
    const above = await onRequestPost(mkCtx(new Request("https://linksim.link/api/v1/calculate", {
      method: "POST", body: JSON.stringify(payloadFor(500.001)),
    }), { DB: {} }));
    expect(above.status).toBe(400);
  });

  it("supports from_node/to_node aliases", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        calculation: "link_budget",
        input: {
          from_node: "Site A",
          to_node: "Site B",
          frequency_mhz: 868,
          nodes: [
            { name: "Site A", lat: 0.1, lon: 0.1, antenna_height_m: 5 },
            { name: "Site B", lat: 0.9, lon: 0.9 },
          ],
        },
      }),
    });

    const res = await onRequestPost(mkCtx(req, { DB: {} }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { from_antenna_height_m: number } };
    expect(body.result.from_antenna_height_m).toBe(5);
  });

  it("applies optional directional patterns at both API endpoints", async () => {
    const baselineRequest = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mkPayload()),
    });
    const baselineResponse = await onRequestPost(mkCtx(baselineRequest, { DB: {} }));
    const baseline = (await baselineResponse.json()) as { result: { rx_dbm: number } };

    const directional = mkPayload();
    directional.input.nodes = directional.input.nodes.map((node, index) => ({
      ...node,
      antenna_mode: "directional",
      antenna_azimuth_deg: index === 0 ? 225 : 45,
      antenna_tilt_deg: 0,
      antenna_horizontal_beamwidth_deg: 30,
      antenna_vertical_beamwidth_deg: 30,
      antenna_max_attenuation_db: 20,
    }));
    const directionalRequest = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(directional),
    });
    const directionalResponse = await onRequestPost(mkCtx(directionalRequest, { DB: {} }));
    const result = (await directionalResponse.json()) as { result: { rx_dbm: number } };

    expect(baseline.result.rx_dbm - result.result.rx_dbm).toBeCloseTo(40, 5);
  });

  it("validates directional API field ranges", async () => {
    const payload = mkPayload();
    Object.assign(payload.input.nodes[0], { antenna_mode: "directional", antenna_tilt_deg: 91 });
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "nodes[0].antenna_tilt_deg must be between -90 and 90." });
  });

  it("rejects unknown antenna modes instead of silently using omnidirectional", async () => {
    const payload = mkPayload();
    Object.assign(payload.input.nodes[0], { antenna_mode: "directionl" });
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "nodes[0].antenna_mode must be omnidirectional or directional.",
    });
  });

  it("returns 404 when named sites are missing", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        calculation: "link_budget",
        input: {
          from_site: "Missing",
          to_site: "Site B",
          frequency_mhz: 868,
          nodes: [
            { name: "Site A", lat: 0.1, lon: 0.1 },
            { name: "Site B", lat: 0.9, lon: 0.9 },
          ],
        },
      }),
    });

    const res = await onRequestPost(mkCtx(req, { DB: {} }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Site not found: Missing" });
  });

  it("returns 503 for unavailable terrain tiles", async () => {
    analyzeTerrainLinkMock.mockRejectedValueOnce(new Error("No terrain tiles available for this region"));

    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mkPayload()),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Terrain tiles unavailable for this path. Please retry shortly or use /api/v1/calculate/jobs.",
    });
  });

  it("routes terrain mode requests through async jobs endpoint", async () => {
    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...mkPayload(),
        input: {
          ...mkPayload().input,
          mode: "terrain",
        },
      }),
    });

    const waitUntil = vi.fn();
    const res = await onRequestPost({ request: req, env: { DB: {} } as TestEnv, waitUntil } as Parameters<typeof onRequestPost>[0]);

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({ job_id: "calc_job_123", status: "queued" });
    expect(terrainJobsPostMock).toHaveBeenCalledTimes(1);
  });
});
