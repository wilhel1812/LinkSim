// Self-contained lossless storage. Keep SQL permission paths and the existing
// history response readable without decompressing or following other rows.
const MARKER = "__linksimHistoryV1";
const MAX_BYTES = 2_000_000;
const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const encodeHistoryDetails = async (raw: string): Promise<string> => {
  const bytes = encoder.encode(raw);
  if (bytes.length < 2048 || bytes.length > MAX_BYTES) return raw;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return raw; }
  if (!object(value) || MARKER in value || !object(value.diff) || !("snapshot" in value.diff)) return raw;
  const compressed = new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());
  let binary = "";
  for (const byte of compressed) binary += String.fromCharCode(byte);
  const diff = { ...value.diff };
  delete diff.snapshot;
  const candidate = JSON.stringify({
    ...value, diff,
    [MARKER]: { encoding: "gzip-base64", bytes: bytes.length, body: btoa(binary) },
  });
  return encoder.encode(candidate).length < bytes.length ? candidate : raw;
};

// For lossless audit export/backfill verification, never for the public history
// response (which must continue using its existing field allowlist).
export const decodeHistoryDetails = async (stored: string): Promise<string> => {
  const parsed: unknown = JSON.parse(stored);
  if (!object(parsed) || !(MARKER in parsed)) return stored;
  const envelope = parsed[MARKER];
  if (!object(envelope) || envelope.encoding !== "gzip-base64" ||
      !Number.isInteger(envelope.bytes) || Number(envelope.bytes) < 0 || Number(envelope.bytes) > MAX_BYTES ||
      typeof envelope.body !== "string" || envelope.body.length > MAX_BYTES * 2) {
    throw new Error("Invalid compact history details");
  }
  const compressed = Uint8Array.from(atob(envelope.body), (char) => char.charCodeAt(0));
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > Number(envelope.bytes)) throw new Error("Compact history details exceeds declared size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (size !== envelope.bytes) throw new Error("Compact history details size mismatch");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  JSON.parse(raw); // Fail closed on corrupt/non-JSON archives.
  return raw;
};
