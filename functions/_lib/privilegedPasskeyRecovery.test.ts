import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  LegacyAuthMigrationError,
  bindPrivilegedPasskeyRecoveryUser,
  claimPrivilegedPasskeyRecovery,
  completePrivilegedPasskeyRecovery,
  resolvePendingPrivilegedPasskeyRecoveryForAuthUser,
  resolvePrivilegedPasskeyRecovery,
} from "./authIdentityMap";
import { SqliteD1 } from "./testSqliteD1";

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), `db/migrations/${name}`), "utf8");
const attemptId = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
const authorizationId = "67eef596-ce53-4c91-918d-54f200cabee9";
const now = "2026-09-23T10:05:00.000Z";

describe("privileged passkey recovery", () => {
  let database: SqliteD1;
  let db: D1Database;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(readMigration("2026-09-19_better_auth_schema.sql"));
    database.db.exec(readMigration("2026-09-21_auth_migration_attempt.sql"));
    database.db.exec(readMigration("2026-09-23_privileged_passkey_recovery.sql"));
    database.db.prepare(`INSERT INTO users
      (id, username, is_admin, is_approved, created_at, updated_at)
      VALUES ('legacy-admin', 'admin', 1, 1, ?, ?)` ).run(now, now);
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('legacy-admin', 'current', 'legacy-admin', 1, ?, ?)` ).run(now, now);
    database.db.prepare(`INSERT INTO auth_privileged_passkey_recovery
      (id, linksim_user_id, expected_access_subject, created_by, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', 'operator:wilhel1812', ?, ?)`)
      .run(authorizationId, now, "2026-09-23T10:20:00.000Z");
    database.db.prepare(`INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', ?, ?, ?)`)
      .run(attemptId, now, now, "2026-09-23T10:15:00.000Z");
    db = database as unknown as D1Database;
  });

  it("claims the exact authorized Access attempt and completes one passkey identity", async () => {
    await expect(claimPrivilegedPasskeyRecovery(db, { attemptId, now }))
      .resolves.toEqual({ attemptId, linksimUserId: "legacy-admin" });

    database.db.prepare(`INSERT INTO auth_user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('auth-passkey', 'legacy-admin', 'auth-passkey@passkey.linksim.invalid', 0, ?, ?)`)
      .run(now, now);
    await expect(bindPrivilegedPasskeyRecoveryUser(db, { attemptId, authUserId: "auth-passkey", now }))
      .resolves.toEqual({ attemptId, authUserId: "auth-passkey", linksimUserId: "legacy-admin" });
    await expect(resolvePrivilegedPasskeyRecovery(db, attemptId, now))
      .resolves.toMatchObject({ authUserId: "auth-passkey", linksimUserId: "legacy-admin" });
    await expect(resolvePendingPrivilegedPasskeyRecoveryForAuthUser(db, "auth-passkey", now))
      .resolves.toMatchObject({ attemptId, authUserId: "auth-passkey", linksimUserId: "legacy-admin" });
    await expect(completePrivilegedPasskeyRecovery(db, { attemptId, authUserId: "auth-passkey", now }))
      .resolves.toEqual({ authUserId: "auth-passkey", linksimUserId: "legacy-admin" });
    await expect(resolvePendingPrivilegedPasskeyRecoveryForAuthUser(db, "auth-passkey", now))
      .resolves.toBeNull();

    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").get())
      .toEqual({ auth_user_id: "auth-passkey", linksim_user_id: "legacy-admin" });
    expect(database.db.prepare(`SELECT consumed_at FROM auth_privileged_passkey_recovery
      WHERE id = ?`).get(authorizationId)).toEqual({ consumed_at: now });
    expect(database.db.prepare(`SELECT event_type, target_user_id FROM user_identity_audit
      WHERE event_type = 'better_auth_privileged_passkey_recovery'`).get())
      .toEqual({ event_type: "better_auth_privileged_passkey_recovery", target_user_id: "legacy-admin" });
  });

  it("rejects a revoked authorization before creating an auth identity", async () => {
    database.db.prepare(`UPDATE auth_privileged_passkey_recovery
      SET revoked_at = ? WHERE id = ?`).run(now, authorizationId);
    await expect(claimPrivilegedPasskeyRecovery(db, { attemptId, now }))
      .rejects.toMatchObject<LegacyAuthMigrationError>({ code: "LEGACY_IDENTITY_INELIGIBLE" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
  });

  it("is idempotent only for the exact recovered pair and rejects replay with another identity", async () => {
    await claimPrivilegedPasskeyRecovery(db, { attemptId, now });
    for (const id of ["auth-passkey", "auth-other"]) {
      database.db.prepare(`INSERT INTO auth_user
        (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, 0, ?, ?)`)
        .run(id, id, `${id}@passkey.linksim.invalid`, now, now);
    }
    await bindPrivilegedPasskeyRecoveryUser(db, { attemptId, authUserId: "auth-passkey", now });
    await completePrivilegedPasskeyRecovery(db, { attemptId, authUserId: "auth-passkey", now });
    await expect(completePrivilegedPasskeyRecovery(db, { attemptId, authUserId: "auth-passkey", now }))
      .resolves.toEqual({ authUserId: "auth-passkey", linksimUserId: "legacy-admin" });
    await expect(bindPrivilegedPasskeyRecoveryUser(db, { attemptId, authUserId: "auth-other", now }))
      .rejects.toMatchObject<LegacyAuthMigrationError>({ code: "ATTEMPT_IDENTITY_MISMATCH" });
  });
});
