import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "db/migrations/2026-08-27_basemap_preferences.sql"), "utf8");

describe("basemap preferences migration", () => {
  it("is additive and can be safely invoked repeatedly through the deployment probe", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)");
    const applyIfMissing = () => {
      const columns = database.prepare("PRAGMA table_info(users)").all().map((row) => String(row.name));
      if (!columns.includes("basemap_preferences_json")) database.exec(migration);
    };
    applyIfMissing();
    applyIfMissing();
    expect(database.prepare("PRAGMA table_info(users)").all().map((row) => row.name)).toContain("basemap_preferences_json");
  });
});
