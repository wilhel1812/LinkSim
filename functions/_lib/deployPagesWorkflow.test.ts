import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-pages.yml"),
  "utf8",
);
const deployScript = readFileSync(
  resolve(process.cwd(), "scripts/deploy-pages-safe.mjs"),
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

  it("validates workflow-derived preview and release values before quoted shell use", () => {
    expect(previewJob).toContain(
      "PREVIEW_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    );
    expect(previewJob).toContain('[[ ! "$PREVIEW_BASE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]');
    expect(previewJob).toContain('git diff --quiet "$PREVIEW_BASE_SHA"...HEAD');
    expect(previewJob).not.toContain(
      'git diff --quiet "${{ github.event.pull_request.base.sha }}"...HEAD',
    );

    expect(productionJob).toContain("RELEASE_TAG: ${{ steps.release_tag.outputs.tag }}");
    expect(productionJob).toContain(
      '[[ ! "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]',
    );
    expect(productionJob).toContain(
      'git worktree add --detach "$RUNNER_TEMP/linksim-release" "$RELEASE_TAG"',
    );
    expect(productionJob).not.toContain(
      'git worktree add --detach "$RUNNER_TEMP/linksim-release" "${{ steps.release_tag.outputs.tag }}"',
    );
  });

  it("checks the production Access boundary without requiring an Access API token", () => {
    expect(previewJob).toContain("Verify production Access boundary");
    expect(previewJob).toContain("node scripts/access-boundary.mjs check production");
    expect(previewJob).not.toContain("node scripts/access-boundary.mjs plan staging");
  });

  it("verifies the immutable preview Access audience before publishing its URL", () => {
    const deployStep = "- name: Deploy authenticated staging preview";
    const accessStep = "- name: Verify immutable preview Access boundary";
    const commentStep = "- name: Update pull request preview comment";
    expect(previewJob).toContain("ACCESS_PREVIEW_URL: ${{ steps.deploy.outputs.preview_url }}");
    expect(previewJob).toContain("node scripts/access-boundary.mjs check-preview staging");
    expect(previewJob.indexOf(deployStep)).toBeLessThan(previewJob.indexOf(accessStep));
    expect(previewJob.indexOf(accessStep)).toBeLessThan(previewJob.indexOf(commentStep));
  });

  it("verifies staging Access only after the guarded Pages deployment", () => {
    const deployStep = "- name: Deploy staging with guardrails";
    const accessStep = "- name: Verify staging Access boundary";
    expect(stagingJob).toContain(accessStep);
    expect(stagingJob).toContain("node scripts/access-boundary.mjs check staging");
    expect(stagingJob).not.toContain("node scripts/access-boundary.mjs apply staging");
    expect(stagingJob.indexOf(deployStep)).toBeLessThan(stagingJob.indexOf(accessStep));
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

  it("validates the release before any production D1 migration", () => {
    const releaseGateStep = "- name: Validate release gate";
    const simulationMigrationStep =
      "- name: Apply production Simulation lifecycle migration";
    const identityMigrationStep =
      "- name: Verify identity lifecycle migration prerequisites and apply migration";

    expect(productionJob).toContain(releaseGateStep);
    expect(productionJob.indexOf(releaseGateStep)).toBeLessThan(
      productionJob.indexOf(simulationMigrationStep),
    );
    expect(productionJob.indexOf(releaseGateStep)).toBeLessThan(
      productionJob.indexOf(identityMigrationStep),
    );
    expect(productionJob.slice(0, productionJob.indexOf(releaseGateStep))).not.toContain(
      "npx wrangler d1 execute linksim --remote",
    );
  });

  it("uses the validated workflow SHA and fails closed on production deployment lookup", () => {
    expect(productionJob).toContain("DEPLOY_VERIFY_COMMIT: ${{ github.sha }}");
    expect(deployScript).toContain("process.env.DEPLOY_VERIFY_COMMIT");
    expect(deployScript).toContain("resolveDeploymentCommit");
    expect(deployScript).toContain("await verifyMatchingPagesDeployment");
    expect(deployScript).not.toContain("Proceeding because the Pages deploy itself completed successfully");
    expect(deployScript.indexOf("await verifyMatchingPagesDeployment")).toBeLessThan(
      deployScript.indexOf("[deploy-pages-safe] Success:"),
    );
  });

  it("checks the production Access boundary before any production D1 migration", () => {
    const accessStep = "- name: Verify production Access boundary";
    const simulationMigrationStep =
      "- name: Apply production Simulation lifecycle migration";
    const identityMigrationStep =
      "- name: Verify identity lifecycle migration prerequisites and apply migration";

    expect(productionJob).toContain(accessStep);
    expect(productionJob).toContain("node scripts/access-boundary.mjs check production");
    expect(productionJob.indexOf(accessStep)).toBeLessThan(
      productionJob.indexOf(simulationMigrationStep),
    );
    expect(productionJob.indexOf(accessStep)).toBeLessThan(
      productionJob.indexOf(identityMigrationStep),
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
