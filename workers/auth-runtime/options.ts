import type { BetterAuthOptions } from "better-auth";

export type AuthRuntimeEnv = {
  DB: D1Database;
  AUTH_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
};

export const authRuntimeOptions = (env: AuthRuntimeEnv): BetterAuthOptions => {
  const origin = new URL(env.AUTH_ORIGIN).origin;
  if (
    origin !== env.AUTH_ORIGIN
    || typeof env.BETTER_AUTH_SECRET !== "string"
    || env.BETTER_AUTH_SECRET.length < 32
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
    user: { modelName: "auth_user" },
    account: {
      modelName: "auth_account",
      accountLinking: {
        enabled: true,
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
  };
};
