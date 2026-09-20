import type { BetterAuthOptions } from "better-auth";
import { createAuthMiddleware, freshSessionMiddleware } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

import { provisionAuthIdentity, resolveCurrentAuthIdentity } from "../../functions/_lib/authIdentityMap";

export type AuthRuntimeEnv = {
  DB: D1Database;
  AUTH_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  AUTH_LEGACY_CLAIM_DEADLINE: string;
};

const required = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const FRESH_PASSKEY_MUTATION_PATHS = new Set([
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);

export const authRuntimeOptions = (env: AuthRuntimeEnv): BetterAuthOptions => {
  let url: URL;
  try {
    url = new URL(env.AUTH_ORIGIN);
  } catch {
    throw new Error("Better Auth runtime configuration is incomplete");
  }
  const origin = url.origin;
  const deadline = new Date(env.AUTH_LEGACY_CLAIM_DEADLINE ?? "");
  if (
    origin !== env.AUTH_ORIGIN
    || url.protocol !== "https:"
    || typeof env.BETTER_AUTH_SECRET !== "string"
    || env.BETTER_AUTH_SECRET.length < 32
    || !required(env.GITHUB_CLIENT_ID)
    || !required(env.GITHUB_CLIENT_SECRET)
    || !required(env.TURNSTILE_SITE_KEY)
    || !required(env.TURNSTILE_SECRET_KEY)
    || Number.isNaN(deadline.getTime())
    || deadline.toISOString() !== env.AUTH_LEGACY_CLAIM_DEADLINE
  ) {
    throw new Error("Better Auth runtime configuration is incomplete");
  }
  return {
    appName: "LinkSim",
    logger: { disabled: true },
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        requireEmailVerification: true,
        overrideUserInfoOnSignIn: true,
        async mapProfileToUser(profile) {
          const email = profile.email?.trim().toLowerCase();
          if (!/^\d+$/.test(String(profile.id)) || !email?.includes("@")) {
            throw new Error("GitHub identity is ineligible");
          }
          return { email };
        },
      },
    },
    user: {
      modelName: "auth_user",
      validateUserInfo: ({ user, source }) => {
        const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
        if (
          source.method !== "oauth"
          || source.oauth?.providerId !== "github"
          || user.emailVerified !== true
          || !email.includes("@")
        ) return { error: "github_identity_ineligible" };
      },
    },
    account: {
      modelName: "auth_account",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        allowUnlinkingAll: false,
      },
    },
    session: {
      modelName: "auth_session",
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 5,
    },
    verification: { modelName: "auth_verification" },
    advanced: {
      useSecureCookies: true,
      database: { joins: true },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 100,
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => (
            account.providerId === "github"
            && /^\d+$/.test(account.accountId)
          ),
        },
      },
      session: {
        create: {
          before: async (session) => {
            try {
              const provisioned = await provisionAuthIdentity(env.DB, {
                authUserId: session.userId,
                legacyClaimDeadline: env.AUTH_LEGACY_CLAIM_DEADLINE,
              });
              const mapping = await resolveCurrentAuthIdentity(env.DB, session.userId);
              if (
                mapping?.authUserId !== session.userId
                || mapping.linksimUserId !== provisioned.linksimUserId
              ) return false;
            } catch {
              return false;
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (FRESH_PASSKEY_MUTATION_PATHS.has(context.path)) {
          await freshSessionMiddleware(context);
        }
      }),
    },
    plugins: [
      passkey({
        rpID: url.hostname,
        rpName: "LinkSim",
        origin,
        schema: { passkey: { modelName: "auth_passkey" } },
      }),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-in/social"],
        expectedAction: "github-login",
        allowedHostnames: [url.hostname],
      }),
    ],
  };
};
