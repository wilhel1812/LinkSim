import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const deployWorkflow = readRepositoryFile(".github/workflows/deploy-pages.yml");
const branchWorkflow = readRepositoryFile(".github/workflows/pr-branch-policy.yml");
const docsBranchWorkflow = readRepositoryFile(
  ".github/workflows/docs-branch-policy.yml",
);
const policyScript = readRepositoryFile("scripts/docs-only-policy.mjs");

describe("documentation-only delivery workflow", () => {
  it("classifies every deploy event without workflow-level path filters", () => {
    expect(deployWorkflow).toContain("  classify_changes:");
    expect(deployWorkflow).toContain("node scripts/docs-only-policy.mjs classify");
    expect(deployWorkflow).not.toContain("paths-ignore:");
    expect(deployWorkflow).not.toContain("paths:");
  });

  it("skips each Pages deployment job after a successful docs-only classification", () => {
    expect(deployWorkflow.match(/needs: classify_changes/g)).toHaveLength(3);
    expect(
      deployWorkflow.match(/needs\.classify_changes\.outputs\.docs_only != 'true'/g),
    ).toHaveLength(3);
    expect(deployWorkflow.match(/!cancelled\(\)/g)).toHaveLength(3);
  });

  it("stages a non-authorizing trusted evaluator without removing the required main check", () => {
    expect(branchWorkflow).toContain("  pull_request:\n");
    expect(branchWorkflow).toContain("      - main");
    expect(branchWorkflow).not.toContain("pull_request_target:");
    expect(branchWorkflow).not.toContain("^docs/[0-9]+-[a-z0-9-]+$");

    expect(docsBranchWorkflow).toContain("pull_request_target:");
    expect(docsBranchWorkflow).toContain(
      "name: Docs Branch Policy / evaluate-main-docs",
    );
    expect(docsBranchWorkflow).not.toContain("checks: write");
    expect(docsBranchWorkflow).not.toContain("github.rest.checks.create");
    expect(docsBranchWorkflow).toContain("^docs/[0-9]+-[a-z0-9-]+$");
    expect(docsBranchWorkflow).toContain(
      'test "$HEAD_REPO" = "$GITHUB_REPOSITORY"',
    );
    expect(docsBranchWorkflow).toContain(
      "ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(docsBranchWorkflow).toContain("persist-credentials: false");
    expect(docsBranchWorkflow).not.toContain(
      "ref: ${{ github.event.pull_request.head.sha }}",
    );
    expect(docsBranchWorkflow).toContain("node scripts/docs-only-policy.mjs require");
  });

  it("uses no-renames diffing so moves expose both removed and added paths", () => {
    expect(policyScript).toContain('"--no-renames"');
  });

  it("documents the required activation ordering", () => {
    const delivery = readRepositoryFile("docs/documentation-delivery.md");
    expect(delivery).toContain("Docs Branch Policy / enforce-main-docs");
    expect(delivery).toContain("branch protection is updated");
    expect(delivery).toContain("Do not open or merge a `docs/*`");
    expect(delivery).toContain("`docs/onboarding.md`");
    expect(delivery).toContain("dedicated GitHub App");
    expect(delivery).toContain("non-authorizing");
  });
});
