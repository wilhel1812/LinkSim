import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/codeql.yml", import.meta.url);

describe("CodeQL workflow", () => {
  it("scans protected branches and pull requests with least privilege", () => {
    const source = readFileSync(workflowUrl, "utf8");

    expect(source).toMatch(/push:\s*\n\s*branches: \[main, staging\]/);
    expect(source).toMatch(/pull_request:\s*\n\s*branches: \[main, staging\]/);
    expect(source).toContain("schedule:");
    expect(source).not.toContain("pull_request_target");
    expect(source).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(source).toMatch(/security-events: write/);
  });

  it("pins the introduced actions and analyzes JavaScript and TypeScript", () => {
    const source = readFileSync(workflowUrl, "utf8");

    expect(source).toContain("actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955");
    expect(source).toContain("github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2");
    expect(source).toContain("github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2");
    expect(source).toContain("language: javascript-typescript");
    expect(source).toContain("build-mode: none");
  });
});
