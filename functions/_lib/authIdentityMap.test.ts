import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AuthIdentityMapConflictError,
  AuthIdentityMapEligibilityError,
  attachAuthIdentity,
  findAuthIdentityByAuthUserId,
  findAuthIdentityByLinkSimUserId,
  resolveCurrentAuthIdentity,
} from "./authIdentityMap";
import { SqliteD1 } from "./testSqliteD1";

const migration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql"),
  "utf8",
);

describe("auth identity mapping", () => {
  let database: SqliteD1;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec("DROP TABLE auth_identity_map");
    database.db.exec(migration);
    database.db.prepare(
      "INSERT INTO users (id, username, is_approved, created_at) VALUES (?, ?, 1, ?)",
    ).run("linksim-1", "first", "2026-09-19T00:00:00.000Z");
    database.db.prepare(
      "INSERT INTO users (id, username, is_approved, created_at) VALUES (?, ?, 1, ?)",
    ).run("linksim-2", "second", "2026-09-19T00:00:00.000Z");
    for (const [id, email] of [["auth-1", "first@example.invalid"], ["auth-2", "second@example.invalid"]]) {
      database.db.prepare(`INSERT INTO auth_user
        (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, ?, ?)`).run(id, id, email, new Date(0).toISOString(), new Date(0).toISOString());
    }
  });

  it("installs the reviewed namespaced schema idempotently with unique mappings", () => {
    expect(() => database.db.exec(migration)).not.toThrow();
    const tables = database.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%' ORDER BY name",
    ).all().map(row => row.name);
    expect(tables).toEqual([
      "auth_account", "auth_identity_map", "auth_passkey", "auth_rate_limit",
      "auth_session", "auth_user", "auth_verification",
    ]);
    database.db.prepare(
      "INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at) VALUES (?, ?, ?)",
    ).run("auth-1", "linksim-1", "2026-09-19T00:00:00.000Z");
    expect(() => database.db.prepare(
      "INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at) VALUES (?, ?, ?)",
    ).run("auth-2", "linksim-1", "2026-09-19T00:00:00.000Z")).toThrow();
  });

  it("matches the reviewed Better Auth experiment schema and pinned versions", () => {
    const experiment = readFileSync(resolve(process.cwd(), "experiments/better-auth/schema.sql"), "utf8")
      .replaceAll('"probe_', '"auth_')
      .replaceAll('probe_', 'auth_');
    const expected = new SqliteD1();
    expected.db.exec(experiment);
    const tableNames = ["auth_user", "auth_session", "auth_account", "auth_verification", "auth_passkey", "auth_rate_limit"];
    for (const table of tableNames) {
      expect(database.db.prepare(`PRAGMA table_info(${table})`).all())
        .toEqual(expected.db.prepare(`PRAGMA table_info(${table})`).all());
      expect(database.db.prepare(`PRAGMA foreign_key_list(${table})`).all())
        .toEqual(expected.db.prepare(`PRAGMA foreign_key_list(${table})`).all());
      expect(database.db.prepare(`PRAGMA index_list(${table})`).all().map(row => ({ name: row.name, unique: row.unique })))
        .toEqual(expected.db.prepare(`PRAGMA index_list(${table})`).all().map(row => ({ name: row.name, unique: row.unique })));
    }
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "experiments/better-auth/package.json"), "utf8"));
    expect(packageJson.dependencies["better-auth"]).toBe("1.7.3");
    expect(packageJson.dependencies["@better-auth/passkey"]).toBe("1.7.3");
    expected.db.close();
  });

  it("keeps durable mappings when auth-user deletion is attempted", async () => {
    const db = database as unknown as D1Database;
    await attachAuthIdentity(db, "auth-1", "linksim-1");
    expect(() => database.db.prepare("DELETE FROM auth_user WHERE id = ?").run("auth-1")).toThrow(/FOREIGN KEY/);
    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").get())
      .toEqual({ auth_user_id: "auth-1", linksim_user_id: "linksim-1" });
  });

  it("attaches an auth user to the existing LinkSim ID and is idempotent", async () => {
    const db = database as unknown as D1Database;
    await expect(attachAuthIdentity(db, "auth-1", "linksim-1", "2026-09-19T12:00:00.000Z"))
      .resolves.toEqual({ authUserId: "auth-1", linksimUserId: "linksim-1", created: true });
    await expect(attachAuthIdentity(db, "auth-1", "linksim-1", "2026-09-19T12:01:00.000Z"))
      .resolves.toEqual({ authUserId: "auth-1", linksimUserId: "linksim-1", created: false });
    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").all())
      .toEqual([{ auth_user_id: "auth-1", linksim_user_id: "linksim-1" }]);
  });

  it("rejects conflicts in both mapping directions with stable typed codes", async () => {
    const db = database as unknown as D1Database;
    await attachAuthIdentity(db, "auth-1", "linksim-1");
    await expect(attachAuthIdentity(db, "auth-1", "linksim-2")).rejects.toMatchObject<AuthIdentityMapConflictError>({
      name: "AuthIdentityMapConflictError", code: "AUTH_USER_ALREADY_MAPPED",
    });
    await expect(attachAuthIdentity(db, "auth-2", "linksim-1")).rejects.toMatchObject<AuthIdentityMapConflictError>({
      name: "AuthIdentityMapConflictError", code: "LINKSIM_USER_ALREADY_MAPPED",
    });
  });

  it("requires an auth user and an active, non-tombstoned LinkSim user", async () => {
    const db = database as unknown as D1Database;
    await expect(attachAuthIdentity(db, "missing", "linksim-1")).rejects.toMatchObject<AuthIdentityMapEligibilityError>({
      code: "AUTH_USER_NOT_FOUND",
    });
    await expect(attachAuthIdentity(db, "auth-1", "missing")).rejects.toMatchObject<AuthIdentityMapEligibilityError>({
      code: "LINKSIM_USER_NOT_FOUND",
    });
    database.db.prepare("INSERT INTO deleted_users (id, deleted_at) VALUES (?, ?)")
      .run("linksim-1", "2026-09-19T00:00:00.000Z");
    await expect(attachAuthIdentity(db, "auth-1", "linksim-1")).rejects.toMatchObject<AuthIdentityMapEligibilityError>({
      code: "LINKSIM_USER_INELIGIBLE",
    });
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, created_at, updated_at) VALUES (?, 'blocked', ?, ?)`)
      .run("linksim-2", "2026-09-19T00:00:00.000Z", "2026-09-19T00:00:00.000Z");
    await expect(attachAuthIdentity(db, "auth-2", "linksim-2")).rejects.toMatchObject<AuthIdentityMapEligibilityError>({
      code: "LINKSIM_USER_INELIGIBLE",
    });
  });

  it("looks up mappings in both directions without changing either ID", async () => {
    const db = database as unknown as D1Database;
    await attachAuthIdentity(db, "auth-1", "linksim-1");
    await expect(findAuthIdentityByAuthUserId(db, "auth-1")).resolves.toEqual({
      authUserId: "auth-1", linksimUserId: "linksim-1",
    });
    await expect(findAuthIdentityByLinkSimUserId(db, "linksim-1")).resolves.toEqual({
      authUserId: "auth-1", linksimUserId: "linksim-1",
    });
    await expect(findAuthIdentityByAuthUserId(db, "missing")).resolves.toBeNull();
    await expect(findAuthIdentityByLinkSimUserId(db, "missing")).resolves.toBeNull();
  });

  it("resolves only mappings to a current live LinkSim account", async () => {
    const db = database as unknown as D1Database;
    await attachAuthIdentity(db, "auth-1", "linksim-1");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toEqual({
      authUserId: "auth-1", linksimUserId: "linksim-1",
    });

    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, created_at, updated_at) VALUES (?, 'blocked', ?, ?)`)
      .run("linksim-1", "2026-09-19T00:00:00.000Z", "2026-09-19T00:00:00.000Z");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toBeNull();

    database.db.prepare("UPDATE identity_subject_states SET status = 'superseded' WHERE user_id = ?")
      .run("linksim-1");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toBeNull();

    database.db.prepare("UPDATE identity_subject_states SET status = 'current' WHERE user_id = ?")
      .run("linksim-1");
    database.db.prepare("INSERT INTO deleted_users (id, deleted_at) VALUES (?, ?)")
      .run("linksim-1", "2026-09-19T00:00:00.000Z");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toBeNull();
  });

  it("rejects pending and revoked application accounts", async () => {
    const db = database as unknown as D1Database;
    await attachAuthIdentity(db, "auth-1", "linksim-1");
    database.db.prepare(
      "UPDATE users SET is_approved = 0, approved_by_user_id = NULL WHERE id = ?",
    ).run("linksim-1");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toBeNull();

    database.db.prepare(
      "UPDATE users SET approved_by_user_id = 'revoked:administrator' WHERE id = ?",
    ).run("linksim-1");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toBeNull();

    database.db.prepare(
      "UPDATE users SET is_admin = 1 WHERE id = ?",
    ).run("linksim-1");
    await expect(resolveCurrentAuthIdentity(db, "auth-1")).resolves.toEqual({
      authUserId: "auth-1", linksimUserId: "linksim-1",
    });
  });

  it("has one winner when concurrent claims target the same LinkSim user", async () => {
    const db = database as unknown as D1Database;
    const results = await Promise.allSettled([
      attachAuthIdentity(db, "auth-1", "linksim-1"),
      attachAuthIdentity(db, "auth-2", "linksim-1"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
  });

  it("treats concurrent claims for the same pair as one creation and one idempotent result", async () => {
    const db = database as unknown as D1Database;
    const results = await Promise.all([
      attachAuthIdentity(db, "auth-1", "linksim-1"),
      attachAuthIdentity(db, "auth-1", "linksim-1"),
    ]);
    expect(results.map(result => result.created).sort()).toEqual([false, true]);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
  });
});
