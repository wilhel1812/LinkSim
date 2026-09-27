import { expect, it } from "vitest";
import { compactHistoryDetailsPage } from "./historyCompaction";
import { decodeHistoryDetails } from "./historyDetails";

it("uses compare-and-swap, reports concurrent changes and resumes without overwriting them", async () => {
  const original = JSON.stringify({ diff: { snapshot: { before: "x".repeat(4000), after: "y".repeat(4000) } } });
  let current = original;
  const statements: string[] = [];
  let mutate = true;
  const DB = { prepare(sql: string) {
    statements.push(sql);
    return { bind(...values: unknown[]) {
      return {
        all: async () => ({ results: [{ id: 8, details_json: current }] }),
        run: async () => {
          expect(sql).toBe("UPDATE resource_changes SET details_json = ? WHERE id = ? AND details_json = ?");
          expect(values[1]).toBe(8);
          expect(await decodeHistoryDetails(String(values[0]))).toBe(original);
          if (mutate) current = "concurrent update";
          if (values[2] !== current) return { meta: { changes: 0 } };
          current = String(values[0]); return { meta: { changes: 1 } };
        },
      };
    } };
  } } as unknown as D1Database;
  const dry = await compactHistoryDetailsPage(DB);
  expect(dry).toMatchObject({ candidates: 1, converted: 0, nextId: 8 });
  expect(statements.some(sql => sql.startsWith("UPDATE"))).toBe(false);
  const conflict = await compactHistoryDetailsPage(DB, { apply: true });
  expect(conflict).toMatchObject({ converted: 0, conflicts: 1 });
  expect(current).toBe("concurrent update");
  current = original; mutate = false;
  const applied = await compactHistoryDetailsPage(DB, { apply: true });
  expect(applied.converted).toBe(1);
  expect(await decodeHistoryDetails(current)).toBe(original);
  expect((await compactHistoryDetailsPage(DB, { apply: true })).candidates).toBe(0);
});

it("rejects unbounded pages before querying D1", async () => {
  for (const options of [{ limit: 11 }, { afterId: -1 }, { limit: 0 }]) {
    await expect(compactHistoryDetailsPage({} as D1Database, options)).rejects.toThrow();
  }
});
