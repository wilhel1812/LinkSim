import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-08-12_identity_lifecycle.sql"),
  "utf8",
);

const databaseWithIdentityInputs = () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, idp_email TEXT, idp_email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE deleted_users (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, deleted_by_user_id TEXT);
  `);
  return database;
};

describe("identity lifecycle migration", () => {
  it("backfills one authoritative claim and current subject per verified identity", () => {
    const database = databaseWithIdentityInputs();
    database.exec(`
      INSERT INTO users VALUES ('subject-a', ' USER@Example.com ', 1, '2026-01-01', '2026-02-01');
      INSERT INTO users VALUES ('subject-b', 'ignored@example.com', 0, '2026-01-01', '2026-02-01');
    `);

    database.exec(migration);

    expect(database.prepare("SELECT normalized_email, current_user_id, status FROM verified_identity_claims").all()).toEqual([
      { normalized_email: "user@example.com", current_user_id: "subject-a", status: "active" },
    ]);
    expect(database.prepare("SELECT user_id, status, canonical_user_id, bootstrap_consumed FROM identity_subject_states").all()).toEqual([
      { user_id: "subject-a", status: "current", canonical_user_id: "subject-a", bootstrap_consumed: 1 },
    ]);
    expect(database.prepare("SELECT version FROM identity_lifecycle_meta WHERE singleton = 1").get()).toEqual({
      version: "2026-08-12-identity-lifecycle-v1",
    });
  });

  it("fails closed instead of selecting a winner for duplicate normalized identities", () => {
    const database = databaseWithIdentityInputs();
    database.exec(`
      INSERT INTO users VALUES ('subject-a', 'user@example.com', 1, '2026-01-01', '2026-02-01');
      INSERT INTO users VALUES ('subject-b', ' USER@example.com ', 1, '2026-01-01', '2026-02-01');
    `);

    expect(() => database.exec(migration)).toThrow("UNIQUE constraint failed");
    expect(() => database.prepare("SELECT version FROM identity_lifecycle_meta").get()).toThrow();
  });

  it("refuses an unmappable historical deletion tombstone", () => {
    const database = databaseWithIdentityInputs();
    database.exec("INSERT INTO deleted_users VALUES ('deleted-subject', '2026-01-01', 'admin-id')");

    expect(() => database.exec(migration)).toThrow("UNIQUE constraint failed");
    expect(() => database.prepare("SELECT version FROM identity_lifecycle_meta").get()).toThrow();
  });
});
