import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
}));

vi.mock("../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  takeRateLimitToken: takeRateLimitTokenMock,
}));

import { onRequest, parseMeshstellarSnapshot, readMeshstellarSnapshot } from "./868-no";

const feature = (id: string, updatedAt: number, lat = 60.1, lon = 10.2) =>
  JSON.stringify({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat, 123] },
    properties: { id, display_name: `S-${id}`, long_name: `Node ${id}`, updated_at: updatedAt },
  }).replaceAll('"', "&quot;");

const event = (html: string) => `event: update-node\ndata: ${html}\n\n`;

const env = { DB: {}, PROXY_RATE_LIMIT_PER_MINUTE: "120" } as unknown as {
  DB: D1Database;
  PROXY_RATE_LIMIT_PER_MINUTE?: string;
};

const cacheMatch = vi.fn();
const cachePut = vi.fn();
const mkCtx = (request: Request) => ({ request, env } as unknown as Parameters<typeof onRequest>[0]);

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.stubGlobal("caches", { default: { match: cacheMatch, put: cachePut } });
  vi.stubGlobal("fetch", vi.fn());
  cacheMatch.mockResolvedValue(undefined);
  cachePut.mockResolvedValue(undefined);
  getClientAddressMock.mockReturnValue("198.51.100.10");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 29, retryAfterSec: 0 });
});

describe("868.no Meshstellar snapshot", () => {
  it("extracts positioned nodes, decodes attributes, and keeps the newest duplicate", () => {
    const payload = [
      event(`<li><div data-geojson="${feature("abc123", 1_800_000_000)}"></div></li>`),
      event(`<li><div data-geojson="${feature("abc123", 1_800_000_200, 61.2, 11.3)}"></div></li>`),
      event("<li><span>Node without a position</span></li>"),
      "event: statistics\ndata: ignored\n\n",
    ].join("");

    expect(parseMeshstellarSnapshot(payload)).toEqual([
      {
        altitudeM: 123,
        lat: 61.2,
        lon: 11.3,
        longName: "Node abc123",
        nodeId: "!abc123",
        shortName: "S-abc123",
        updatedAt: 1_800_000_200_000,
      },
    ]);
  });

  it("returns and caches a normalized on-demand snapshot", async () => {
    const payload = event(`<li><div data-geojson="${feature("abc123", 1_800_000_200)}"></div></li>`);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const response = await onRequest(mkCtx(new Request("https://example.test/node-sources/868-no")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({ nodeId: "!abc123", lat: 60.1, lon: 10.2 }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://map.868.no/events",
      expect.objectContaining({ headers: { accept: "text/event-stream" } }),
    );
    expect(cachePut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("closes an open stream after the initial node burst becomes idle", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(event(`<li><div data-geojson="${feature("abc123", 1_800_000_200)}"></div></li>`)));
      },
      cancel() {
        canceled = true;
      },
    });

    const snapshot = readMeshstellarSnapshot(stream);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(snapshot).resolves.toEqual([
      expect.objectContaining({ nodeId: "!abc123" }),
    ]);
    expect(canceled).toBe(true);
  });

  it("uses the cached snapshot without opening a new SSE connection", async () => {
    cacheMatch.mockResolvedValueOnce(new Response("[]", { status: 200 }));

    const response = await onRequest(mkCtx(new Request("https://example.test/node-sources/868-no")));

    expect(response.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
