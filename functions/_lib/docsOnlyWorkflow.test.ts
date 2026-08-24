import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const deployWorkflow = readRepositoryFile(".github/workflows/deploy-pages.yml");
const branchWorkflow = readRepositoryFile(".github/workflows/pr-branch-policy.yml");
const policyScript = readRepositoryFile("scripts/docs-only-policy.mjs");
const releaseFlow = readRepositoryFile("docs/release-flow.md");

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
  });

  it("permits only same-repository docs issue branches to use the main lane", () => {
    expect(branchWorkflow).toContain("^docs/[0-9]+-[a-z0-9-]+$");
    expect(branchWorkflow).toContain('test "$HEAD_REPO" = "$GITHUB_REPOSITORY"');
    expect(branchWorkflow).toContain("node scripts/docs-only-policy.mjs require");
  });

  it("uses no-renames diffing so moves expose both removed and added paths", () => {
    expect(policyScript).toContain('"--no-renames"');
  });

  it("links the protected lane from the release source of truth", () => {
    expect(releaseFlow).toContain("docs/documentation-delivery.md");
    expect(releaseFlow).toContain("docs/<issue-id>-<slug>");
    expect(releaseFlow).toContain("chore/sync-docs-to-staging");
  });
});
