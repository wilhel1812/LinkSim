import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { listUsers } from "./db";
import { SqliteD1 } from "./testSqliteD1";

const applicationSchema = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
const authSchema = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql"),
  "utf8",
);

describe("administrator authentication migration overview", () => {
  let database: SqliteD1;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(applicationSchema);
    database.db.exec(authSchema);
    for (const [id, approvedBy] of [
      ["admin-1", "bootstrap"],
      ["user-1", "admin-1"],
      ["revoked-1", "revoked:admin-1"],
      ["deleted-1", "admin-1"],
    ]) {
      database.db.prepare(`INSERT INTO users
        (id, username, is_admin, is_approved, approved_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          id,
          id === "admin-1" ? 1 : 0,
          id === "revoked-1" ? 0 : 1,
          approvedBy,
          "2026-09-23T00:00:00.000Z",
        );
    }
    database.db.prepare(`INSERT INTO deleted_users (id, deleted_at, deleted_by_user_id)
      VALUES ('deleted-1', '2026-09-23T01:00:00.000Z', 'admin-1')`).run();
    for (const [authId, linksimId] of [["auth-admin", "admin-1"], ["auth-revoked", "revoked-1"]]) {
      database.db.prepare(`INSERT INTO auth_user
        (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, ?, ?)`).run(
          authId,
          authId,
          `${authId}@example.invalid`,
          "2026-09-23T00:00:00.000Z",
          "2026-09-23T00:00:00.000Z",
        );
      database.db.prepare(`INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
        VALUES (?, ?, '2026-09-23T00:00:00.000Z')`).run(authId, linksimId);
    }
  });

  it("returns current accounts with a mapping-derived state to administrators", async () => {
    const users = await listUsers({ DB: database as unknown as D1Database } as never, true);

    expect(users.map((user) => ({
      id: user.id,
      accountState: user.accountState,
      authMigrationState: user.authMigrationState,
    }))).toEqual(expect.arrayContaining([
      { id: "admin-1", accountState: "approved", authMigrationState: "migrated" },
      { id: "user-1", accountState: "approved", authMigrationState: "not_migrated" },
      { id: "revoked-1", accountState: "revoked", authMigrationState: "migrated" },
    ]));
    expect(users).toHaveLength(3);
  });

  it("omits authentication migration metadata from moderator directory results", async () => {
    const users = await listUsers({ DB: database as unknown as D1Database } as never, false);

    expect(users).toHaveLength(3);
    expect(users.every((user) => !("authMigrationState" in user))).toBe(true);
  });

  it("reflects mapping removal without changing the LinkSim account", async () => {
    database.db.prepare("DELETE FROM auth_identity_map WHERE linksim_user_id = 'admin-1'").run();

    const users = await listUsers({ DB: database as unknown as D1Database } as never, true);

    expect(users.find((user) => user.id === "admin-1")).toMatchObject({
      authMigrationState: "not_migrated",
    });
  });
});
