import { describe, expect, it } from "vitest";

import { authRuntimeOptions, type AuthRuntimeEnv } from "../../workers/auth-runtime/options";

const envWithSecret = (secret: string): AuthRuntimeEnv => ({
  DB: {} as D1Database,
  AUTH_ORIGIN: "https://staging.linksim.link",
  BETTER_AUTH_SECRET: secret,
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
});
