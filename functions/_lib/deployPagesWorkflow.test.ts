import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-pages.yml"),
  "utf8",
);

const productionJob = workflow.split("  deploy-prod-main:")[1] ?? "";

describe("Deploy LinkSim Pages workflow", () => {
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
