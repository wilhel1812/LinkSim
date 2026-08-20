import { existsSync, readFileSync } from "node:fs";
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
});
