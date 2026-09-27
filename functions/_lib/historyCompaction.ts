import { decodeHistoryDetails, encodeHistoryDetails } from "./historyDetails";

// Internal maintenance primitive only: no route, cron, or deployment invokes it.
// Inspect one bounded page by default; writes require an explicit apply option.
export const compactHistoryDetailsPage = async (
  DB: D1Database,
  options: { afterId?: number; limit?: number; apply?: boolean } = {},
) => {
  const afterId = options.afterId ?? 0;
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("Invalid history compaction page");
  }
  const rows = await DB.prepare(
    "SELECT id, details_json FROM resource_changes WHERE id > ? ORDER BY id LIMIT ?",
  ).bind(afterId, limit).all<{ id: number; details_json: string | null }>();
  const result = { scanned: rows.results.length, candidates: 0, converted: 0, conflicts: 0, bytesBefore: 0, bytesAfter: 0, nextId: afterId };
  for (const row of rows.results) {
    result.nextId = row.id;
    if (row.details_json === null) continue;
    const original = row.details_json;
    const compact = await encodeHistoryDetails(original);
    result.bytesBefore += new TextEncoder().encode(original).length;
    result.bytesAfter += new TextEncoder().encode(compact).length;
    if (compact === original) continue;
    // Every candidate is round-trip verified before any mutation.
    if (await decodeHistoryDetails(compact) !== original) throw new Error("History compaction verification failed");
    result.candidates++;
    if (options.apply === true) {
      const updated = await DB.prepare(
        "UPDATE resource_changes SET details_json = ? WHERE id = ? AND details_json = ?",
      ).bind(compact, row.id, original).run();
      if (updated.meta.changes === 1) result.converted++;
      else result.conflicts++;
    }
  }
  return result;
};
