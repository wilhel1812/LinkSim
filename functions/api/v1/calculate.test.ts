import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock, analyzeTerrainLinkMock, terrainJobsPostMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
  analyzeTerrainLinkMock: vi.fn(),
  terrainJobsPostMock: vi.fn(),
}));

vi.mock("../../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
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
