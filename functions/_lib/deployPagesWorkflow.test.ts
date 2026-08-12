import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-pages.yml"),
  "utf8",
);

const productionJob = workflow.split("  deploy-prod-main:")[1] ?? "";
const stagingJob =
  workflow.split("  deploy-staging:")[1]?.split("  deploy-prod-main:")[0] ?? "";
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

  it("does not deploy schema-changing pull requests against the shared staging database", () => {
    expect(previewJob).toContain("Detect identity lifecycle schema change");
    expect(previewJob).toContain("db/migrations/2026-08-12_identity_lifecycle.sql");
    expect(previewJob).toContain("steps.identity_schema.outputs.changed != 'true'");
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
    expect(productionJob).toContain(
      "PRODUCTION_PREVIOUS_REF: ${{ github.event.before }}",
    );
  });

  it("probes, applies, and verifies identity lifecycle schema before staging and production deploys", () => {
    for (const [job, database] of [[stagingJob, "linksim_staging"], [productionJob, "linksim"]] as const) {
      expect(job).toContain("Verify identity lifecycle migration prerequisites");
      expect(job).toContain(`npx wrangler d1 execute ${database} --remote --file db/migrations/2026-08-12_identity_lifecycle.sql --yes`);
      expect(job).toContain(`node scripts/verify-identity-lifecycle-d1.mjs ${database} pre`);
      expect(job).toContain(`node scripts/verify-identity-lifecycle-d1.mjs ${database} post`);
    }
  });

  it("fetches the production baseline before validating a staging deployment", () => {
    expect(stagingJob).toContain("fetch-depth: 0");
    expect(stagingJob).toContain(
      "git fetch --no-tags origin main:refs/remotes/origin/main",
    );
    expect(stagingJob.indexOf("Fetch production version baseline")).toBeLessThan(
      stagingJob.indexOf("Deploy staging with guardrails"),
    );
  });
});
