import { afterEach, expect, it, vi } from "vitest";
import { onRequest, parse868Nodes } from "./868-no";

const position = { lat: 60, lon: 10, alt: 123, precision_bits: 19, precision_known: true, observed_at: "2026-11-13T08:00:00Z" };
const node = { id: "!02EB8E7C", position, identity: { long_name: "Hill", short_name: "H", hw_model: "TBEAM", role: "ROUTER" } };

afterEach(() => vi.unstubAllGlobals());

it("normalizes a positioned node and skips invalid positions", () => {
  expect(parse868Nodes({ nodes: [node, { id: "!00000001", position: { ...position, lat: 91 } }] })).toEqual([{
    nodeId: "!02eb8e7c", lat: 60, lon: 10, altitudeM: 123, positionPrecisionBits: 19,
    updatedAt: Date.parse(position.observed_at), longName: "Hill", shortName: "H", hwModel: "TBEAM", role: "ROUTER",
  }]);
});

it("accepts an empty feed and rejects a malformed envelope or oversized list", () => {
  expect(parse868Nodes({ nodes: null })).toEqual([]);
  expect(parse868Nodes({ nodes: [] })).toEqual([]);
  expect(() => parse868Nodes({})).toThrow();
  expect(() => parse868Nodes({ nodes: Array(5001).fill(node) })).toThrow();
});

it("serves the normalized feed on the existing URL and does not cache upstream failures", async () => {
  const put = vi.fn();
  vi.stubGlobal("caches", { default: { match: vi.fn(), put } });
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ nodes: [node] })).mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const context = { request: new Request("https://linksim.link/node-sources/868-no", { headers: { "cf-connecting-ip": "192.0.2.83" } }), env: { PROXY_RATE_LIMIT_PER_MINUTE: "30" } } as Parameters<typeof onRequest>[0];
  const response = await onRequest(context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject([{ nodeId: "!02eb8e7c", lat: 60 }]);
  expect(fetch).toHaveBeenCalledWith("https://map.868.no/api/v1/nodes", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(put).toHaveBeenCalledTimes(1);
  expect((await onRequest(context)).status).toBe(502);
  expect(put).toHaveBeenCalledTimes(1);
});
