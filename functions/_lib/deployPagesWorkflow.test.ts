import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-pages.yml"),
  "utf8",
);

const productionJob = workflow.split("  deploy-prod-main:")[1] ?? "";
const previewJob =
  workflow.split("  deploy-staging-preview:")[1]?.split("  deploy-staging:")[0] ?? "";

describe("Deploy LinkSim Pages workflow", () => {
  it("deploys previews only for same-repository pull requests targeting staging", () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("      - staging");
    expect(previewJob).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(previewJob).toContain("vars.ENABLE_AUTHENTICATED_PREVIEWS == 'true'");
    expect(previewJob).toContain("environment: staging");
    expect(previewJob).toContain("pull-requests: write");
    expect(previewJob).toContain("ref: ${{ github.event.pull_request.head.sha }}");
    expect(previewJob).toContain("PREVIEW_BRANCH: ${{ github.head_ref }}");
    expect(previewJob).toContain('--target staging-preview --branch "$PREVIEW_BRANCH"');
  });

  it("updates one signed preview comment instead of posting duplicates", () => {
    expect(previewJob).toContain("<!-- linksim-preview:v1 -->");
    expect(previewJob).toContain("scripts/ai-provenance.mjs");
    expect(previewJob).toContain("execFileSync");
    expect(previewJob).toContain("footer.signature");
    expect(previewJob).toContain("footer.marker");
    expect(previewJob).not.toContain("`<!-- ${registry.markerPrefix}");
    expect(previewJob).toContain("github.rest.issues.updateComment");
    expect(previewJob).toContain("github.rest.issues.createComment");
  });

  it("applies and verifies the Simulation lifecycle migration before production deployment", () => {
    const migrationStep = "- name: Apply production Simulation lifecycle migration";
    const deployStep = "- name: Deploy prod/main with guardrails";

    expect(productionJob).toContain(migrationStep);
    expect(productionJob).toContain(
      'npx wrangler d1 execute linksim --remote --command "SELECT status FROM simulations LIMIT 0;"',
    );
    expect(productionJob).toContain(
      "npx wrangler d1 execute linksim --remote --file db/migrations/2026-08-04_simulation_soft_delete.sql --yes",
    );
    expect(productionJob.indexOf(migrationStep)).toBeLessThan(
      productionJob.indexOf(deployStep),
    );
  });
});
