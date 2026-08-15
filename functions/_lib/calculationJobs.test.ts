import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { boundedJobError, cleanupCalculationJobs, createCalculationJob, ensureCalculationJobsTable, finishCalculationJobBeforeDeadline, getCalculationJob, JOB_STATUS, transitionCalculationJob } from "./calculationJobs";

class Statement {
  private values: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values as never[]) as T | undefined) ?? null; }
  async run() { const result = this.db.prepare(this.sql).run(...this.values as never[]); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class TestD1 { db = new DatabaseSync(":memory:"); prepare(sql: string) { return new Statement(this.db, sql); } }
const envFor = (db: TestD1) => ({ DB: db as unknown as D1Database });

describe("calculation job lifecycle", () => {
  it("bounds stored errors by UTF-8 bytes", () => {
    expect(new TextEncoder().encode(boundedJobError("💥".repeat(1000))).byteLength).toBeLessThanOrEqual(1024);
  });
  it("uses compare-and-set transitions so a timeout cannot be overwritten", async () => {
    const db = new TestD1(); const env = envFor(db); await ensureCalculationJobsTable(env); await createCalculationJob(env, "job", "{}");
    expect(await transitionCalculationJob(env, "job", [JOB_STATUS.QUEUED], JOB_STATUS.RUNNING, null, null)).toBe(true);
    expect(await transitionCalculationJob(env, "job", [JOB_STATUS.RUNNING], JOB_STATUS.TIMED_OUT, null, "timeout")).toBe(true);
    expect(await transitionCalculationJob(env, "job", [JOB_STATUS.RUNNING], JOB_STATUS.COMPLETED, "{}", null)).toBe(false);
    expect((await getCalculationJob(env, "job"))?.status).toBe(JOB_STATUS.TIMED_OUT);
  });

  it.each([JOB_STATUS.COMPLETED, JOB_STATUS.FAILED] as const)("does not commit %s at the deadline boundary", async (status) => {
    const db = new TestD1(); const env = envFor(db); await ensureCalculationJobsTable(env);
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('job', 'running', '{}', NULL, NULL, datetime('now', '-5 minutes'), datetime('now'))").run();
    expect(await finishCalculationJobBeforeDeadline(env, "job", status, status === JOB_STATUS.COMPLETED ? "{}" : null, status === JOB_STATUS.FAILED ? "failed" : null)).toBe(false);
    expect((await getCalculationJob(env, "job"))?.status).toBe(JOB_STATUS.RUNNING);
  });

  it("removes terminal rows older than 24 hours and deterministically caps newer rows at 1000", async () => {
    const db = new TestD1(); const env = envFor(db); await ensureCalculationJobsTable(env);
    const insert = db.db.prepare("INSERT INTO calculation_jobs VALUES (?, ?, '{}', NULL, NULL, ?, ?)");
    insert.run("old", "completed", "2000-01-01 00:00:00", "2000-01-01 00:00:00");
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('boundary', 'failed', '{}', NULL, NULL, datetime('now', '-25 hours'), datetime('now', '-24 hours'))").run();
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('queued', 'queued', '{}', NULL, NULL, datetime('now'), datetime('now'))").run();
    for (let i = 0; i < 1002; i += 1) insert.run(`terminal-${String(i).padStart(4, "0")}`, "completed", "2999-01-01 00:00:00", "2999-01-01 00:00:00");
    db.db.prepare("UPDATE calculation_jobs SET created_at = '2998-01-01 00:00:00' WHERE id = 'terminal-1001'").run();
    await cleanupCalculationJobs(env);
    expect(db.db.prepare("SELECT count(*) count FROM calculation_jobs WHERE status = 'completed'").get()).toEqual({ count: 1000 });
    expect(db.db.prepare("SELECT id FROM calculation_jobs WHERE id = 'queued'").get()).toEqual({ id: "queued" });
    expect(db.db.prepare("SELECT id FROM calculation_jobs WHERE id IN ('old', 'boundary', 'terminal-1001')").all()).toEqual([]);
    expect(db.db.prepare("SELECT id FROM calculation_jobs WHERE status = 'completed' ORDER BY id LIMIT 1").get()).toEqual({ id: "terminal-0001" });
  });

  it("moves abandoned active rows into the terminal cap while excluding fresh active rows", async () => {
    const db = new TestD1(); const env = envFor(db); await ensureCalculationJobsTable(env);
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('stale', 'queued', '{}', NULL, NULL, datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))").run();
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('fresh', 'running', '{}', NULL, NULL, datetime('now', '-5 minutes', '+1 second'), datetime('now'))").run();
    const insert = db.db.prepare("INSERT INTO calculation_jobs VALUES (?, 'completed', '{}', '{}', NULL, '2999-01-01 00:00:00', '2999-01-01 00:00:00')");
    for (let index = 0; index < 1000; index += 1) insert.run(`terminal-${String(index).padStart(4, "0")}`);
    await cleanupCalculationJobs(env);
    expect(db.db.prepare("SELECT id FROM calculation_jobs WHERE id = 'stale'").get()).toBeUndefined();
    expect(db.db.prepare("SELECT status FROM calculation_jobs WHERE id = 'fresh'").get()).toEqual({ status: JOB_STATUS.RUNNING });
    expect(db.db.prepare("SELECT count(*) count FROM calculation_jobs WHERE status IN ('completed', 'failed', 'timed_out')").get()).toEqual({ count: 1000 });
  });

  it("prevents late completion after global cleanup times out an abandoned worker", async () => {
    const db = new TestD1(); const env = envFor(db); await ensureCalculationJobsTable(env);
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('stale', 'running', '{}', NULL, NULL, datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))").run();
    await cleanupCalculationJobs(env);
    expect((await getCalculationJob(env, "stale"))?.status).toBe(JOB_STATUS.TIMED_OUT);
    expect(await transitionCalculationJob(env, "stale", [JOB_STATUS.RUNNING], JOB_STATUS.COMPLETED, "{}", null)).toBe(false);
    expect((await getCalculationJob(env, "stale"))?.status).toBe(JOB_STATUS.TIMED_OUT);
  });
});
