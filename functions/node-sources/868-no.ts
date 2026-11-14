import { getClientAddress, parsePerMinuteLimit, takeRateLimitToken } from "../_lib/rateLimit";
import type { Env } from "../_lib/types";
import type { MeshmapNode } from "../../src/lib/meshtasticMqtt";
import { readBoundedJsonResponse } from "../../src/lib/nodeFeedLimits";

const UPSTREAM_URL = "https://map.868.no/api/v1/nodes";
const CACHE_TTL_SEC = 300;
const MAX_NODES = 5_000;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() || undefined : undefined;

export const parse868Nodes = (payload: unknown): MeshmapNode[] => {
  const entries = record(payload)?.nodes;
  if (entries === null) return [];
  if (!Array.isArray(entries) || entries.length > MAX_NODES) {
    throw new Error("Invalid 868.no node list");
  }
  const nodes = new Map<string, MeshmapNode>();
  for (const entry of entries) {
    const raw = record(entry);
    const id = optionalString(raw?.id);
    const position = record(raw?.position);
    const lat = position?.lat;
    const lon = position?.lon;
    if (!id || !/^![0-9a-f]{8}$/i.test(id) ||
        typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
        typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) continue;

    const identity = record(raw?.identity);
    const altitude = position?.alt;
    const precision = position?.precision_bits;
    const observedAt = Date.parse(optionalString(position?.observed_at) ?? "");
    const nodeId = id.toLowerCase();
    const node: MeshmapNode = {
      nodeId, lat, lon,
      longName: optionalString(identity?.long_name),
      shortName: optionalString(identity?.short_name),
      hwModel: optionalString(identity?.hw_model),
      role: optionalString(identity?.role),
      altitudeM: typeof altitude === "number" && Number.isFinite(altitude) ? altitude : undefined,
      positionPrecisionBits: position?.precision_known === true && typeof precision === "number" &&
        Number.isInteger(precision) && precision >= 1 && precision <= 32 ? precision : undefined,
      updatedAt: Number.isFinite(observedAt) ? observedAt : undefined,
    };
    if ((nodes.get(nodeId)?.updatedAt ?? 0) <= (node.updatedAt ?? 0)) nodes.set(nodeId, node);
  }
  return [...nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { "cache-control": "no-store" } });
  }

  const cacheKey = new Request(new URL(request.url).origin + "/node-sources/868-no", { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;

  const limiter = takeRateLimitToken({
    key: `node-source:868-no:${getClientAddress(request)}`,
    limit: parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 30, 1),
  });
  if (!limiter.allowed) {
    return new Response("Rate limit reached", {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(limiter.retryAfterSec) },
    });
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new Error("868.no request failed");
    }
    const { value } = await readBoundedJsonResponse<unknown>(upstream, {
      maxBytes: 5 * 1024 * 1024, maxRecords: MAX_NODES, maxDepth: 5,
    });
    const nodes = parse868Nodes(value);
    const response = new Response(request.method === "HEAD" ? null : JSON.stringify(nodes), {
      status: 200,
      headers: {
        "cache-control": `public, max-age=60, s-maxage=${CACHE_TTL_SEC}`,
        "content-type": "application/json; charset=utf-8",
      },
    });
    await cache.put(cacheKey, new Response(JSON.stringify(nodes), response));
    return response;
  } catch {
    return new Response("Could not load 868.no nodes. Try again shortly.", { status: 502, headers: { "cache-control": "no-store" } });
  }
};
