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
const attemptId = "78d2594f-6ef2-4d59-b8de-d42366a4c420";

describe("legacy Access migration routes", () => {
  let database: SqliteD1;

  beforeEach(() => {
    database = new SqliteD1();
    database.db.exec(betterAuthMigration);
    database.db.exec(attemptMigration);
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

  it("binds a fresh Better Auth session and consumes the attempt once", async () => {
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
        attemptId, "2026-09-21T10:04:00.000Z", "2026-09-21T10:05:00.000Z", "2026-09-21T10:15:00.000Z",
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
    const response = await complete({ request: request(), env } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, userId: "legacy-admin" });
    expect((await complete({ request: request(), env } as never)).status).toBe(409);
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
