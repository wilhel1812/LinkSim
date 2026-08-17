import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readWorkflow = (name: string) =>
  readFileSync(resolve(process.cwd(), ".github/workflows", name), "utf8");

const qualityWorkflow = readWorkflow("ci-quality-gates.yml");
const branchWorkflow = readWorkflow("pr-branch-policy.yml");

describe("required check workflows", () => {
  it.each([
    ["CI quality gates", qualityWorkflow],
    ["PR branch policy", branchWorkflow],
  ])("uses native checks without reusable status-write authority for %s", (_label, workflow) => {
    expect(workflow).not.toContain("statuses: write");
    expect(workflow).not.toContain("createCommitStatus");
  });

  it.each([
    ["CI quality gates", qualityWorkflow],
    ["PR branch policy", branchWorkflow],
  ])("re-evaluates %s when a pull request is retargeted", (_label, workflow) => {
    expect(workflow).toContain("types: [opened, reopened, synchronize, edited]");
  });

  it("publishes target-specific CI checks after the generic verification job", () => {
    expect(qualityWorkflow).toMatch(/^    name: CI Quality Gates \/ verify$/m);
    expect(qualityWorkflow).toMatch(/^    name: CI Quality Gates \/ verify-staging$/m);
    expect(qualityWorkflow).toMatch(/^    name: CI Quality Gates \/ verify-main$/m);
    expect(qualityWorkflow.match(/needs: verify/g)).toHaveLength(2);
    expect(qualityWorkflow).toContain("if: always() && github.base_ref == 'staging'");
    expect(qualityWorkflow).toContain("if: always() && github.base_ref == 'main'");
    expect(qualityWorkflow.match(/VERIFY_RESULT: \$\{\{ needs\.verify\.result \}\}/g)).toHaveLength(2);
    expect(qualityWorkflow.match(/test "\$VERIFY_RESULT" = "success"/g)).toHaveLength(2);
    expect(qualityWorkflow).toContain('test "$BASE_REF" = "staging"');
    expect(qualityWorkflow).toContain('test "$BASE_REF" = "main"');
  });

  it("publishes target-specific branch-policy checks after enforcement", () => {
    expect(branchWorkflow).toMatch(/^    name: PR Branch Policy \/ enforce$/m);
    expect(branchWorkflow).toMatch(/^    name: PR Branch Policy \/ enforce-staging$/m);
    expect(branchWorkflow).toMatch(/^    name: PR Branch Policy \/ enforce-main$/m);
    expect(branchWorkflow.match(/needs: enforce/g)).toHaveLength(2);
    expect(branchWorkflow).toContain("if: always() && github.base_ref == 'staging'");
    expect(branchWorkflow).toContain("if: always() && github.base_ref == 'main'");
    expect(branchWorkflow.match(/ENFORCE_RESULT: \$\{\{ needs\.enforce\.result \}\}/g)).toHaveLength(2);
    expect(branchWorkflow.match(/test "\$ENFORCE_RESULT" = "success"/g)).toHaveLength(2);
    expect(branchWorkflow).toContain('test "$BASE_REF" = "staging"');
    expect(branchWorkflow).toContain('test "$BASE_REF" = "main"');
  });
});
