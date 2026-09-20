import { describe, expect, it } from "vitest";

import {
  FRESH_PASSKEY_MUTATION_PATHS,
  authRuntimeOptions,
  type AuthRuntimeEnv,
} from "../../workers/auth-runtime/options";

const envWithSecret = (secret: string): AuthRuntimeEnv => ({
  DB: {} as D1Database,
  AUTH_ORIGIN: "https://staging.linksim.link",
  BETTER_AUTH_SECRET: secret,
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: "github-secret",
  TURNSTILE_SITE_KEY: "turnstile-site",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  AUTH_LEGACY_CLAIM_DEADLINE: "2026-12-19T23:59:59.999Z",
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
