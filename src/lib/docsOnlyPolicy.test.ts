/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/docs-only-policy.mjs");

const evaluatePolicy = (expression: string) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { classifyDocumentationPaths, isDocumentationOnlyPath } from ${JSON.stringify(scriptPath)};
       console.log(JSON.stringify(${expression}));`,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as unknown;
};

describe("documentation-only change policy", () => {
  it.each([
    "docs/release-flow.md",
    "docs/operations/incident.png",
    "AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
  ])("allows %s", (path) => {
    expect(
      evaluatePolicy(`isDocumentationOnlyPath(${JSON.stringify(path)})`),
    ).toBe(true);
  });

  it.each([
    "CHANGELOG.md",
    "public/guide.md",
    "src/README.md",
    ".github/workflows/deploy-pages.yml",
    "scripts/docs-only-policy.mjs",
    ".agents/skills/example/SKILL.md",
    "../README.md",
  ])("rejects %s", (path) => {
    expect(
      evaluatePolicy(`isDocumentationOnlyPath(${JSON.stringify(path)})`),
    ).toBe(false);
  });

  it("rejects empty and mixed diffs", () => {
    expect(evaluatePolicy("classifyDocumentationPaths([])")).toEqual({
      docsOnly: false,
      changedPaths: [],
      disallowedPaths: [],
    });

    expect(
      evaluatePolicy(
        'classifyDocumentationPaths(["docs/release-flow.md", "src/App.tsx"])',
      ),
    ).toEqual({
      docsOnly: false,
      changedPaths: ["docs/release-flow.md", "src/App.tsx"],
      disallowedPaths: ["src/App.tsx"],
    });
  });

  it("accepts a complete documentation-only diff", () => {
    expect(
      evaluatePolicy(
        'classifyDocumentationPaths(["AGENTS.md", "docs/release-flow.md"])',
      ),
    ).toEqual({
      docsOnly: true,
      changedPaths: ["AGENTS.md", "docs/release-flow.md"],
      disallowedPaths: [],
    });
  });
});
