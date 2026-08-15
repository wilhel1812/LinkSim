export const MESHMAP_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MESHMAP_MAX_RECORDS = 20_000;

export const MESHSTELLAR_MAX_STREAM_BYTES = 5 * 1024 * 1024;
export const MESHSTELLAR_MAX_EVENTS = 5_000;
export const MESHSTELLAR_SNAPSHOT_IDLE_MS = 1_000;
export const MESHSTELLAR_SNAPSHOT_MAX_MS = 8_000;

export const NODE_FEED_MAX_RECORDS_PER_SOURCE = 20_000;
export const NODE_FEED_MAX_COMBINED_RECORDS = 25_000;

export const PANORAMA_MAX_NODE_CANDIDATES = 1_000;
export const PANORAMA_MAX_NODE_DISTANCE_KM = 200;

export class BoundedUpstreamError extends Error {}

type BoundedJsonOptions = {
  maxBytes: number;
  maxRecords: number;
};

const recordCount = (value: unknown): number | null => {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return null;
};

export const readBoundedJsonResponse = async <T>(
  response: Response,
  options: BoundedJsonOptions,
): Promise<{ bytes: Uint8Array; value: T }> => {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BoundedUpstreamError("Upstream response exceeded the size limit");
  }
  if (!response.body) throw new BoundedUpstreamError("Upstream response body is missing");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedUpstreamError("Upstream response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: T;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new BoundedUpstreamError("Upstream response must contain valid JSON");
  }
  const records = recordCount(value);
  if (records === null) {
    throw new BoundedUpstreamError("Upstream response JSON root must be an object or array");
  }
  if (records > options.maxRecords) {
    throw new BoundedUpstreamError("Upstream response exceeded the record limit");
  }
  return { bytes, value };
};
