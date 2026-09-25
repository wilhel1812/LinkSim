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
    expect(config).toContain('AUTH_DUAL_LOGIN_MIGRATION_ENABLED = "true"');
    expect(config).toContain('AUTH_LEGACY_CLAIM_ENABLED = "true"');
    expect(config).toContain('AUTH_REGISTRATION_ENABLED = "true"');
    expect(config).not.toContain("AUTH_PILOT_");
  });

  it("enables migration, claims and registration only in stable staging Pages", () => {
    const staging = readFileSync(resolve(process.cwd(), "wrangler.staging.toml"), "utf8");
    const preview = readFileSync(resolve(process.cwd(), "wrangler.staging-preview.toml"), "utf8");
    const production = readFileSync(resolve(process.cwd(), "wrangler.toml"), "utf8");
    for (const flag of [
      "AUTH_DUAL_LOGIN_MIGRATION_ENABLED",
      "AUTH_LEGACY_CLAIM_ENABLED",
      "AUTH_REGISTRATION_ENABLED",
    ]) {
      expect(staging).toContain(`${flag} = "true"`);
      expect(preview).not.toContain(flag);
      expect(production).not.toContain(flag);
    }
  });

  it("keeps production auth preparation dormant, isolated and fail closed", () => {
    const activePages = readFileSync(resolve(process.cwd(), "wrangler.toml"), "utf8");
    const preparedPages = readFileSync(
      resolve(process.cwd(), "wrangler.production-auth.toml"),
      "utf8",
    );
    const preparedRuntime = readFileSync(
      resolve(process.cwd(), "workers/auth-runtime/wrangler.production.toml"),
      "utf8",
    );
    const productionAuthMode = JSON.parse(readFileSync(
      resolve(process.cwd(), "config/production-auth-mode.json"),
      "utf8",
    )) as { active?: unknown; accessBoundary?: unknown };

    expect(activePages).not.toContain('name = "AUTH"');
    expect(activePages).not.toContain("AUTH_SESSION_SOURCE");
    expect(preparedPages).toContain('script_name = "linksim-auth-runtime-production"');
    expect(preparedPages).toContain('AUTH_SESSION_SOURCE = "transition"');
    expect(preparedRuntime).toContain('name = "linksim-auth-runtime-production"');
    expect(preparedRuntime).toContain('AUTH_ORIGIN = "https://linksim.link"');
    expect(productionAuthMode).toEqual({ active: false, accessBoundary: "broad" });

    for (const config of [preparedPages, preparedRuntime]) {
      expect(config).toContain('database_name = "linksim"');
      expect(config).toContain('database_id = "d669aac0-37ea-4c68-9b27-ece888e1966a"');
      expect(config).not.toContain("linksim_staging");
      expect(config).not.toContain("a35d016c-f2b8-40c8-ade9-b0f1b2b1bf1c");
      expect(config).toContain('AUTH_DUAL_LOGIN_MIGRATION_ENABLED = "false"');
      expect(config).toContain('AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED = "false"');
      expect(config).toContain('AUTH_LEGACY_CLAIM_ENABLED = "false"');
      expect(config).toContain('AUTH_REGISTRATION_ENABLED = "false"');
      expect(config).not.toContain("AUTH_LEGACY_CLAIM_DEADLINE");
    }
  });

  it("documents the required production-only client build inputs without activating CI", () => {
    const buildInputs = readFileSync(
      resolve(process.cwd(), "config/production-auth-build.env.example"),
      "utf8",
    );
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/deploy-pages.yml"),
      "utf8",
    );
    expect(buildInputs).toContain("VITE_BETTER_AUTH_PILOT=true");
    expect(buildInputs).toContain("VITE_TURNSTILE_SITE_KEY=REPLACE_WITH_PRODUCTION_TURNSTILE_SITE_KEY");
    const productionJob = workflow.split("  deploy-prod-main:")[1] ?? "";
    expect(productionJob).not.toBe("");
    expect(productionJob).toContain("github.event.inputs.target == 'prod-auth-cutover'");
    expect(productionJob).toContain("VITE_BETTER_AUTH_PILOT");
    expect(productionJob).toContain("VITE_TURNSTILE_SITE_KEY");
    expect(workflow).not.toContain("production-auth-build.env.example");
  });

  it("keeps the production schema and administrator bootstrap procedure complete", () => {
    const checklist = readFileSync(
      resolve(process.cwd(), "docs/production-auth-cutover-checklist.md"),
      "utf8",
    );
    for (const migration of [
      "2026-09-19_better_auth_schema.sql",
      "2026-09-21_auth_migration_attempt.sql",
      "2026-09-23_privileged_passkey_recovery.sql",
    ]) {
      expect(checklist).toContain(migration);
    }
    expect(checklist).toContain("db/probes/better-auth-schema.sql");
    expect(checklist).toContain("manage-admin-passkey-recovery.mjs production authorize");
    expect(checklist).toContain("AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED=false");
    expect(checklist).toContain("VITE_BETTER_AUTH_PILOT=true");
    expect(checklist).toContain("VITE_TURNSTILE_SITE_KEY");
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
