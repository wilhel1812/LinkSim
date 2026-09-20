import { describe, expect, it } from "vitest";

import { authRuntimeOptions, type AuthRuntimeEnv } from "../../workers/auth-runtime/options";

const envWithSecret = (secret: string): AuthRuntimeEnv => ({
  DB: {} as D1Database,
  AUTH_ORIGIN: "https://staging.linksim.link",
  BETTER_AUTH_SECRET: secret,
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: "github-secret",
  TURNSTILE_SITE_KEY: "turnstile-site",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  AUTH_PILOT_GITHUB_ACCOUNT_ID: "1234567",
  AUTH_PILOT_LINKSIM_USER_ID: "linksim-user",
});

describe("auth runtime options", () => {
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
    "AUTH_PILOT_GITHUB_ACCOUNT_ID",
    "AUTH_PILOT_LINKSIM_USER_ID",
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

    const github = options.socialProviders?.github as {
      mapProfileToUser?: (profile: { id: number }) => Promise<unknown> | unknown;
    };
    await expect(github.mapProfileToUser?.({ id: 7654321 })).rejects.toThrow(
      "GitHub identity is not permitted",
    );
    await expect(github.mapProfileToUser?.({ id: 1234567 })).resolves.toEqual({});
  });

  it("rejects session creation unless the exact GitHub account has the exact current mapping", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind: (...values: unknown[]) => ({
            first: async () => {
              if (sql.includes("FROM auth_account")) {
                return values[0] === "auth-user" ? { accountId: "1234567" } : null;
              }
              if (sql.includes("INSERT INTO auth_identity_map")) {
                return { auth_user_id: "auth-user", linksim_user_id: "linksim-user" };
              }
              if (sql.includes("JOIN auth_user")) {
                return { auth_user_id: "auth-user", linksim_user_id: "linksim-user" };
              }
              return null;
            },
            all: async () => ({ results: [] }),
          }),
        };
      },
    } as unknown as D1Database;
    const options = authRuntimeOptions({ ...envWithSecret("x".repeat(32)), DB: db });
    const before = options.databaseHooks?.session?.create?.before;
    expect(await before?.({ userId: "auth-user" } as never, null)).not.toBe(false);
    expect(await before?.({ userId: "other-user" } as never, null)).toBe(false);
    expect(statements.some((sql) => sql.includes("INSERT INTO auth_identity_map"))).toBe(true);
  });
});
