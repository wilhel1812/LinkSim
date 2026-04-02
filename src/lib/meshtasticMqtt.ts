export type MeshmapNode = {
  nodeId: string;
  longName?: string;
  shortName?: string;
  hwModel?: string;
  role?: string;
  lat: number;
  lon: number;
  altitudeM?: number;
};

type MeshmapNodeRaw = {
  longName?: unknown;
  shortName?: unknown;
  hwModel?: unknown;
  role?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  altitude?: unknown;
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
const MESHMAP_SOURCE_URL_KEY = "rmw-meshmap-source-url-v1";

const toNumber = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const toStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length ? value : undefined;

const readCache = (): MeshmapCache | null => {
  try {
    const raw = localStorage.getItem(MESHMAP_CACHE_KEY);
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
    localStorage.setItem(MESHMAP_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Best effort cache.
  }
};

const parseNode = (nodeId: string, node: MeshmapNodeRaw): MeshmapNode | null => {
  const latI = toNumber(node.latitude);
  const lonI = toNumber(node.longitude);
  if (latI === null || lonI === null) return null;
  const lat = latI / 10_000_000;
  const lon = lonI / 10_000_000;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return {
    nodeId,
    longName: toStringOrUndefined(node.longName),
    shortName: toStringOrUndefined(node.shortName),
    hwModel: toStringOrUndefined(node.hwModel),
    role: toStringOrUndefined(node.role),
    lat,
    lon,
    altitudeM: toNumber(node.altitude) ?? undefined,
  };
};

const parseMeshmapLikeFeed = (payload: unknown): MeshmapNode[] => {
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
  const cache = readCache();
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
  const cached = readCache();
  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Feed error: ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const nodes = parseMeshmapLikeFeed(payload);
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
      (cached.sourceUrl === sourceUrl || cached.sourceUrl === DEFAULT_MESHMAP_FEED_URL) &&
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
