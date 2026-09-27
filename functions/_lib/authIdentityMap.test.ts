import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AuthIdentityMapConflictError,
  AuthIdentityMapEligibilityError,
  LegacyAuthMigrationError,
  attachAuthIdentity,
  bindLegacyAuthMigrationAttempt,
  completeLegacyAuthMigrationAttempt,
  createLegacyAuthMigrationAttempt,
  findAuthIdentityByAuthUserId,
  findAuthIdentityByLinkSimUserId,
  isPendingLegacyAuthMigrationAttempt,
  resolveCurrentAuthIdentity,
} from "./authIdentityMap";
import { SqliteD1 } from "./testSqliteD1";
import { executeIdentityDelete } from "./db";

const migration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql"),
  "utf8",
);
const attemptMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-21_auth_migration_attempt.sql"),
  "utf8",
);
const privilegedRecoveryMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-23_privileged_passkey_recovery.sql"),
  "utf8",
);

describe("auth identity mapping", () => {
  let database: SqliteD1;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(migration);
    database.db.exec(attemptMigration);
    database.db.exec(privilegedRecoveryMigration);
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
      database.db.prepare(`INSERT INTO auth_account
        (id, accountId, providerId, userId, createdAt, updatedAt)
        VALUES (?, ?, 'github', ?, ?, ?)`).run(
          `account-${id}`, id === "auth-1" ? "1001" : "1002", id,
          new Date(0).toISOString(), new Date(0).toISOString(),
        );
    }
  });

  it("installs the reviewed namespaced schema idempotently with unique mappings", () => {
    expect(() => database.db.exec(migration)).not.toThrow();
    const tables = database.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%' ORDER BY name",
    ).all().map(row => row.name);
    expect(tables).toEqual([
      "auth_account", "auth_identity_map", "auth_migration_attempt", "auth_passkey",
      "auth_privileged_passkey_recovery", "auth_rate_limit",
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

  it("creates, binds, and atomically consumes a short-lived migration attempt", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES (?, 'current', ?, 1, ?, ?)`).run(
        "linksim-1", "linksim-1", "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await expect(createLegacyAuthMigrationAttempt(db, {
      attemptId: "attempt-1",
      legacyUserId: "linksim-1",
      accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z",
      now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    })).resolves.toEqual({ attemptId: "attempt-1", expiresAt: "2026-09-21T10:10:01.000Z" });
    await expect(isPendingLegacyAuthMigrationAttempt(
      db, "attempt-1", "2026-09-21T10:05:00.000Z",
    )).resolves.toBe(true);
    await expect(bindLegacyAuthMigrationAttempt(
      db, "attempt-1", "auth-1", "2026-09-21T10:05:00.000Z",
    )).resolves.toEqual({ attemptId: "attempt-1", authUserId: "auth-1" });
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "attempt-1",
      authUserId: "auth-1",
      now: "2026-09-21T10:06:00.000Z",
    })).resolves.toEqual({ authUserId: "auth-1", linksimUserId: "linksim-1" });
    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").get())
      .toEqual({ auth_user_id: "auth-1", linksim_user_id: "linksim-1" });
    expect(database.db.prepare(`SELECT event_type, target_user_id, actor_user_id
      FROM user_identity_audit WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({
        event_type: "better_auth_dual_login", target_user_id: "linksim-1", actor_user_id: "linksim-1",
      });
  });

  it("rejects privileged passkey recovery attempts from every GitHub migration operation", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "recovery-attempt",
      legacyUserId: "linksim-1",
      accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z",
      now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    database.db.prepare(`INSERT INTO auth_privileged_passkey_recovery
      (id, linksim_user_id, expected_access_subject, migration_attempt_id,
        browser_token, created_by, created_at, expires_at, started_at)
      VALUES ('recovery-authorization', 'linksim-1', 'linksim-1', 'recovery-attempt',
        'browser-token', 'test', '2026-09-21T10:00:00.000Z',
        '2026-09-21T10:10:01.000Z', '2026-09-21T10:00:01.000Z')`).run();

    await expect(isPendingLegacyAuthMigrationAttempt(
      db, "recovery-attempt", "2026-09-21T10:05:00.000Z",
    )).resolves.toBe(false);
    await expect(bindLegacyAuthMigrationAttempt(
      db, "recovery-attempt", "auth-1", "2026-09-21T10:05:00.000Z",
    )).rejects.toMatchObject({ code: "AUTH_IDENTITY_INELIGIBLE" });
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "recovery-attempt",
      authUserId: "auth-1",
      now: "2026-09-21T10:06:00.000Z",
    })).rejects.toMatchObject({ code: "AUTH_IDENTITY_INELIGIBLE" });
    expect(database.db.prepare(`SELECT auth_user_id, consumed_at, completion_token
      FROM auth_migration_attempt WHERE id = 'recovery-attempt'`).get()).toEqual({
        auth_user_id: null, consumed_at: null, completion_token: null,
      });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get())
      .toEqual({ count: 0 });
  });

  it("replays the attempt migration without changing its schema", () => {
    expect(() => database.db.exec(attemptMigration)).not.toThrow();
    expect(database.db.prepare("PRAGMA index_list(auth_migration_attempt)").all()
      .map(row => row.name).filter(name => String(name).startsWith("auth_migration")))
      .toEqual(expect.arrayContaining([
        "auth_migration_attempt_expiry_idx",
        "auth_migration_attempt_auth_user_idx",
      ]));
  });

  it("keeps a pending attempt retryable after the browser abandons OAuth", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "retry-after-cancel", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await expect(isPendingLegacyAuthMigrationAttempt(
      db, "retry-after-cancel", "2026-09-21T10:04:00.000Z",
    )).resolves.toBe(true);
    await bindLegacyAuthMigrationAttempt(db, "retry-after-cancel", "auth-1", "2026-09-21T10:05:00.000Z");
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "retry-after-cancel", authUserId: "auth-1", now: "2026-09-21T10:06:00.000Z",
      completionToken: "retry-completion",
    })).resolves.toEqual({ authUserId: "auth-1", linksimUserId: "linksim-1" });
  });

  it("consumes a new attempt when the exact auth and LinkSim identities are already mapped", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await attachAuthIdentity(db, "auth-1", "linksim-1", "2026-09-21T10:00:00.000Z");
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "already-mapped", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(db, "already-mapped", "auth-1", "2026-09-21T10:01:00.000Z");

    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "already-mapped", authUserId: "auth-1", now: "2026-09-21T10:02:00.000Z",
      completionToken: "already-mapped-completion",
    })).resolves.toEqual({ authUserId: "auth-1", linksimUserId: "linksim-1" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
    expect(database.db.prepare(`SELECT consumed_at, completion_token FROM auth_migration_attempt
      WHERE id = 'already-mapped'`).get()).toEqual({
        consumed_at: "2026-09-21T10:02:00.000Z",
        completion_token: "already-mapped-completion",
      });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 1 });
  });

  it("allows only one same-timestamp completion and audit event", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "concurrent", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(db, "concurrent", "auth-1", "2026-09-21T10:01:00.000Z");
    const results = await Promise.allSettled([
      completeLegacyAuthMigrationAttempt(db, {
        attemptId: "concurrent", authUserId: "auth-1", now: "2026-09-21T10:02:00.000Z",
        completionToken: "winner-a",
      }),
      completeLegacyAuthMigrationAttempt(db, {
        attemptId: "concurrent", authUserId: "auth-1", now: "2026-09-21T10:02:00.000Z",
        completionToken: "winner-b",
      }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 1 });
    expect(database.db.prepare(`SELECT consumed_at, completion_token FROM auth_migration_attempt
      WHERE id = 'concurrent'`).get()).toEqual({
        consumed_at: "2026-09-21T10:02:00.000Z",
        completion_token: expect.stringMatching(/^winner-[ab]$/),
      });
  });

  it("reports a conflicting mapping created after the completion precheck", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "racing-conflict", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(db, "racing-conflict", "auth-1", "2026-09-21T10:01:00.000Z");
    database.beforeBatch = () => {
      database.db.prepare(`INSERT INTO auth_identity_map
        (auth_user_id, linksim_user_id, created_at) VALUES (?, ?, ?)`).run(
          "auth-2", "linksim-1", "2026-09-21T10:01:30.000Z",
        );
    };

    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "racing-conflict", authUserId: "auth-1", now: "2026-09-21T10:02:00.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "IDENTITY_CONFLICT" });
    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").get())
      .toEqual({ auth_user_id: "auth-2", linksim_user_id: "linksim-1" });
    expect(database.db.prepare(`SELECT consumed_at FROM auth_migration_attempt
      WHERE id = 'racing-conflict'`).get()).toEqual({ consumed_at: null });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 0 });
  });

  it("keeps an exact existing mapping retryable after a completion batch failure", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await attachAuthIdentity(db, "auth-1", "linksim-1", "2026-09-21T10:00:00.000Z");
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "exact-batch-failure", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(
      db, "exact-batch-failure", "auth-1", "2026-09-21T10:01:00.000Z",
    );
    database.db.exec(`CREATE TRIGGER reject_dual_login_audit
      BEFORE INSERT ON user_identity_audit
      WHEN NEW.event_type = 'better_auth_dual_login'
      BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);

    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "exact-batch-failure", authUserId: "auth-1", now: "2026-09-21T10:02:00.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "MIGRATION_FAILED" });
    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").get())
      .toEqual({ auth_user_id: "auth-1", linksim_user_id: "linksim-1" });
    expect(database.db.prepare(`SELECT consumed_at FROM auth_migration_attempt
      WHERE id = 'exact-batch-failure'`).get()).toEqual({ consumed_at: null });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 0 });
  });

  it.each(["pending", "expired", "consumed"])(
    "does not block real account deletion for a %s migration attempt",
    async (state) => {
      const db = database as unknown as D1Database;
      database.db.prepare(`INSERT INTO identity_subject_states
        (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
        VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
          "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
        );
      await createLegacyAuthMigrationAttempt(db, {
        attemptId: `delete-${state}`, legacyUserId: "linksim-1", accessSubject: "linksim-1",
        accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
        expiresAt: "2026-09-21T10:10:01.000Z",
      });
      if (state === "consumed") {
        await bindLegacyAuthMigrationAttempt(db, `delete-${state}`, "auth-1", "2026-09-21T10:01:00.000Z");
        await completeLegacyAuthMigrationAttempt(db, {
          attemptId: `delete-${state}`, authUserId: "auth-1", now: "2026-09-21T10:02:00.000Z",
          completionToken: "delete-completion",
        });
      }
      await executeIdentityDelete(
        { DB: db }, "linksim-1", "linksim-2", "2026-09-21T10:20:00.000Z",
      );
      expect(database.db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'linksim-1'").get())
        .toEqual({ count: 0 });
      expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_migration_attempt").get())
        .toEqual({ count: 0 });
    },
  );

  it("does not block deletion of an unmapped Better Auth user bound to an attempt", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "delete-auth-user", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(db, "delete-auth-user", "auth-1", "2026-09-21T10:01:00.000Z");
    expect(() => database.db.prepare("DELETE FROM auth_user WHERE id = 'auth-1'").run()).not.toThrow();
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_migration_attempt").get())
      .toEqual({ count: 0 });
  });

  it("fails closed for expiry, replay, a different bound auth user, and both mapping conflicts", async () => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES (?, 'current', ?, 1, ?, ?)`).run(
        "linksim-1", "linksim-1", "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    const create = (id: string) => createLegacyAuthMigrationAttempt(db, {
      attemptId: id, legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await create("expired");
    await expect(bindLegacyAuthMigrationAttempt(
      db, "expired", "auth-1", "2026-09-21T10:11:00.000Z",
    )).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "ATTEMPT_EXPIRED" });

    await create("bound");
    await bindLegacyAuthMigrationAttempt(db, "bound", "auth-1", "2026-09-21T10:05:00.000Z");
    await expect(bindLegacyAuthMigrationAttempt(
      db, "bound", "auth-1", "2026-09-21T10:05:00.500Z",
    )).resolves.toEqual({ attemptId: "bound", authUserId: "auth-1" });
    await expect(bindLegacyAuthMigrationAttempt(
      db, "bound", "auth-2", "2026-09-21T10:05:01.000Z",
    )).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "ATTEMPT_IDENTITY_MISMATCH" });
    await completeLegacyAuthMigrationAttempt(db, {
      attemptId: "bound", authUserId: "auth-1", now: "2026-09-21T10:06:00.000Z",
    });
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "bound", authUserId: "auth-1", now: "2026-09-21T10:06:01.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "ATTEMPT_CONSUMED" });

    database.db.prepare("DELETE FROM auth_identity_map").run();
    await create("auth-conflict");
    await bindLegacyAuthMigrationAttempt(db, "auth-conflict", "auth-1", "2026-09-21T10:05:00.000Z");
    await attachAuthIdentity(db, "auth-1", "linksim-2");
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "auth-conflict", authUserId: "auth-1", now: "2026-09-21T10:06:00.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "IDENTITY_CONFLICT" });

    database.db.prepare("DELETE FROM auth_identity_map").run();
    await create("linksim-conflict");
    await bindLegacyAuthMigrationAttempt(db, "linksim-conflict", "auth-1", "2026-09-21T10:05:00.000Z");
    await attachAuthIdentity(db, "auth-2", "linksim-1");
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "linksim-conflict", authUserId: "auth-1", now: "2026-09-21T10:06:00.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "IDENTITY_CONFLICT" });
  });

  it.each([
    ["blocked", "UPDATE identity_subject_states SET status = 'blocked' WHERE user_id = 'linksim-1'"],
    ["superseded", "UPDATE identity_subject_states SET status = 'superseded' WHERE user_id = 'linksim-1'"],
    ["deleted", "INSERT INTO deleted_users (id, deleted_at) VALUES ('linksim-1', '2026-09-21T10:02:00.000Z')"],
    ["revoked", "UPDATE users SET is_approved = 0, approved_by_user_id = 'revoked:admin' WHERE id = 'linksim-1'"],
  ])("rolls back completion when the legacy account becomes %s", async (_state, mutation) => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "attempt-state", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(db, "attempt-state", "auth-1", "2026-09-21T10:01:00.000Z");
    database.db.exec(mutation);
    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "attempt-state", authUserId: "auth-1", now: "2026-09-21T10:03:00.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "LEGACY_IDENTITY_INELIGIBLE" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
    expect(database.db.prepare("SELECT consumed_at FROM auth_migration_attempt WHERE id = 'attempt-state'").get())
      .toEqual({ consumed_at: null });
  });

  it.each([
    ["blocked", "UPDATE identity_subject_states SET status = 'blocked' WHERE user_id = 'linksim-1'"],
    ["superseded", "UPDATE identity_subject_states SET status = 'superseded' WHERE user_id = 'linksim-1'"],
    ["deleted", "INSERT INTO deleted_users (id, deleted_at) VALUES ('linksim-1', '2026-09-21T10:02:00.000Z')"],
    ["revoked", "UPDATE users SET is_approved = 0, approved_by_user_id = 'revoked:admin' WHERE id = 'linksim-1'"],
  ])("rejects a new attempt when an already-mapped account becomes %s", async (_state, mutation) => {
    const db = database as unknown as D1Database;
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('linksim-1', 'current', 'linksim-1', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    await attachAuthIdentity(db, "auth-1", "linksim-1", "2026-09-21T10:00:00.000Z");
    await createLegacyAuthMigrationAttempt(db, {
      attemptId: "already-mapped-state", legacyUserId: "linksim-1", accessSubject: "linksim-1",
      accessIssuedAt: "2026-09-21T10:00:00.000Z", now: "2026-09-21T10:00:01.000Z",
      expiresAt: "2026-09-21T10:10:01.000Z",
    });
    await bindLegacyAuthMigrationAttempt(
      db, "already-mapped-state", "auth-1", "2026-09-21T10:01:00.000Z",
    );
    database.db.exec(mutation);

    await expect(completeLegacyAuthMigrationAttempt(db, {
      attemptId: "already-mapped-state", authUserId: "auth-1", now: "2026-09-21T10:03:00.000Z",
    })).rejects.toMatchObject<LegacyAuthMigrationError>({ code: "LEGACY_IDENTITY_INELIGIBLE" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
    expect(database.db.prepare(`SELECT consumed_at FROM auth_migration_attempt
      WHERE id = 'already-mapped-state'`).get()).toEqual({ consumed_at: null });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 0 });
  });
});
