import type { BetterAuthOptions } from "better-auth";
import { captcha } from "better-auth/plugins";

import {
  attachAuthIdentity,
  resolveCurrentAuthIdentity,
} from "../../functions/_lib/authIdentityMap";

export type AuthRuntimeEnv = {
  DB: D1Database;
  AUTH_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  AUTH_PILOT_GITHUB_ACCOUNT_ID: string;
  AUTH_PILOT_LINKSIM_USER_ID: string;
};

const required = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const authRuntimeOptions = (env: AuthRuntimeEnv): BetterAuthOptions => {
  let url: URL;
  try {
    url = new URL(env.AUTH_ORIGIN);
  } catch {
    throw new Error("Better Auth runtime configuration is incomplete");
  }
  const origin = url.origin;
  if (
    origin !== env.AUTH_ORIGIN
    || url.protocol !== "https:"
    || typeof env.BETTER_AUTH_SECRET !== "string"
    || env.BETTER_AUTH_SECRET.length < 32
    || !required(env.GITHUB_CLIENT_ID)
    || !required(env.GITHUB_CLIENT_SECRET)
    || !required(env.TURNSTILE_SITE_KEY)
    || !required(env.TURNSTILE_SECRET_KEY)
    || !/^\d+$/.test(env.AUTH_PILOT_GITHUB_ACCOUNT_ID ?? "")
    || !required(env.AUTH_PILOT_LINKSIM_USER_ID)
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
        async mapProfileToUser(profile) {
          if (String(profile.id) !== env.AUTH_PILOT_GITHUB_ACCOUNT_ID) {
            throw new Error("GitHub identity is not permitted");
          }
          return {};
        },
      },
    },
    user: { modelName: "auth_user" },
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
            && account.accountId === env.AUTH_PILOT_GITHUB_ACCOUNT_ID
          ),
        },
      },
      session: {
        create: {
          before: async (session) => {
            try {
              const account = await env.DB.prepare(`
                SELECT accountId
                FROM auth_account
                WHERE userId = ? AND providerId = 'github'
                LIMIT 1
              `).bind(session.userId).first<{ accountId: string }>();
              if (account?.accountId !== env.AUTH_PILOT_GITHUB_ACCOUNT_ID) return false;

              await attachAuthIdentity(
                env.DB,
                session.userId,
                env.AUTH_PILOT_LINKSIM_USER_ID,
              );
              const mapping = await resolveCurrentAuthIdentity(env.DB, session.userId);
              if (
                mapping?.authUserId !== session.userId
                || mapping.linksimUserId !== env.AUTH_PILOT_LINKSIM_USER_ID
              ) return false;
            } catch {
              return false;
            }
          },
        },
      },
    },
    plugins: [captcha({
      provider: "cloudflare-turnstile",
      secretKey: env.TURNSTILE_SECRET_KEY,
      endpoints: ["/sign-in/social"],
      expectedAction: "github-login",
      allowedHostnames: [url.hostname],
    })],
  };
};
