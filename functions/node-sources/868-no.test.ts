import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
}));

vi.mock("../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  parsePerMinuteLimit: (raw: string | undefined, fallback: number, blankFallback = fallback) =>
    raw === undefined || raw.trim() === "" ? blankFallback : Number(raw),
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
const mkCtx = (request: Request, routeEnv = env) => ({ request, env: routeEnv } as unknown as Parameters<typeof onRequest>[0]);

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
  it.each([
    [undefined, 1],
    ["", 1],
    ["   ", 1],
    ["17", 17],
  ])("preserves the deployed proxy limit for configured value %s", async (configured, expected) => {
    await onRequest(mkCtx(
      new Request("https://example.test/node-sources/868-no"),
      { DB: {}, PROXY_RATE_LIMIT_PER_MINUTE: configured } as unknown as typeof env,
    ));

    expect(takeRateLimitTokenMock).toHaveBeenCalledWith({
      key: "node-source:868-no:198.51.100.10",
      limit: expected,
    });
  });

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
    expect(takeRateLimitTokenMock).not.toHaveBeenCalled();
  });

  it("accepts 5,000 SSE events and rejects the 5,001st", async () => {
    const exact = Array.from({ length: 5_000 }, (_, index) => event(`<li><div data-geojson="${feature(String(index), index + 1)}"></div></li>`)).join("");
    await expect(readMeshstellarSnapshot(new Response(exact).body!)).resolves.toHaveLength(5_000);
    await expect(readMeshstellarSnapshot(new Response(exact + "event: statistics\ndata: overflow\n\n").body!)).rejects.toThrow("event limit");
    const unterminated = `event: update-node\ndata: <li><div data-geojson="${feature("overflow", 5_001)}"></div></li>`;
    await expect(readMeshstellarSnapshot(new Response(exact + unterminated).body!)).rejects.toThrow("event limit");
  });

  it("parses a normal final update-node record without a trailing delimiter", async () => {
    const unterminated = `event: update-node\ndata: <li><div data-geojson="${feature("final", 1)}"></div></li>`;
    await expect(readMeshstellarSnapshot(new Response(unterminated).body!)).resolves.toEqual([
      expect.objectContaining({ nodeId: "!final" }),
    ]);
  });

  it("accepts exactly 5 MiB and rejects the next streamed byte", async () => {
    const nodeEvent = event(`<li><div data-geojson="${feature("boundary", 1)}"></div></li>`);
    const exact = nodeEvent + `:${"x".repeat(5 * 1024 * 1024 - nodeEvent.length - 2)}\n`;
    await expect(readMeshstellarSnapshot(new Response(exact).body!)).resolves.toEqual([
      expect.objectContaining({ nodeId: "!boundary" }),
    ]);
    await expect(readMeshstellarSnapshot(new Response(`${exact}x`).body!)).rejects.toThrow("size limit");
  });

  it("frames CRLF events split into single-byte chunks without accumulating timers", async () => {
    const payload = [
      event(`<li><div data-geojson="${feature("first", 1)}"></div></li>`),
      event(`<li><div data-geojson="${feature("second", 2)}"></div></li>`),
    ].join("").replaceAll("\n", "\r\n");
    const bytes = new TextEncoder().encode(payload);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, ++offset));
      },
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(readMeshstellarSnapshot(stream)).resolves.toEqual([
      expect.objectContaining({ nodeId: "!first" }),
      expect.objectContaining({ nodeId: "!second" }),
    ]);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(bytes.length + 1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(setTimeoutSpy.mock.calls.length);
  });
});
