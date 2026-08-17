type SyncDigestPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

const sortRecords = (records: unknown[]): unknown[] => [...records].sort((left, right) => {
  const leftId = left && typeof left === "object" ? String((left as { id?: unknown }).id ?? "") : "";
  const rightId = right && typeof right === "object" ? String((right as { id?: unknown }).id ?? "") : "";
  return leftId.localeCompare(rightId);
});

export const computeSyncPayloadDigest = async (payload: SyncDigestPayload): Promise<string> => {
  const canonical = JSON.stringify(canonicalize({
    siteLibrary: sortRecords(payload.siteLibrary),
    simulationPresets: sortRecords(payload.simulationPresets),
  }));
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};
