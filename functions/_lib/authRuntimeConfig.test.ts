import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { makeAuthSessionLog } from "../../workers/auth-runtime/logging";

describe("staging auth runtime isolation", () => {
  it("binds only the staging D1 database", () => {
    const config = readFileSync(
      resolve(process.cwd(), "workers/auth-runtime/wrangler.staging.toml"),
      "utf8",
    );
    expect(config).toContain('database_name = "linksim_staging"');
    expect(config).not.toContain('database_name = "linksim-staging"');
    expect(config).toContain('database_id = "a35d016c-f2b8-40c8-ade9-b0f1b2b1bf1c"');
    expect(config).not.toContain("d669aac0-37ea-4c68-9b27-ece888e1966a");
    expect(config).toContain("[observability]\nenabled = true");
    expect(config).toContain('AUTH_LEGACY_CLAIM_DEADLINE = "2026-12-19T23:59:59.999Z"');
    expect(config).not.toContain("AUTH_PILOT_");
  });

  it("keeps auth runtime telemetry bounded and free of identity or request data", () => {
    expect(makeAuthSessionLog(200, "ok", 12.6)).toEqual({
      event: "auth-session",
      status: 200,
      result: "ok",
      elapsedMs: 13,
    });
  });
});
