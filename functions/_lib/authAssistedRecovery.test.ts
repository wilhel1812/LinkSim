import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { assistAuthIdentityRecovery, AuthAssistedRecoveryError } from "./authAssistedRecovery";
import { SqliteD1 } from "./testSqliteD1";

const authMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql"),
  "utf8",
);

describe("assisted auth identity recovery", () => {
  let database: SqliteD1;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(authMigration);
    database.db.exec(`
      INSERT INTO users (id, username, is_admin, is_approved, approved_by_user_id, created_at)
      VALUES ('admin', 'admin', 1, 1, 'bootstrap', '2026-09-21T00:00:00.000Z');
      INSERT INTO identity_subject_states
        (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('admin', 'admin@example.invalid', 'current', 'admin', 1, '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
      INSERT INTO users (id, username, is_admin, is_approved, approved_by_user_id, created_at)
      VALUES ('legacy', 'legacy', 0, 1, 'bootstrap', '2026-09-21T00:00:00.000Z');
      INSERT INTO identity_subject_states
        (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('legacy', 'legacy@example.invalid', 'current', 'legacy', 1, '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
      INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('auth-new', 'new', 'different@example.invalid', 1, '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
      INSERT INTO auth_account (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('account-new', '123456', 'github', 'auth-new', '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
    `);
  });

  it("atomically maps an eligible account and records independent evidence", async () => {
    await expect(assistAuthIdentityRecovery(database as unknown as D1Database, {
      actorUserId: "admin",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "account-history",
      evidenceSummary: "Maintainer compared private resource history and the original provider account ID.",
      now: "2026-09-21T12:00:00.000Z",
    })).resolves.toEqual({ authUserId: "auth-new", linksimUserId: "legacy" });

    expect(database.db.prepare("SELECT auth_user_id, linksim_user_id FROM auth_identity_map").get()).toEqual({
      auth_user_id: "auth-new",
      linksim_user_id: "legacy",
    });
    const audit = database.db.prepare(`SELECT event_type, target_user_id, actor_user_id, idp_email, details_json
      FROM user_identity_audit`).get() as Record<string, string | null>;
    expect(audit).toMatchObject({
      event_type: "better_auth_assisted_recovery",
      target_user_id: "legacy",
      actor_user_id: "admin",
      idp_email: null,
    });
    expect(JSON.parse(String(audit.details_json))).toEqual({
      authUserId: "auth-new",
      evidenceType: "account-history",
      evidenceSummary: "Maintainer compared private resource history and the original provider account ID.",
      outcome: "mapped",
    });
  });

  it("creates one mapping and one audit for same-timestamp concurrent recovery", async () => {
    const input = {
      actorUserId: "admin",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "provider-proof",
      evidenceSummary: "Verified the stable GitHub account ID through an authenticated support exchange.",
      now: "2026-09-21T12:00:00.000Z",
    };
    const results = await Promise.allSettled([
      assistAuthIdentityRecovery(database as unknown as D1Database, input),
      assistAuthIdentityRecovery(database as unknown as D1Database, input),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_assisted_recovery'`).get()).toEqual({ count: 1 });
  });

  it("rejects email-only evidence and non-admin actors without writing", async () => {
    await expect(assistAuthIdentityRecovery(database as unknown as D1Database, {
      actorUserId: "admin",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "other",
      evidenceSummary: "legacy@example.invalid",
    })).rejects.toMatchObject<AuthAssistedRecoveryError>({ code: "EVIDENCE_INSUFFICIENT" });
    await expect(assistAuthIdentityRecovery(database as unknown as D1Database, {
      actorUserId: "legacy",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "account-history",
      evidenceSummary: "Verified private resource creation history against retained audit records.",
    })).rejects.toMatchObject<AuthAssistedRecoveryError>({ code: "ACTOR_FORBIDDEN" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM user_identity_audit").get()).toEqual({ count: 0 });
  });

  it.each([
    "Bearer abcdefghijklmnopqrstuvwxyz012345",
    "CF_Authorization=abcdefghijklmnopqrstuvwxyz0123456789",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signaturevalue",
    ["github", "_pat_", "abcdefghijklmnopqrstuvwxyz012345"].join(""),
    ["-----BEGIN ", "PRIVATE KEY----- pasted material"].join(""),
    "Passkey credentialID abcdefghijklmnopqrstuvwxyz",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
  ])("rejects credential-shaped evidence before persistence", async (evidenceSummary) => {
    await expect(assistAuthIdentityRecovery(database as unknown as D1Database, {
      actorUserId: "admin",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "other",
      evidenceSummary,
    })).rejects.toMatchObject<AuthAssistedRecoveryError>({ code: "EVIDENCE_INSUFFICIENT" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM user_identity_audit").get()).toEqual({ count: 0 });
  });

  it("fails closed for mapping conflicts and ineligible account state", async () => {
    database.db.prepare(`INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
      VALUES ('auth-new', 'admin', '2026-09-21T00:00:00.000Z')`).run();
    await expect(assistAuthIdentityRecovery(database as unknown as D1Database, {
      actorUserId: "admin",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "provider-proof",
      evidenceSummary: "Verified the stable GitHub account ID through an authenticated support exchange.",
    })).rejects.toMatchObject<AuthAssistedRecoveryError>({ code: "IDENTITY_CONFLICT" });

    database.db.prepare("DELETE FROM auth_identity_map").run();
    database.db.prepare("UPDATE identity_subject_states SET status = 'blocked' WHERE user_id = 'legacy'").run();
    await expect(assistAuthIdentityRecovery(database as unknown as D1Database, {
      actorUserId: "admin",
      authUserId: "auth-new",
      linksimUserId: "legacy",
      evidenceType: "resource-ownership",
      evidenceSummary: "Verified private resource payload details unavailable to the public.",
    })).rejects.toMatchObject<AuthAssistedRecoveryError>({ code: "IDENTITY_INELIGIBLE" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM user_identity_audit").get()).toEqual({ count: 0 });
  });
});
