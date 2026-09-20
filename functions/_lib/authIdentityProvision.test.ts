import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AuthIdentityProvisionError,
  provisionAuthIdentity,
} from "./authIdentityMap";
import { SqliteD1 } from "./testSqliteD1";

const migration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql"),
  "utf8",
);
const BEFORE_DEADLINE = "2026-12-19T23:59:59.998Z";
const DEADLINE = "2026-12-19T23:59:59.999Z";
const AFTER_DEADLINE = "2026-12-20T00:00:00.000Z";

describe("Better Auth identity provisioning", () => {
  let database: SqliteD1;

  const addAuthIdentity = (input: {
    authUserId?: string;
    accountId?: string;
    email?: string;
    verified?: number;
    providerId?: string;
  } = {}) => {
    const authUserId = input.authUserId ?? "auth-1";
    database.db.prepare(`INSERT INTO auth_user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      authUserId,
      "GitHub User",
      input.email ?? "ordinary@example.org",
      input.verified ?? 1,
      BEFORE_DEADLINE,
      BEFORE_DEADLINE,
    );
    database.db.prepare(`INSERT INTO auth_account
      (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      `account-${authUserId}`,
      input.accountId ?? "12345",
      input.providerId ?? "github",
      authUserId,
      BEFORE_DEADLINE,
      BEFORE_DEADLINE,
    );
  };

  const addLegacyClaim = (input: {
    userId?: string;
    email?: string;
    claimStatus?: "active" | "blocked";
    subjectStatus?: "current" | "superseded" | "blocked";
    canonicalUserId?: string | null;
    approved?: number;
    admin?: number;
    moderator?: number;
    approvedBy?: string | null;
    deleted?: boolean;
  } = {}) => {
    const userId = input.userId ?? "legacy-user";
    const email = input.email ?? "ordinary@example.org";
    database.db.prepare(`INSERT INTO users
      (id, username, email, idp_email, idp_email_verified, is_admin, is_moderator,
       is_approved, approved_at, approved_by_user_id, created_at, updated_at)
      VALUES (?, 'legacy-name', 'public@example.net', ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        userId,
        email,
        input.admin ?? 0,
        input.moderator ?? 0,
        input.approved ?? 1,
        BEFORE_DEADLINE,
        input.approvedBy ?? "system:open-registration",
        "2026-01-01T00:00:00.000Z",
        "2026-06-01T00:00:00.000Z",
      );
    database.db.prepare(`INSERT INTO verified_identity_claims
      (normalized_email, current_user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(
      email,
      userId,
      input.claimStatus ?? "active",
      "2026-01-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)`).run(
      userId,
      email,
      input.subjectStatus ?? "current",
      input.canonicalUserId === undefined ? userId : input.canonicalUserId,
      "2026-01-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );
    if (input.deleted) {
      database.db.prepare("INSERT INTO deleted_users (id, deleted_at) VALUES (?, ?)")
        .run(userId, "2026-07-01T00:00:00.000Z");
    }
  };

  const provision = (authUserId = "auth-1", now = BEFORE_DEADLINE) => provisionAuthIdentity(
    database as unknown as D1Database,
    { authUserId, now, legacyClaimDeadline: DEADLINE },
  );

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(migration);
  });

  it("claims one eligible ordinary legacy identity without changing its data", async () => {
    addAuthIdentity({ email: " Ordinary@Example.ORG " });
    addLegacyClaim();

    await expect(provision()).resolves.toEqual({
      authUserId: "auth-1",
      linksimUserId: "legacy-user",
      created: true,
      kind: "legacy-claim",
    });
    expect(database.db.prepare(`SELECT id, username, email, idp_email, is_approved,
      is_admin, is_moderator, created_at, updated_at FROM users WHERE id = 'legacy-user'`).get()).toEqual({
      id: "legacy-user",
      username: "legacy-name",
      email: "public@example.net",
      idp_email: "ordinary@example.org",
      is_approved: 1,
      is_admin: 0,
      is_moderator: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    });
    expect(database.db.prepare("SELECT event_type, target_user_id FROM user_identity_audit").get())
      .toEqual({ event_type: "better_auth_legacy_claim", target_user_id: "legacy-user" });
  });

  it("creates a fully independent, immediately approved ordinary account when no claim exists", async () => {
    addAuthIdentity({ accountId: "98765", email: "New.User@Example.ORG" });

    const result = await provision();
    expect(result.kind).toBe("registration");
    expect(result.linksimUserId).not.toBe("auth-1");
    expect(result.linksimUserId).not.toBe("98765");
    expect(database.db.prepare(`SELECT username, email, idp_email, idp_email_verified,
      is_admin, is_moderator, is_approved, approved_by_user_id FROM users WHERE id = ?`)
      .get(result.linksimUserId)).toEqual({
      username: "",
      email: "new.user@example.org",
      idp_email: "new.user@example.org",
      idp_email_verified: 1,
      is_admin: 0,
      is_moderator: 0,
      is_approved: 1,
      approved_by_user_id: "system:better-auth-registration",
    });
    expect(database.db.prepare("SELECT current_user_id, status FROM verified_identity_claims").get())
      .toEqual({ current_user_id: result.linksimUserId, status: "active" });
    expect(database.db.prepare("SELECT user_id, status, canonical_user_id, bootstrap_consumed FROM identity_subject_states").get())
      .toEqual({
        user_id: result.linksimUserId,
        status: "current",
        canonical_user_id: result.linksimUserId,
        bootstrap_consumed: 1,
      });
  });

  it.each([
    ["missing email", { email: "" }],
    ["unverified email", { verified: 0 }],
    ["wrong provider", { providerId: "gitlab" }],
    ["invalid GitHub subject", { accountId: "not-a-number" }],
  ])("rejects %s", async (_label, input) => {
    addAuthIdentity(input);
    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({
      name: "AuthIdentityProvisionError",
      code: "AUTH_IDENTITY_INELIGIBLE",
    });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
  });

  it.each([
    ["blocked claim", { claimStatus: "blocked" as const }],
    ["deleted user", { deleted: true }],
    ["superseded subject", { subjectStatus: "superseded" as const, canonicalUserId: "other" }],
    ["blocked subject", { subjectStatus: "blocked" as const }],
    ["administrator", { admin: 1 }],
    ["moderator", { moderator: 1 }],
    ["revoked user", { approved: 0, approvedBy: "revoked:administrator" }],
    ["pending user", { approved: 0, approvedBy: null }],
    ["inconsistent canonical identity", { canonicalUserId: "other" }],
  ])("fails closed for an existing %s", async (_label, input) => {
    addAuthIdentity();
    addLegacyClaim(input);
    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({
      code: "LEGACY_CLAIM_INELIGIBLE",
    });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
  });

  it("fails closed for mapping conflicts in either direction", async () => {
    addAuthIdentity();
    addAuthIdentity({ authUserId: "auth-2", accountId: "67890", email: "second@example.org" });
    addLegacyClaim();
    database.db.prepare(`INSERT INTO users (id, username, is_approved, created_at)
      VALUES ('other-linksim', 'other', 1, ?)`).run(BEFORE_DEADLINE);
    database.db.prepare(`INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
      VALUES ('auth-2', 'legacy-user', ?)`).run(BEFORE_DEADLINE);

    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({ code: "IDENTITY_CONFLICT" });
    database.db.prepare("DELETE FROM auth_identity_map").run();
    database.db.prepare(`INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
      VALUES ('auth-1', 'other-linksim', ?)`).run(BEFORE_DEADLINE);
    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({ code: "IDENTITY_CONFLICT" });
  });

  it("returns an existing current mapping idempotently", async () => {
    addAuthIdentity();
    addLegacyClaim();
    const first = await provision();
    await expect(provision()).resolves.toEqual({ ...first, created: false, kind: "existing" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM user_identity_audit").get()).toEqual({ count: 1 });
  });

  it("rechecks the exact verified GitHub identity inside the legacy-claim batch", async () => {
    addAuthIdentity();
    addLegacyClaim();
    database.beforeBatch = () => {
      database.db.prepare("UPDATE auth_user SET email = 'changed@example.org' WHERE id = 'auth-1'").run();
    };
    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({ code: "PROVISION_FAILED" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM user_identity_audit").get()).toEqual({ count: 0 });
  });

  it("rejects legacy claims after the deadline but still permits truly new registration", async () => {
    addAuthIdentity();
    addLegacyClaim();
    await expect(provision("auth-1", AFTER_DEADLINE)).rejects.toMatchObject<AuthIdentityProvisionError>({
      code: "LEGACY_CLAIM_EXPIRED",
    });

    database = new SqliteD1();
    database.db.exec(migration);
    addAuthIdentity({ email: "new@example.org" });
    await expect(provision("auth-1", AFTER_DEADLINE)).resolves.toMatchObject({ kind: "registration" });
  });

  it("allows only one winner for concurrent legacy claims and new registrations", async () => {
    addAuthIdentity();
    addLegacyClaim();
    const claims = await Promise.all([provision("auth-1"), provision("auth-1")]);
    expect(new Set(claims.map(result => result.linksimUserId))).toEqual(new Set(["legacy-user"]));
    expect(claims.filter(result => result.created)).toHaveLength(1);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });

    database = new SqliteD1();
    database.db.exec(migration);
    addAuthIdentity();
    const registrations = await Promise.all([provision("auth-1"), provision("auth-1")]);
    expect(new Set(registrations.map(result => result.linksimUserId)).size).toBe(1);
    expect(registrations.filter(result => result.created)).toHaveLength(1);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
  });

  it("rolls back an injected batch failure and succeeds on retry", async () => {
    addAuthIdentity({ email: "new@example.org" });
    database.db.exec(`CREATE TRIGGER fail_auth_audit BEFORE INSERT ON user_identity_audit
      BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;`);
    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({ code: "PROVISION_FAILED" });
    for (const table of ["users", "verified_identity_claims", "identity_subject_states", "auth_identity_map", "user_identity_audit"]) {
      expect(database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    database.db.exec("DROP TRIGGER fail_auth_audit");
    await expect(provision()).resolves.toMatchObject({ kind: "registration", created: true });
  });

  it.each([
    ["email verification", () => database.db.prepare("UPDATE auth_user SET emailVerified = 0 WHERE id = 'auth-1'").run()],
    ["GitHub account", () => database.db.prepare("UPDATE auth_account SET accountId = 'invalid' WHERE userId = 'auth-1'").run()],
    ["second GitHub account", () => database.db.prepare(`INSERT INTO auth_account
      (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('account-auth-1-second', '67890', 'github', 'auth-1', ?, ?)`)
      .run(BEFORE_DEADLINE, BEFORE_DEADLINE)],
    ["legacy evidence", () => database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('late-legacy', 'new@example.org', 'current', 'late-legacy', 1, ?, ?)`)
      .run(BEFORE_DEADLINE, BEFORE_DEADLINE)],
  ])("fails closed when %s changes immediately before a registration batch", async (_label, mutate) => {
    addAuthIdentity({ email: "new@example.org" });
    database.beforeBatch = mutate;
    await expect(provision()).rejects.toMatchObject<AuthIdentityProvisionError>({ code: "PROVISION_FAILED" });
    for (const table of ["users", "verified_identity_claims", "auth_identity_map", "user_identity_audit"]) {
      expect(database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    const applicationStates = database.db.prepare(
      "SELECT COUNT(*) AS count FROM identity_subject_states WHERE user_id != 'late-legacy'",
    ).get();
    expect(applicationStates).toEqual({ count: 0 });
  });

  it("enforces one auth account for each provider subject", () => {
    addAuthIdentity();
    database.db.prepare(`INSERT INTO auth_user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('auth-2', 'Second', 'second@example.org', 1, ?, ?)`).run(BEFORE_DEADLINE, BEFORE_DEADLINE);
    expect(() => database.db.prepare(`INSERT INTO auth_account
      (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('account-2', '12345', 'github', 'auth-2', ?, ?)`).run(BEFORE_DEADLINE, BEFORE_DEADLINE))
      .toThrow();
  });
});
