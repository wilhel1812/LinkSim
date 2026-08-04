import { getClientAddress, takeRateLimitToken } from "../_lib/rateLimit";
import type { Env } from "../_lib/types";

const UPSTREAM_URL = "https://map.868.no/events";
const CACHE_TTL_SEC = 300;
const SNAPSHOT_IDLE_MS = 1_000;
const SNAPSHOT_MAX_MS = 8_000;
const MAX_STREAM_BYTES = 5 * 1024 * 1024;

type MeshstellarNode = {
  nodeId: string;
  longName?: string;
  shortName?: string;
  lat: number;
  lon: number;
  altitudeM?: number;
  updatedAt?: number;
};

type MeshstellarFeature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    id?: unknown;
    display_name?: unknown;
    long_name?: unknown;
    updated_at?: unknown;
  };
};

const toStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const decodeHtmlAttribute = (value: string): string =>
  value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    const codePoint = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });

const canonicalNodeId = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("!") ? normalized : `!${normalized}`;
};

const nodeFromEventData = (data: string): MeshstellarNode | null => {
  const match = data.match(/\bdata-geojson="([^"]+)"/i);
  if (!match?.[1]) return null;
  try {
    const feature = JSON.parse(decodeHtmlAttribute(match[1])) as MeshstellarFeature;
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const id = toStringOrUndefined(feature.properties?.id);
    if (!id) return null;
    const altitude = Number(coordinates[2]);
    const updatedAtSec = Number(feature.properties?.updated_at);
    return {
      nodeId: canonicalNodeId(id),
      longName: toStringOrUndefined(feature.properties?.long_name),
      shortName: toStringOrUndefined(feature.properties?.display_name),
      lat,
      lon,
      altitudeM: Number.isFinite(altitude) ? altitude : undefined,
      updatedAt: Number.isFinite(updatedAtSec) && updatedAtSec > 0 ? updatedAtSec * 1000 : undefined,
    };
  } catch {
    return null;
  }
};

export const parseMeshstellarSnapshot = (payload: string): MeshstellarNode[] => {
  const nodes = new Map<string, MeshstellarNode>();
  const normalized = payload.replaceAll("\r\n", "\n");
  for (const block of normalized.split("\n\n")) {
    let eventType = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (eventType !== "update-node") continue;
    const node = nodeFromEventData(data.join("\n"));
    if (!node) continue;
    const current = nodes.get(node.nodeId);
    if (!current || (node.updatedAt ?? 0) >= (current.updatedAt ?? 0)) nodes.set(node.nodeId, node);
  }
  return Array.from(nodes.values()).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
};

export const readMeshstellarSnapshot = async (body: ReadableStream<Uint8Array>): Promise<MeshstellarNode[]> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let lastDataAt = startedAt;
  let payload = "";
  let bytesRead = 0;
  try {
    while (Date.now() - startedAt < SNAPSHOT_MAX_MS) {
      const waitMs = payload.includes("event: update-node")
        ? Math.max(1, SNAPSHOT_IDLE_MS - (Date.now() - lastDataAt))
        : Math.max(1, SNAPSHOT_MAX_MS - (Date.now() - startedAt));
      const outcome = await Promise.race([
        reader.read().then((result) => ({ type: "read" as const, result })),
        new Promise<{ type: "timeout" }>((resolve) => setTimeout(() => resolve({ type: "timeout" }), waitMs)),
      ]);
      if (outcome.type === "timeout") break;
      if (outcome.result.done) {
        payload += decoder.decode();
        break;
      }
      bytesRead += outcome.result.value.byteLength;
      if (bytesRead > MAX_STREAM_BYTES) throw new Error("Meshstellar snapshot exceeded the size limit");
      payload += decoder.decode(outcome.result.value, { stream: true });
      lastDataAt = Date.now();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const nodes = parseMeshstellarSnapshot(payload);
  if (!nodes.length) throw new Error("Meshstellar returned no positioned nodes");
  return nodes;
};

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
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
    limit: parsePerMinuteLimit(env.PROXY_RATE_LIMIT_PER_MINUTE, 30),
  });
  if (!limiter.allowed) {
    return new Response("Rate limit reached", {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(limiter.retryAfterSec) },
    });
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      headers: { accept: "text/event-stream" },
    });
    if (!upstream.ok || !upstream.body) throw new Error(`Meshstellar snapshot failed (${upstream.status})`);
    const nodes = await readMeshstellarSnapshot(upstream.body);
    const response = new Response(request.method === "HEAD" ? null : JSON.stringify(nodes), {
      status: 200,
      headers: {
        "cache-control": `public, max-age=60, s-maxage=${CACHE_TTL_SEC}`,
        "content-type": "application/json; charset=utf-8",
      },
    });
    await cache.put(cacheKey, new Response(JSON.stringify(nodes), response));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meshstellar snapshot failed";
    return new Response(message, { status: 502, headers: { "cache-control": "no-store" } });
  }
};
