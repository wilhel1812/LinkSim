import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishSiteNotice, readPublicSiteNotice } from "./siteNotice";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class TestD1 {
  readonly database = new DatabaseSync(":memory:");
  prepare(sql: string) { return new Statement(this.database, sql); }
  async batch(statements: Statement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const draft = (message: string) => ({
  active: true,
  tone: "warning" as const,
  message,
  dismissible: true,
  startsAt: null,
  expiresAt: null,
});

describe("persisted site notices", () => {
  let db: TestD1;
  let env: Parameters<typeof publishSiteNotice>[0];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00.000Z"));
    db = new TestD1();
    db.database.exec(readFileSync(resolve(process.cwd(), "db/migrations/2026-08-20_site_notice.sql"), "utf8"));
    env = { DB: db as unknown as D1Database };
  });

  afterEach(() => vi.useRealTimers());

  it("seeds the registration notice as dismissible", async () => {
    await expect(readPublicSiteNotice(env)).resolves.toMatchObject({ dismissible: true });
  });

  it("fails open when a stored public row is malformed", async () => {
    db.database.exec("PRAGMA ignore_check_constraints = ON; UPDATE site_notice SET tone = 'future';");
    await expect(readPublicSiteNotice(env)).resolves.toBeNull();
  });

  it("serializes overlapping writes with unique revisions and complete audit entries", async () => {
    const [first, second] = await Promise.all([
      publishSiteNotice(env, draft("First update"), { actorId: "admin-1", source: "admin-panel" }),
      publishSiteNotice(env, draft("Second update"), { actorId: "admin-1", source: "admin-panel" }),
    ]);

    expect(new Set([first.revision, second.revision])).toEqual(new Set([2, 3]));
    const row = db.database.prepare("SELECT revision FROM site_notice WHERE singleton = 1").get() as { revision: number };
    expect(row.revision).toBe(3);
    const audits = db.database.prepare(
      "SELECT previous_json, next_json FROM site_notice_audit WHERE source = 'admin-panel' ORDER BY id",
    ).all() as Array<{ previous_json: string; next_json: string }>;
    expect(audits).toHaveLength(2);
    expect(audits.map((entry) => JSON.parse(entry.next_json).revision)).toEqual([2, 3]);
    expect(JSON.parse(audits[1].previous_json).revision).toBe(2);
  });
});
