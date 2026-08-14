import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_D1_DATABASE,
  LOCAL_D1_SEED_FILE,
  LOCAL_WRANGLER_COMMAND,
  buildLocalD1SeedArgs,
  runLocalD1Seed,
} from "../../scripts/seed-local-d1.mjs";

const root = process.cwd();
const migrationDirectory = resolve(root, "db/migrations");
const localSeedFile = resolve(root, LOCAL_D1_SEED_FILE);

describe("local D1 seed isolation", () => {
  it("keeps destructive local fixtures outside the ordered migration directory", () => {
    const migrations = readdirSync(migrationDirectory);
    expect(migrations).not.toContain("2026-03-12_local_test_users_seed.sql");

    for (const migration of migrations) {
      const sql = readFileSync(resolve(migrationDirectory, migration), "utf8");
      expect(sql).not.toMatch(/DELETE\s+FROM\s+users/i);
      expect(sql).not.toContain("@linksim.local");
    }
  });

  it("preserves the destructive fixture in the dedicated local-only location", () => {
    const sql = readFileSync(localSeedFile, "utf8");
    expect(sql).toMatch(/DELETE\s+FROM\s+users/i);
    expect(sql).toContain("admin.primary@linksim.local");

    const database = new DatabaseSync(":memory:");
    database.exec(readFileSync(resolve(root, "db/schema.sql"), "utf8"));
    database.exec(sql);
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({
      count: 14,
    });
  });

  it("builds one fixed local Wrangler invocation", () => {
    expect(LOCAL_D1_DATABASE).toBe("linksim");
    expect(LOCAL_WRANGLER_COMMAND).toBe(resolve(root, "node_modules/.bin/wrangler"));
    expect(buildLocalD1SeedArgs()).toEqual([
      "d1",
      "execute",
      "linksim",
      "--local",
      "--file",
      localSeedFile,
      "--yes",
    ]);
  });

  it.each([
    ["remote mode", ["--remote"]],
    ["production database", ["linksim_prod"]],
    ["staging database", ["linksim_staging"]],
    ["alternate environment", ["--env", "production"]],
  ])("refuses %s overrides", (_label, args) => {
    const runner = vi.fn();
    expect(() => runLocalD1Seed({ args, env: {}, runner })).toThrow(
      "does not accept arguments",
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("refuses to run in CI", () => {
    const runner = vi.fn();
    expect(() => runLocalD1Seed({ args: [], env: { CI: "true" }, runner })).toThrow(
      "disabled in CI",
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("fails closed when Wrangler fails", () => {
    const runner = vi.fn(() => ({ status: 1 }));
    expect(() => runLocalD1Seed({ args: [], env: {}, runner })).toThrow(
      "Local D1 seed failed",
    );
  });

  it("exposes only the fixed local command through npm", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(packageJson.scripts["db:seed:local"]).toBe("node scripts/seed-local-d1.mjs");
  });
});
