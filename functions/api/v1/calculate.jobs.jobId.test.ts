import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { JOB_STATUS, transitionCalculationJob } from "../../_lib/calculationJobs";
import { onRequestGet, onRequestOptions } from "./calculate.jobs.jobId";

const makeEnv = (row: unknown = null) => {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const run = vi.fn(async () => ({ success: true }));
  const prepare = vi.fn((sql: string) => sql.startsWith("CREATE TABLE") ? { run } : sql.startsWith("UPDATE") || sql.startsWith("DELETE") ? { bind: () => ({ run }) } : { bind });
  return { env: { DB: { prepare } } as unknown as Parameters<typeof onRequestGet>[0]["env"], first };
};

class Statement {
  private values: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values as never[]) as T | undefined) ?? null; }
  async run() { const result = this.db.prepare(this.sql).run(...this.values as never[]); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() { this.db.exec("CREATE TABLE calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"); }
  prepare(sql: string) { return new Statement(this.db, sql); }
}
const envFor = (db: TestD1) => ({ DB: db as unknown as D1Database });

describe("api/v1/calculate job status CORS", () => {
  it("keeps an originless API client free of CORS authorization headers", async () => {
    const { env } = makeEnv();
    const response = await onRequestGet({
      request: new Request("https://linksim.link/api/v1/calculate/jobs/job-1"),
      env,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Job not found." });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("uses the shared credentialed contract for a same-origin response", async () => {
    const { env } = makeEnv({
      id: "job-1",
      status: "completed",
      input_json: "{}",
      result_json: "{\"ok\":true}",
      error_message: null,
      created_at: "2026-08-13T00:00:00Z",
      updated_at: "2026-08-13T00:00:01Z",
    });
    const response = await onRequestGet({
      request: new Request("https://staging.linksim.link/api/v1/calculate/jobs/job-1", {
        headers: { origin: "https://staging.linksim.link" },
      }),
      env,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://staging.linksim.link");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("preserves malformed stored result strings for polling compatibility", async () => {
    const { env } = makeEnv({
      id: "job-1", status: "completed", input_json: "{}", result_json: "not-json", error_message: null,
      created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:01Z",
    });
    const response = await onRequestGet({ request: new Request("https://linksim.link/api/v1/calculate/jobs/job-1"), env });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "completed", result: "not-json" });
  });

  it("does not impose a guessed job ID length quota", async () => {
    const { env } = makeEnv();
    const longId = "job-" + "x".repeat(1024);
    const response = await onRequestGet({ request: new Request(`https://linksim.link/api/v1/calculate/jobs/${longId}`), env });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Job not found." });
  });

  it("uses the shared preflight policy for the local Vite exception", async () => {
    const { env } = makeEnv();
    const response = await onRequestOptions({
      request: new Request("http://127.0.0.1:8788/api/v1/calculate/jobs/job-1", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5174",
          "access-control-request-method": "GET",
        },
      }),
      env,
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it.each([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING])("atomically times out addressed stale %s jobs at the five-minute boundary", async (status) => {
    const db = new TestD1();
    db.db.prepare("INSERT INTO calculation_jobs VALUES (?, ?, '{}', NULL, NULL, datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))").run(`stale-${status}`, status);
    const response = await onRequestGet({ request: new Request(`https://linksim.link/api/v1/calculate/jobs/stale-${status}`), env: envFor(db) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: JOB_STATUS.TIMED_OUT, error: "Job timed out before completion." });
    expect(await transitionCalculationJob(envFor(db), `stale-${status}`, [JOB_STATUS.RUNNING], JOB_STATUS.COMPLETED, "{}", null)).toBe(false);
    expect(db.db.prepare("SELECT status FROM calculation_jobs WHERE id = ?").get(`stale-${status}`)).toEqual({ status: JOB_STATUS.TIMED_OUT });
  });

  it("expires an addressed terminal job at the inclusive 24-hour boundary", async () => {
    const db = new TestD1();
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('expired', 'completed', '{}', '{}', NULL, datetime('now', '-25 hours'), datetime('now', '-24 hours'))").run();
    const response = await onRequestGet({ request: new Request("https://linksim.link/api/v1/calculate/jobs/expired"), env: envFor(db) });
    expect(response.status).toBe(404);
    expect(db.db.prepare("SELECT id FROM calculation_jobs WHERE id = 'expired'").get()).toBeUndefined();
  });

  it("keeps addressed active and terminal jobs immediately inside their boundaries", async () => {
    const db = new TestD1();
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('active', 'queued', '{}', NULL, NULL, datetime('now', '-5 minutes', '+1 second'), datetime('now'))").run();
    db.db.prepare("INSERT INTO calculation_jobs VALUES ('terminal', 'failed', '{}', NULL, 'failed', datetime('now', '-25 hours'), datetime('now', '-24 hours', '+1 second'))").run();
    const active = await onRequestGet({ request: new Request("https://linksim.link/api/v1/calculate/jobs/active"), env: envFor(db) });
    const terminal = await onRequestGet({ request: new Request("https://linksim.link/api/v1/calculate/jobs/terminal"), env: envFor(db) });
    await expect(active.json()).resolves.toMatchObject({ status: JOB_STATUS.QUEUED });
    await expect(terminal.json()).resolves.toMatchObject({ status: JOB_STATUS.FAILED });
  });
});
