import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FRESH_PASSKEY_MUTATION_PATHS,
  authRuntimeOptions,
  legacyMigrationAttemptFromCallbackURL,
  prepareAuthSessionIdentity,
  type AuthRuntimeEnv,
} from "../../workers/auth-runtime/options";
import { SqliteD1 } from "./testSqliteD1";

const envWithSecret = (secret: string): AuthRuntimeEnv => ({
  DB: {} as D1Database,
  AUTH_ORIGIN: "https://staging.linksim.link",
  BETTER_AUTH_SECRET: secret,
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: "github-secret",
  TURNSTILE_SITE_KEY: "turnstile-site",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  AUTH_LEGACY_CLAIM_DEADLINE: "2026-12-19T23:59:59.999Z",
  AUTH_DUAL_LOGIN_MIGRATION_ENABLED: "true",
  AUTH_LEGACY_CLAIM_ENABLED: "true",
  AUTH_REGISTRATION_ENABLED: "true",
});

describe("auth runtime options", () => {
  it("accepts migration correlation only from the exact trusted callback origin", () => {
    const attempt = "67eef596-ce53-4c91-918d-54f200cabee9";
    expect(legacyMigrationAttemptFromCallbackURL(
      `https://staging.linksim.link/wilhelm/simulation?legacyMigration=${attempt}`,
      "https://staging.linksim.link",
    )).toBe(attempt);
    expect(legacyMigrationAttemptFromCallbackURL(
      `/wilhelm/simulation?legacyMigration=${attempt}`,
      "https://staging.linksim.link",
    )).toBe(attempt);
    expect(legacyMigrationAttemptFromCallbackURL(
      `https://evil.example/?legacyMigration=${attempt}`,
      "https://staging.linksim.link",
    )).toBeNull();
    expect(legacyMigrationAttemptFromCallbackURL(
      "https://staging.linksim.link/?legacyMigration=guessable",
      "https://staging.linksim.link",
    )).toBeNull();
  });

  it("binds an OAuth-state migration attempt without ordinary claim or registration", async () => {
    const database = new SqliteD1();
    database.db.exec(readFileSync(resolve(
      process.cwd(), "db/migrations/2026-09-19_better_auth_schema.sql",
    ), "utf8"));
    database.db.exec(readFileSync(resolve(
      process.cwd(), "db/migrations/2026-09-21_auth_migration_attempt.sql",
    ), "utf8"));
    database.db.prepare(`INSERT INTO users
      (id, username, is_admin, is_approved, created_at, updated_at)
      VALUES ('legacy-admin', 'admin', 1, 1, datetime('now'), datetime('now'))`).run();
    database.db.prepare(`INSERT INTO identity_subject_states
      (user_id, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
      VALUES ('legacy-admin', 'current', 'legacy-admin', 1, datetime('now'), datetime('now'))`).run();
    database.db.prepare(`INSERT INTO auth_user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('auth-new', 'GitHub User', 'different@example.org', 1, datetime('now'), datetime('now'))`).run();
    database.db.prepare(`INSERT INTO auth_account
      (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('account-new', '12345', 'github', 'auth-new', datetime('now'), datetime('now'))`).run();
    const attemptId = "67eef596-ce53-4c91-918d-54f200cabee9";
    database.db.prepare(`INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, created_at, expires_at)
      VALUES (?, 'legacy-admin', 'legacy-admin', ?, ?, ?)`)
      .run(attemptId, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 600_000).toISOString());

    await expect(prepareAuthSessionIdentity({
      ...envWithSecret("x".repeat(32)),
      DB: database as unknown as D1Database,
      AUTH_LEGACY_CLAIM_ENABLED: "false",
      AUTH_REGISTRATION_ENABLED: "false",
    }, "auth-new", attemptId)).resolves.toBe(true);
    expect(database.db.prepare("SELECT auth_user_id FROM auth_migration_attempt WHERE id = ?").get(attemptId))
      .toEqual({ auth_user_id: "auth-new" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM auth_identity_map").get()).toEqual({ count: 0 });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
  });
  it("fails closed when the Better Auth secret is shorter than 32 characters", () => {
    expect(() => authRuntimeOptions(envWithSecret("x".repeat(31))))
      .toThrow("Better Auth runtime configuration is incomplete");
  });

  it("fails closed when the Better Auth secret is absent", () => {
    expect(() => authRuntimeOptions({
      ...envWithSecret("x".repeat(32)),
      BETTER_AUTH_SECRET: undefined as unknown as string,
    })).toThrow("Better Auth runtime configuration is incomplete");
  });

  it("disables library logging and session cookie caching", () => {
    const options = authRuntimeOptions(envWithSecret("x".repeat(32)));
    expect(options.logger).toEqual({ disabled: true });
    expect(options.session?.cookieCache).toEqual({ enabled: false });
  });

  it.each([
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "AUTH_LEGACY_CLAIM_DEADLINE",
  ] as const)("fails closed when %s is absent", (name) => {
    expect(() => authRuntimeOptions({
      ...envWithSecret("x".repeat(32)),
      [name]: "",
    })).toThrow("Better Auth runtime configuration is incomplete");
  });

  it("configures only GitHub, encrypted tokens, disabled linking, persistent limits, and Turnstile", async () => {
    const options = authRuntimeOptions(envWithSecret("x".repeat(32)));
    expect(Object.keys(options.socialProviders ?? {})).toEqual(["github"]);
    expect(options.account).toMatchObject({
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        allowUnlinkingAll: false,
      },
    });
    expect(options.rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 100,
    });
    const captcha = options.plugins?.find((plugin) => plugin.id === "captcha");
    expect(captcha?.options).toMatchObject({
      provider: "cloudflare-turnstile",
      secretKey: "turnstile-secret",
      endpoints: ["/sign-in/social"],
      expectedAction: "github-login",
      allowedHostnames: ["staging.linksim.link"],
    });
    const passkey = options.plugins?.find((plugin) => plugin.id === "passkey");
    expect(passkey?.options).toMatchObject({
      rpID: "staging.linksim.link",
      rpName: "LinkSim",
      origin: "https://staging.linksim.link",
      schema: { passkey: { modelName: "auth_passkey" } },
    });
    expect(FRESH_PASSKEY_MUTATION_PATHS).toEqual(new Set([
      "/passkey/delete-passkey",
      "/passkey/update-passkey",
    ]));

    const github = options.socialProviders?.github as {
      requireEmailVerification?: boolean;
      overrideUserInfoOnSignIn?: boolean;
      mapProfileToUser?: (profile: { id: number; email?: string | null }) => Promise<unknown> | unknown;
    };
    expect(github.requireEmailVerification).toBe(true);
    expect(github.overrideUserInfoOnSignIn).toBe(true);
    await expect(github.mapProfileToUser?.({ id: 7654321 })).rejects.toThrow("GitHub identity is ineligible");
    await expect(github.mapProfileToUser?.({ id: 1234567, email: " User@Example.ORG " }))
      .resolves.toEqual({ email: "user@example.org" });
  });

  it("accepts any numeric GitHub provider account and rejects other providers", async () => {
    const options = authRuntimeOptions(envWithSecret("x".repeat(32)));
    const before = options.databaseHooks?.account?.create?.before;
    expect(await before?.({ providerId: "github", accountId: "7654321" } as never, null)).not.toBe(false);
    expect(await before?.({ providerId: "gitlab", accountId: "7654321" } as never, null)).toBe(false);
    expect(await before?.({ providerId: "github", accountId: "invalid" } as never, null)).toBe(false);
  });

  it("validates fresh verified GitHub OAuth user information", async () => {
    const options = authRuntimeOptions(envWithSecret("x".repeat(32)));
    const validate = options.user?.validateUserInfo;
    const source = { action: "sign-in", method: "oauth", oauth: { providerId: "github", profile: {} } } as never;
    expect(await validate?.({ user: { email: " User@Example.ORG ", emailVerified: true }, source }, {} as never))
      .toBeUndefined();
    expect(await validate?.({ user: { email: "user@example.org", emailVerified: false }, source }, {} as never))
      .toEqual({ error: "github_identity_ineligible" });
    expect(await validate?.({
      user: { email: "user@example.org", emailVerified: true },
      source: { action: "sign-in", method: "oauth", oauth: { providerId: "gitlab", profile: {} } } as never,
    }, {} as never)).toEqual({ error: "github_identity_ineligible" });
  });

  it.each(["invalid", "2026-12-19"])("rejects a non-canonical claim deadline: %s", (deadline) => {
    expect(() => authRuntimeOptions({
      ...envWithSecret("x".repeat(32)),
      AUTH_LEGACY_CLAIM_DEADLINE: deadline,
    })).toThrow("Better Auth runtime configuration is incomplete");
  });
});
