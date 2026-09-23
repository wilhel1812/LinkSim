import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteD1 } from "../../../_lib/testSqliteD1";
import { handleLegacyAccessStart } from "./start";
import { onRequestPost as complete } from "./complete";

const betterAuthMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql"), "utf8",
);
const attemptMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-21_auth_migration_attempt.sql"), "utf8",
);
const privilegedRecoveryMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/2026-09-23_privileged_passkey_recovery.sql"), "utf8",
);
const attemptId = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
const browserToken = "4bf8f550-f6b4-428e-98bc-6f8a1ccf4efa";

describe("legacy Access migration routes", () => {
  let database: SqliteD1;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(betterAuthMigration);
    database.db.exec(attemptMigration);
    database.db.exec(privilegedRecoveryMigration);
    database.db.prepare(`INSERT INTO users
      (id, username, is_admin, is_approved, created_at, updated_at)
      VALUES ('legacy-admin', 'admin', 1, 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('legacy-admin', 'current', 'legacy-admin', 1, ?, ?)`).run(
        "2026-09-21T10:00:00.000Z", "2026-09-21T10:00:00.000Z",
      );
  });

  it("fails closed when the dual-login rollout gate is not explicitly enabled", async () => {
    const response = await handleLegacyAccessStart({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/start"),
      env: { DB: database as unknown as D1Database },
    });
    expect(response.status).toBe(404);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_migration_attempt").get())
      .toEqual({ count: 0 });
  });

  it("records a fresh exact Access proof and preserves a safe return destination", async () => {
    const verify = vi.fn(async () => ({
      userId: "legacy-admin", issuedAt: "2026-09-21T10:04:00.000Z",
    }));
    const response = await handleLegacyAccessStart({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/start?returnTo=%2Fwilhelm%2FSvalbard%3Flayer%3Dterrain%23profile"),
      env: { DB: database as unknown as D1Database, AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true" },
    }, {
      now: () => new Date("2026-09-21T10:05:00.000Z"),
      randomUUID: () => attemptId,
      verifyFreshAccessJwt: verify,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://staging.linksim.link/wilhelm/Svalbard?layer=terrain&legacyMigration=${attemptId}#profile`,
    );
    expect(database.db.prepare(`SELECT legacy_user_id, access_subject, consumed_at
      FROM auth_migration_attempt`).get()).toEqual({
        legacy_user_id: "legacy-admin", access_subject: "legacy-admin", consumed_at: null,
      });
  });

  it("forces one Access logout cycle for a stale proof and never loops", async () => {
    const dependencies = {
      now: () => new Date("2026-09-21T10:05:00.000Z"),
      randomUUID: () => attemptId,
      verifyFreshAccessJwt: vi.fn(async () => null),
    };
    const first = await handleLegacyAccessStart({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/start?returnTo=%2Fwanted"),
      env: { DB: database as unknown as D1Database, AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true" },
    }, dependencies);
    expect(first.status).toBe(303);
    const logout = new URL(first.headers.get("location")!);
    expect(logout.pathname).toBe("/cdn-cgi/access/logout");
    expect(logout.searchParams.get("returnTo")).toContain("reauth=1");

    const second = await handleLegacyAccessStart({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/start?returnTo=%2Fwanted&reauth=1"),
      env: { DB: database as unknown as D1Database, AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true" },
    }, dependencies);
    expect(second.status).toBe(401);
    await expect(second.json()).resolves.toMatchObject({ code: "MIGRATION_STALE" });
  });

  it("forces account selection and starts only an operator-authorized passkey recovery", async () => {
    database.db.prepare(`INSERT INTO auth_privileged_passkey_recovery
      (id, linksim_user_id, expected_access_subject, created_by, created_at, expires_at)
      VALUES ('67eef596-ce53-4c91-918d-54f200cabee9', 'legacy-admin', 'legacy-admin',
        'operator:wilhel1812', '2026-09-21T10:00:00.000Z', '2026-09-21T10:20:00.000Z')`).run();
    const dependencies = {
      now: () => new Date("2026-09-21T10:05:00.000Z"),
      randomUUID: vi.fn()
        .mockReturnValueOnce(attemptId)
        .mockReturnValueOnce(browserToken),
      verifyFreshAccessJwt: vi.fn(async () => ({
        userId: "legacy-admin", issuedAt: "2026-09-21T10:04:00.000Z",
      })),
    };
    const first = await handleLegacyAccessStart({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/start?recovery=passkey&returnTo=%2Fsettings%2Fprofile"),
      env: {
        DB: database as unknown as D1Database,
        AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true",
        AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED: "true",
      },
    }, dependencies);
    expect(first.status).toBe(303);
    expect(new URL(first.headers.get("location")!).pathname).toBe("/cdn-cgi/access/logout");
    expect(dependencies.verifyFreshAccessJwt).not.toHaveBeenCalled();

    const second = await handleLegacyAccessStart({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/start?recovery=passkey&reauth=1&returnTo=%2Fsettings%2Fprofile"),
      env: {
        DB: database as unknown as D1Database,
        AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true",
        AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED: "true",
      },
    }, dependencies);
    expect(second.status).toBe(303);
    const returned = new URL(second.headers.get("location")!);
    expect(returned.pathname).toBe("/settings/profile");
    expect(returned.searchParams.get("legacyMigration")).toBe(attemptId);
    expect(returned.searchParams.get("legacyRecovery")).toBe("passkey");
    expect(second.headers.get("set-cookie")).toContain(`__Host-linksim-privileged-recovery=${browserToken}`);
    expect(second.headers.get("set-cookie")).toContain("HttpOnly");
    expect(database.db.prepare(`SELECT browser_token FROM auth_privileged_passkey_recovery
      WHERE migration_attempt_id = ?`).get(attemptId)).toEqual({ browser_token: browserToken });
  });

  it("binds a fresh Better Auth session and consumes the attempt once", async () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 9 * 60_000).toISOString();
    database.db.prepare(`INSERT INTO auth_user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('auth-1', 'GitHub User', 'new@example.org', 1, ?, ?)`).run(
        "2026-09-21T10:05:00.000Z", "2026-09-21T10:05:00.000Z",
      );
    database.db.prepare(`INSERT INTO auth_account
      (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('account-1', '12345', 'github', 'auth-1', ?, ?)`).run(
        "2026-09-21T10:05:00.000Z", "2026-09-21T10:05:00.000Z",
      );
    database.db.prepare(`INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, auth_user_id, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', ?, 'auth-1', ?, ?)`).run(
        attemptId, "2026-09-21T10:04:00.000Z", createdAt, expiresAt,
      );
    let sessionAuthUserId = "auth-1";
    const env = {
      DB: database as unknown as D1Database,
      AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true",
      AUTH: { getByName: () => ({
        checkSession: async () => ({ status: 200, authUserId: sessionAuthUserId, fresh: true, setCookies: [] }),
        fetch: async () => new Response(null, { status: 404 }),
      }) },
    };
    const request = (currentAttemptId = attemptId) => new Request("https://staging.linksim.link/api/auth/legacy-access/complete", {
      method: "POST",
      headers: { origin: "https://staging.linksim.link", "content-type": "application/json" },
      body: JSON.stringify({ attemptId: currentAttemptId }),
    });
    const response = await complete({ request: request(), env } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, userId: "legacy-admin" });
    const replay = await complete({ request: request(), env } as never);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      ok: true, userId: "legacy-admin", alreadyComplete: true,
    });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 1 });

    database.db.prepare(`INSERT INTO auth_user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('auth-2', 'Other GitHub User', 'other@example.org', 1, ?, ?)`).run(
        "2026-09-21T10:05:00.000Z", "2026-09-21T10:05:00.000Z",
      );
    database.db.prepare(`INSERT INTO auth_account
      (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('account-2', '67890', 'github', 'auth-2', ?, ?)`).run(
        "2026-09-21T10:05:00.000Z", "2026-09-21T10:05:00.000Z",
      );
    sessionAuthUserId = "auth-2";
    const differentIdentityReplay = await complete({ request: request(), env } as never);
    expect(differentIdentityReplay.status).toBe(409);
    await expect(differentIdentityReplay.json()).resolves.toMatchObject({ code: "MIGRATION_CONFLICT" });
    sessionAuthUserId = "auth-1";

    database.db.prepare(`UPDATE identity_subject_states SET status = 'blocked'
      WHERE user_id = 'legacy-admin'`).run();
    const ineligibleReplay = await complete({ request: request(), env } as never);
    expect(ineligibleReplay.status).toBe(409);
    await expect(ineligibleReplay.json()).resolves.toMatchObject({ code: "MIGRATION_CONFLICT" });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 1 });
    database.db.prepare(`UPDATE identity_subject_states SET status = 'current'
      WHERE user_id = 'legacy-admin'`).run();

    const repeatAttemptId = "c1ffe09c-a597-4023-95cb-9343a75da7d6";
    database.db.prepare(`INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, auth_user_id, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', ?, 'auth-1', ?, ?)`).run(
        repeatAttemptId, "2026-09-21T10:04:00.000Z", createdAt, expiresAt,
      );
    const repeat = await complete({ request: request(repeatAttemptId), env } as never);
    expect(repeat.status).toBe(200);
    await expect(repeat.json()).resolves.toEqual({ ok: true, userId: "legacy-admin" });

    const overlappingAttemptId = "91eb9878-c407-4ae9-baf2-c7ec4034cc72";
    database.db.prepare(`INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, auth_user_id, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', ?, 'auth-1', ?, ?)`).run(
        overlappingAttemptId, "2026-09-21T10:04:00.000Z", createdAt, expiresAt,
      );
    const overlapping = await Promise.all([
      complete({ request: request(overlappingAttemptId), env } as never),
      complete({ request: request(overlappingAttemptId), env } as never),
    ]);
    expect(overlapping.map((entry) => entry.status)).toEqual([200, 200]);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 1 });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 3 });
  });

  it.each([
    ["mapping drift", `DELETE FROM auth_identity_map;
      INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
      VALUES ('auth-2', 'legacy-admin', '2026-09-21T10:07:00.000Z')`],
    ["a deletion tombstone", `INSERT INTO deleted_users (id, deleted_at)
      VALUES ('legacy-admin', '2026-09-21T10:07:00.000Z')`],
    ["a blocked identity", `UPDATE identity_subject_states SET status = 'blocked'
      WHERE user_id = 'legacy-admin'`],
    ["a superseded identity", `UPDATE identity_subject_states SET status = 'superseded'
      WHERE user_id = 'legacy-admin'`],
    ["a changed canonical identity", `UPDATE identity_subject_states SET canonical_user_id = 'other-user'
      WHERE user_id = 'legacy-admin'`],
    ["lost application eligibility", `UPDATE users SET is_admin = 0, is_moderator = 0, is_approved = 0
      WHERE id = 'legacy-admin'`],
    ["application revocation", `UPDATE users SET approved_by_user_id = 'revoked:admin'
      WHERE id = 'legacy-admin'`],
    ["an unverified GitHub identity", `UPDATE auth_user SET emailVerified = 0 WHERE id = 'auth-1'`],
    ["a different provider", `UPDATE auth_account SET providerId = 'gitlab' WHERE id = 'account-1'`],
    ["a nonnumeric GitHub subject", `UPDATE auth_account SET accountId = 'not-numeric' WHERE id = 'account-1'`],
  ])("rejects completed-attempt recovery after %s", async (_state, mutation) => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 9 * 60_000).toISOString();
    for (const [id, accountId] of [["auth-1", "12345"], ["auth-2", "67890"]]) {
      database.db.prepare(`INSERT INTO auth_user
        (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, ?, ?)`).run(
          id, id, `${id}@example.org`, "2026-09-21T10:05:00.000Z", "2026-09-21T10:05:00.000Z",
        );
      database.db.prepare(`INSERT INTO auth_account
        (id, accountId, providerId, userId, createdAt, updatedAt)
        VALUES (?, ?, 'github', ?, ?, ?)`).run(
          `account-${id === "auth-1" ? "1" : "2"}`, accountId, id,
          "2026-09-21T10:05:00.000Z", "2026-09-21T10:05:00.000Z",
        );
    }
    database.db.prepare(`INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, auth_user_id, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', ?, 'auth-1', ?, ?)`).run(
        attemptId, "2026-09-21T10:04:00.000Z", createdAt, expiresAt,
      );
    const env = {
      DB: database as unknown as D1Database,
      AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true",
      AUTH: { getByName: () => ({
        checkSession: async () => ({ status: 200, authUserId: "auth-1", fresh: true, setCookies: [] }),
        fetch: async () => new Response(null, { status: 404 }),
      }) },
    };
    const request = () => new Request("https://staging.linksim.link/api/auth/legacy-access/complete", {
      method: "POST",
      headers: { origin: "https://staging.linksim.link", "content-type": "application/json" },
      body: JSON.stringify({ attemptId }),
    });
    expect((await complete({ request: request(), env } as never)).status).toBe(200);
    database.db.exec(mutation);

    const replay = await complete({ request: request(), env } as never);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({ code: "MIGRATION_CONFLICT" });
    expect(database.db.prepare(`SELECT COUNT(*) AS count FROM user_identity_audit
      WHERE event_type = 'better_auth_dual_login'`).get()).toEqual({ count: 1 });
  });

  it("rejects non-fresh Better Auth sessions without mutating the attempt", async () => {
    const env = {
      DB: database as unknown as D1Database,
      AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true",
      AUTH: { getByName: () => ({
        checkSession: async () => ({ status: 200, authUserId: "auth-1", fresh: false, setCookies: [] }),
        fetch: async () => new Response(null, { status: 404 }),
      }) },
    };
    const response = await complete({
      request: new Request("https://staging.linksim.link/api/auth/legacy-access/complete", {
        method: "POST",
        headers: { origin: "https://staging.linksim.link", "content-type": "application/json" },
        body: JSON.stringify({ attemptId }),
      }),
      env,
    } as never);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "MIGRATION_STALE" });
  });
});
