export type MeshmapNode = {
  nodeId: string;
  longName?: string;
  shortName?: string;
  hwModel?: string;
  role?: string;
  lat: number;
  lon: number;
  altitudeM?: number;
  positionPrecisionBits?: number;
  updatedAt?: number;
  sourceId?: NodeFeedSourceId;
  sourceUrl?: string;
};

export type NodeFeedSourceId = "meshmap" | "868-no";

export type NodeFeedSource = {
  id: NodeFeedSourceId;
  label: string;
  sourceUrl: string;
};

export const NODE_FEED_SOURCES: Record<NodeFeedSourceId, NodeFeedSource> = {
  meshmap: { id: "meshmap", label: "MeshMap.net", sourceUrl: "/meshmap/nodes.json" },
  "868-no": { id: "868-no", label: "868.no", sourceUrl: "/node-sources/868-no" },
};

type MeshmapNodeRaw = {
  longName?: unknown;
  shortName?: unknown;
  hwModel?: unknown;
  role?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  altitude?: unknown;
  altitudeM?: unknown;
  lat?: unknown;
  lon?: unknown;
  updatedAt?: unknown;
  precision?: unknown;
  seenBy?: unknown;
  lastMapReport?: unknown;
  lastDeviceMetrics?: unknown;
  lastEnvironmentMetrics?: unknown;
};

type MeshmapCache = {
  savedAt: number;
  sourceUrl: string;
  nodes: MeshmapNode[];
};

type MeshmapFetchOptions = {
  sourceUrl?: string;
  sourceId?: NodeFeedSourceId;
  cacheTtlMs?: number;
};

export type MeshmapFetchResult = {
  nodes: MeshmapNode[];
  sourceUrl: string;
  fromCache: boolean;
  cacheAgeMs?: number;
  networkError?: boolean;
};

const DEFAULT_MESHMAP_FEED_URL = "/meshmap/nodes.json";
const MESHMAP_CACHE_KEY = "rmw-meshmap-cache-v1";
const NODE_SOURCE_CACHE_KEY_PREFIX = "rmw-node-source-cache-v1";
const MESHMAP_SOURCE_URL_KEY = "rmw-meshmap-source-url-v1";

const toNumber = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const toStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length ? value : undefined;

const toPositionPrecisionBits = (value: unknown): number | undefined => {
  const precision = toNumber(value);
  return precision !== null && Number.isInteger(precision) && precision >= 1 && precision <= 32
    ? precision
    : undefined;
};

export const getPositionPrecisionBounds = (
  node: Pick<MeshmapNode, "lat" | "lon" | "positionPrecisionBits">,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } | null => {
  const precisionBits = node.positionPrecisionBits;
  if (precisionBits === undefined) return null;
  const halfSpanDegrees = 2 ** (31 - precisionBits) * 1e-7;
  const stableCoordinate = (value: number): number => Number(value.toFixed(12));
  return {
    minLat: stableCoordinate(node.lat - halfSpanDegrees),
    maxLat: stableCoordinate(node.lat + halfSpanDegrees),
    minLon: stableCoordinate(node.lon - halfSpanDegrees),
    maxLon: stableCoordinate(node.lon + halfSpanDegrees),
  };
};

export const formatPositionPrecision = (precisionBits: number | undefined): string => {
  if (precisionBits === undefined) return "Position precision unavailable";
  if (precisionBits === 32) return "Position precision: full (32 bits)";
  const halfSpanM = 2 ** (31 - precisionBits) * 1e-7 * 111_195;
  const formattedSpan =
    halfSpanM >= 1_000
      ? `${(halfSpanM / 1_000).toFixed(1)} km`
      : halfSpanM >= 1
        ? `${Math.round(halfSpanM)} m`
        : "<1 m";
  return `Position precision: ${precisionBits} bits · ≈${formattedSpan}`;
};

const cacheKeyFor = (sourceUrl: string): string =>
  sourceUrl === DEFAULT_MESHMAP_FEED_URL
    ? MESHMAP_CACHE_KEY
    : `${NODE_SOURCE_CACHE_KEY_PREFIX}:${sourceUrl}`;

