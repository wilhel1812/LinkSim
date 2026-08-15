import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const { analyzeTerrainLinkMock } = vi.hoisted(() => ({ analyzeTerrainLinkMock: vi.fn() }));
vi.mock("../../_lib/terrainAnalysis", () => ({ analyzeTerrainLink: analyzeTerrainLinkMock }));
import { onRequestPost, processTerrainJob, validateTerrainRequest } from "./calculate.jobs";
import { normalizeCalculationRequest } from "../../_lib/calculateShared";
import { JOB_STATUS } from "../../_lib/calculationJobs";

class Statement {
  private values: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string, private beforeRun?: (sql: string, values: unknown[]) => void | Promise<void>) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values as never[]) as T | undefined) ?? null; }
  async run() { await this.beforeRun?.(this.sql, this.values); const result = this.db.prepare(this.sql).run(...this.values as never[]); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor(private beforeRun?: (sql: string, values: unknown[]) => void | Promise<void>) {}
  prepare(sql: string) { return new Statement(this.db, sql, this.beforeRun); }
}
const envFor = (db: TestD1) => ({ DB: db as unknown as D1Database });
const input = JSON.stringify({ calculation: "link_budget", input: { from_site: "A", to_site: "B", frequency_mhz: 868, mode: "terrain", nodes: [
  { name: "A", lat: 1, lon: 1 }, { name: "B", lat: 2, lon: 2 },
] } });
const terrainResult = { distanceKm: 10, baselineFsplDb: 100, terrainPenaltyDb: 1, totalPathLossDb: 101,
  terrainObstructed: false, maxIntrusionM: 0, fresnelClearancePercent: 100, samplesUsed: 24,
  tilesFetched: ["N00E000:copernicus30"], fromGroundM: 0, toGroundM: 0 };
const bodyAtSize = (size: number): string => {
  const base = JSON.stringify({ ...JSON.parse(input) as Record<string, unknown>, padding: "" });
  return `${base.slice(0, -2)}${"x".repeat(size - new TextEncoder().encode(base).byteLength)}"}`;
};
const bodyAtDepth = (depth: number): string => {
  let padding: unknown = 0;
  for (let level = 1; level < depth; level += 1) padding = [padding];
  return JSON.stringify({ ...JSON.parse(input) as Record<string, unknown>, padding });
};

