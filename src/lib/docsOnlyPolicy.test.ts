/// <reference types="node" />

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/docs-only-policy.mjs");

const runGit = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const createRepository = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), "linksim-docs-policy-"));
  runGit(cwd, ["init", "-q"]);
  runGit(cwd, ["config", "user.name", "LinkSim test"]);
  runGit(cwd, ["config", "user.email", "linksim-test@example.invalid"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(resolve(cwd, path, ".."), { recursive: true });
    writeFileSync(resolve(cwd, path), content);
  }
  runGit(cwd, ["add", "--all"]);
  runGit(cwd, ["commit", "-q", "-m", "base"]);
  return cwd;
};

const classifyRepository = (cwd: string, base: string, head: string) => {
  const outputPath = resolve(cwd, "github-output.txt");
  execFileSync(
    process.execPath,
    [
      scriptPath,
      "classify",
      "--base",
      base,
      "--head",
      head,
      "--mode",
      "two-dot",
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return readFileSync(outputPath, "utf8");
};

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

  it.each([
    ["docs/removed.md", true],
    ["src/removed.ts", false],
  ])("classifies deletion of %s as docsOnly=%s", (path, expected) => {
    const cwd = createRepository({ [path]: "tracked\n" });
    try {
      const base = runGit(cwd, ["rev-parse", "HEAD"]);
      unlinkSync(resolve(cwd, path));
      runGit(cwd, ["add", "--all"]);
      runGit(cwd, ["commit", "-q", "-m", "delete"]);
      const head = runGit(cwd, ["rev-parse", "HEAD"]);
      expect(classifyRepository(cwd, base, head)).toContain(
        `docs_only=${expected ? "true" : "false"}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects an excluded file renamed into docs", () => {
    const cwd = createRepository({ "src/application.md": "tracked\n" });
    try {
      const base = runGit(cwd, ["rev-parse", "HEAD"]);
      mkdirSync(resolve(cwd, "docs"), { recursive: true });
      runGit(cwd, ["mv", "src/application.md", "docs/application.md"]);
      runGit(cwd, ["commit", "-q", "-m", "rename"]);
      const head = runGit(cwd, ["rev-parse", "HEAD"]);

      expect(classifyRepository(cwd, base, head)).toContain("docs_only=false");
      expect(() =>
        execFileSync(
          process.execPath,
          [
            scriptPath,
            "require",
            "--base",
            base,
            "--head",
            head,
            "--mode",
            "two-dot",
          ],
          { cwd, stdio: ["ignore", "pipe", "pipe"] },
        ),
      ).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to deployment for classify errors but fails require", () => {
    const cwd = createRepository({ "docs/current.md": "tracked\n" });
    try {
      const head = runGit(cwd, ["rev-parse", "HEAD"]);
      const outputPath = resolve(cwd, "github-output.txt");
      expect(() =>
        execFileSync(
          process.execPath,
          [
            scriptPath,
            "classify",
            "--base",
            "not-a-sha",
            "--head",
            head,
            "--mode",
            "two-dot",
          ],
          {
            cwd,
            env: { ...process.env, GITHUB_OUTPUT: outputPath },
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      ).not.toThrow();
      expect(readFileSync(outputPath, "utf8")).toContain("docs_only=false");

      expect(() =>
        execFileSync(
          process.execPath,
          [
            scriptPath,
            "require",
            "--base",
            "not-a-sha",
            "--head",
            head,
            "--mode",
            "two-dot",
          ],
          { cwd, stdio: ["ignore", "pipe", "pipe"] },
        ),
      ).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