const readCache = (sourceUrl: string): MeshmapCache | null => {
  try {
    const raw = localStorage.getItem(cacheKeyFor(sourceUrl));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeshmapCache;
    if (!Number.isFinite(parsed.savedAt)) return null;
    if (typeof parsed.sourceUrl !== "string" || !parsed.sourceUrl.trim()) return null;
    if (!Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (sourceUrl: string, nodes: MeshmapNode[]): void => {
  try {
    const payload: MeshmapCache = {
      savedAt: Date.now(),
      sourceUrl,
      nodes,
    };
    localStorage.setItem(cacheKeyFor(sourceUrl), JSON.stringify(payload));
  } catch {
    // Best effort cache.
  }
};

const parseNode = (nodeId: string, node: MeshmapNodeRaw): MeshmapNode | null => {
  const normalizedLat = toNumber(node.lat);
  const normalizedLon = toNumber(node.lon);
  const latI = normalizedLat ?? toNumber(node.latitude);
  const lonI = normalizedLon ?? toNumber(node.longitude);
  if (latI === null || lonI === null) return null;
  const lat = normalizedLat === null ? latI / 10_000_000 : normalizedLat;
  const lon = normalizedLon === null ? lonI / 10_000_000 : normalizedLon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const updatedAt = toTimestampMs(node.updatedAt ?? node.lastMapReport);
  return {
    nodeId: canonicalNodeId(nodeId),
    longName: toStringOrUndefined(node.longName),
    shortName: toStringOrUndefined(node.shortName),
    hwModel: toStringOrUndefined(node.hwModel),
    role: toStringOrUndefined(node.role),
    lat,
    lon,
    altitudeM: toNumber(node.altitudeM ?? node.altitude) ?? undefined,
    positionPrecisionBits: toPositionPrecisionBits(node.precision),
    updatedAt: updatedAt ?? undefined,
  };
};

const canonicalNodeId = (nodeId: string): string => {
  const normalized = nodeId.trim().toLowerCase();
  if (normalized.startsWith("!")) return normalized;
  return /^[a-f0-9]+$/.test(normalized) ? `!${normalized}` : normalized;
};

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    value = numeric;
  }
  const numeric = toNumber(value);
  if (numeric === null || numeric <= 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
};

export const parseMeshmapLikeFeed = (payload: unknown): MeshmapNode[] => {
  const out: MeshmapNode[] = [];
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const [nodeId, node] of Object.entries(payload as Record<string, MeshmapNodeRaw>)) {
      const parsed = parseNode(nodeId, node);
      if (parsed) out.push(parsed);
    }
  } else if (Array.isArray(payload)) {
    for (const node of payload) {
      if (!node || typeof node !== "object") continue;
      const raw = node as MeshmapNodeRaw & { nodeId?: unknown; id?: unknown };
      const nodeId = toStringOrUndefined(raw.nodeId) ?? toStringOrUndefined(raw.id);
      if (!nodeId) continue;
      const parsed = parseNode(nodeId, raw);
      if (parsed) out.push(parsed);
    }
  }
  return out.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
};

export const mergeMeshmapNodes = (sources: MeshmapNode[][]): MeshmapNode[] => {
  const merged = new Map<string, MeshmapNode>();
  for (const nodes of sources) {
    for (const node of nodes) {
      const nodeId = canonicalNodeId(node.nodeId);
      const candidate = { ...node, nodeId };
      const current = merged.get(nodeId);
      if (!current || (candidate.updatedAt ?? 0) >= (current.updatedAt ?? 0)) {
        merged.set(nodeId, candidate);
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
};

export const getDefaultMeshmapFeedUrl = (): string => DEFAULT_MESHMAP_FEED_URL;

export const readPreferredMeshmapSourceUrl = (): string => {
  try {
    const configured = localStorage.getItem(MESHMAP_SOURCE_URL_KEY);
    if (!configured) return DEFAULT_MESHMAP_FEED_URL;
    return configured.trim() || DEFAULT_MESHMAP_FEED_URL;
  } catch {
    return DEFAULT_MESHMAP_FEED_URL;
  }
};

export const savePreferredMeshmapSourceUrl = (sourceUrl: string): void => {
  const normalized = sourceUrl.trim() || DEFAULT_MESHMAP_FEED_URL;
  try {
    localStorage.setItem(MESHMAP_SOURCE_URL_KEY, normalized);
  } catch {
    // Best effort preference.
  }
};

export const getCachedMeshmapSnapshotInfo = (): { sourceUrl: string; savedAt: number; nodeCount: number } | null => {
  const cache = readCache(DEFAULT_MESHMAP_FEED_URL);
  if (!cache) return null;
  return {
    sourceUrl: cache.sourceUrl,
    savedAt: cache.savedAt,
    nodeCount: cache.nodes.length,
  };
};

export const fetchMeshmapNodes = async (options: MeshmapFetchOptions = {}): Promise<MeshmapFetchResult> => {
  const sourceUrl = options.sourceUrl?.trim() || readPreferredMeshmapSourceUrl();
  const cacheTtlMs = options.cacheTtlMs ?? 12 * 60 * 60 * 1000;
  const cached = readCache(sourceUrl);
  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Feed error: ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const nodes = parseMeshmapLikeFeed(payload).map((node) => ({
      ...node,
      sourceId: options.sourceId,
      sourceUrl,
    }));
    if (!nodes.length) {
      throw new Error("Feed parsed but returned no usable nodes");
    }
    writeCache(sourceUrl, nodes);
    return {
      nodes,
      sourceUrl,
      fromCache: false,
    };
  } catch (error) {
    if (
      cached &&
      cached.sourceUrl === sourceUrl &&
      Date.now() - cached.savedAt <= cacheTtlMs &&
      cached.nodes.length
    ) {
      return {
        nodes: cached.nodes,
        sourceUrl: cached.sourceUrl,
        fromCache: true,
        cacheAgeMs: Date.now() - cached.savedAt,
        networkError: true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load Meshtastic feed (${sourceUrl}): ${message}`);
  }
};