afterEach(() => vi.useRealTimers());
describe("terrain calculation jobs", () => {
  it("accepts exactly 2000 km with the 500-sample cap and rejects above it", () => {
    const payloadFor = (distanceKm: number) => normalizeCalculationRequest({ calculation: "link_budget", input: {
      from_site: "A", to_site: "B", frequency_mhz: 868, mode: "terrain",
      nodes: [{ name: "A", lat: 0, lon: 0 }, { name: "B", lat: 0, lon: distanceKm / 6371 * 180 / Math.PI }],
    } });
    expect(validateTerrainRequest(payloadFor(2000))).toMatchObject({ distanceKm: expect.closeTo(2000, 9), samples: 500 });
    expect(() => validateTerrainRequest(payloadFor(2000.001))).toThrow("exceeds maximum of 2000 km");
  });
  it("accepts exactly 64 KiB and depth 10, then rejects plus one and depth 11", async () => {
    analyzeTerrainLinkMock.mockResolvedValue(terrainResult);
    const submit = async (body: string) => {
      const db = new TestD1(); let processing: Promise<unknown> | undefined;
      const response = await onRequestPost({ request: new Request("https://linksim.link/api/v1/calculate/jobs", { method: "POST", body }), env: envFor(db), waitUntil: (promise) => { processing = promise; } });
      if (processing) await processing;
      return response;
    };
    expect((await submit(bodyAtSize(65_536))).status).toBe(202);
    expect((await submit(bodyAtSize(65_537))).status).toBe(413);
    expect((await submit(bodyAtDepth(10))).status).toBe(202);
    expect((await submit(bodyAtDepth(11))).status).toBe(422);
  });

  it("preserves direct POST job charging through the existing configured limiter", async () => {
    analyzeTerrainLinkMock.mockResolvedValue(terrainResult);
    const submit = async () => {
      const db = new TestD1(); let processing: Promise<unknown> | undefined;
      const response = await onRequestPost({
        request: new Request("https://linksim.link/api/v1/calculate/jobs", {
          method: "POST",
          headers: { "cf-connecting-ip": "198.51.100.201" },
          body: input,
        }),
        env: { ...envFor(db), CALC_API_PROXY_RATE_LIMIT_PER_MINUTE: "1" },
        waitUntil: (promise) => { processing = promise; },
      });
      if (processing) await processing;
      return response;
    };

    expect((await submit()).status).toBe(202);
    const limited = await submit();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  it.each(["resolve", "reject"] as const)("enforces the creation deadline, aborts, clears its timer, and ignores a late terrain %s", async (lateOutcome) => {
    vi.useFakeTimers();
    const db = new TestD1();
    db.db.exec("CREATE TABLE calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.db.prepare("INSERT INTO calculation_jobs VALUES (?, 'queued', ?, NULL, NULL, ?, ?)").run("job", input, "2000-01-01T00:00:00Z", "2000-01-01T00:00:00Z");
    let signal: AbortSignal | undefined;
    let settleTerrain: (() => void) | undefined;
    analyzeTerrainLinkMock.mockImplementationOnce((...args: unknown[]) => new Promise((resolve, reject) => {
      signal = args.at(-1) as AbortSignal;
      settleTerrain = () => lateOutcome === "resolve" ? resolve(terrainResult) : reject(new Error("late failure"));
    }));
    const processing = processTerrainJob(envFor(db), "job", "https://linksim.link/api/v1/calculate/jobs");
    await vi.runAllTimersAsync();
    await processing;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(db.db.prepare("SELECT status, error_message FROM calculation_jobs WHERE id = 'job'").get()).toEqual({ status: "timed_out", error_message: "Terrain job timed out." });
    settleTerrain?.();
    await Promise.resolve();
    expect(db.db.prepare("SELECT status FROM calculation_jobs WHERE id = 'job'").get()).toEqual({ status: "timed_out" });
  });

  it("records ordinary terrain failures as bounded failed jobs", async () => {
    const db = new TestD1();
    db.db.exec("CREATE TABLE calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.db.prepare("INSERT INTO calculation_jobs VALUES (?, 'queued', ?, NULL, NULL, datetime('now'), datetime('now'))").run("job", input);
    analyzeTerrainLinkMock.mockRejectedValueOnce(new Error("💥".repeat(1000)));
    await processTerrainJob(envFor(db), "job", "https://linksim.link/api/v1/calculate/jobs");
    const row = db.db.prepare("SELECT status, error_message FROM calculation_jobs WHERE id = 'job'").get() as { status: string; error_message: string };
    expect(row.status).toBe("failed");
    expect(new TextEncoder().encode(row.error_message).byteLength).toBeLessThanOrEqual(1024);
  });

  it("times out when terrain resolves before the deadline but the completion write crosses it", async () => {
    const db = new TestD1((sql, values) => {
      if (sql.includes("created_at >") && values[0] === JOB_STATUS.COMPLETED) {
        db.db.prepare("UPDATE calculation_jobs SET created_at = datetime('now', '-5 minutes') WHERE id = 'job'").run();
      }
    });
    db.db.exec("CREATE TABLE calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('job', 'queued', ?, NULL, NULL, datetime('now'), datetime('now'))").run(input);
    analyzeTerrainLinkMock.mockResolvedValueOnce(terrainResult);
    await processTerrainJob(envFor(db), "job", "https://linksim.link/api/v1/calculate/jobs");
    expect(db.db.prepare("SELECT status, result_json FROM calculation_jobs WHERE id = 'job'").get()).toEqual({ status: JOB_STATUS.TIMED_OUT, result_json: null });
  });
});
