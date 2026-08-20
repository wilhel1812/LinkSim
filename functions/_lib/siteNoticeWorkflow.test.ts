import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/site-notice.yml"), "utf8");
const script = readFileSync(resolve(process.cwd(), "scripts/site-notice.mjs"), "utf8");

describe("site notice operations workflow", () => {
  it("uses protected environments and serializes each target", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("options: [staging, production]");
    expect(workflow).toContain("environment: ${{ inputs.target }}");
    expect(workflow).toContain("group: site-notice-${{ inputs.target }}");
    expect(workflow).not.toContain("deploy-pages");
  });

  it("passes inputs through environment variables to a bounded script", () => {
    expect(workflow).toContain("NOTICE_ACTOR: ${{ github.actor }}");
    expect(workflow).toContain("NOTICE_RUN_ID: ${{ github.run_id }}");
    expect(workflow).toMatch(/dismissible:[\s\S]*?default: true/);
    expect(workflow).toContain("run: node scripts/site-notice.mjs");
    expect(script).toContain("const MAX_MESSAGE_LENGTH = 280");
    expect(script).toContain('staging: "linksim_staging", production: "linksim"');
    expect(script).toContain("site_notice_audit");
    expect(script).toContain("execFileSync");
    expect(script).not.toContain("execSync");
  });

  it("registers the exact public JSON route requested by the client", () => {
    expect(existsSync(resolve(process.cwd(), "functions/site-status.json.ts"))).toBe(true);
    expect(readFileSync(resolve(process.cwd(), "src/lib/cloudSiteNotice.ts"), "utf8"))
      .toContain('fetch("/site-status.json"');
  });

  it("rejects parseable but non-ISO workflow expiry values before invoking Wrangler", () => {
    for (const expiresAt of ["2026", "08/21/2026 12:00"]) {
      const result = spawnSync(process.execPath, ["scripts/site-notice.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NOTICE_TARGET: "staging",
          NOTICE_ACTION: "publish",
          NOTICE_TONE: "warning",
          NOTICE_MESSAGE: "Maintenance",
          NOTICE_DISMISSIBLE: "true",
          NOTICE_EXPIRES_AT: expiresAt,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must be an ISO-8601 timestamp with a timezone");
      expect(result.stderr).not.toContain("wrangler");
    }
  });
});
