import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock, fromArrayBufferMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
  fromArrayBufferMock: vi.fn(),
}));

vi.mock("../../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  takeRateLimitToken: takeRateLimitTokenMock,
}));

vi.mock("geotiff", () => ({
  fromArrayBuffer: fromArrayBufferMock,
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
  vi.stubGlobal("fetch", vi.fn());
  getClientAddressMock.mockReturnValue("203.0.113.1");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 99, retryAfterSec: 0 });
  fromArrayBufferMock.mockResolvedValue({
    getImage: async () => ({
      getWidth: () => 2,
      getHeight: () => 2,
      getBoundingBox: () => [0, 0, 1, 1],
      getGDALNoData: () => null,
      readRasters: async () => new Int16Array([100, 100, 100, 100]),
    }),
  });
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses Copernicus terrain elevations and returns app-style summary", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response("Copernicus_DSM_COG_30_N00_00_E000_00_DEM\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), { status: 200 }));

    const req = new Request("https://linksim.link/api/v1/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(mkPayload()),
    });
    const res = await onRequestPost(mkCtx(req, { DB: {} }));

    expect(globalThis.fetch).toHaveBeenCalledWith("https://linksim.link/copernicus/30m/tileList.txt");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://linksim.link/copernicus/30m/Copernicus_DSM_COG_30_N00_00_E000_00_DEM/Copernicus_DSM_COG_30_N00_00_E000_00_DEM.tif",
    );

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
    expect(body.result.from_ground_elevation_m).toBe(100);
    expect(body.result.to_ground_elevation_m).toBe(100);
    expect(body.result.from_antenna_height_m).toBe(2);
    expect(body.result.to_antenna_height_m).toBe(2);
    expect(body.result.terrain_tiles_loaded).toEqual(["N00E000"]);
  });

  it("supports from_node/to_node aliases", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response("Copernicus_DSM_COG_30_N00_00_E000_00_DEM\n", { status: 200 }))
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), { status: 200 }));

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
    await expect(res.json()).resolves.toEqual({ error: "Site not found in nodes." });
  });
});
