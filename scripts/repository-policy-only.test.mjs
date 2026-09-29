import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVATION_BUNDLE_PATHS,
  classifyRepositoryPolicyEntries,
  parseRawDiff,
} from "./repository-policy-only.mjs";

const scriptPath = resolve(process.cwd(), "scripts/repository-policy-only.mjs");

const runGit = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const createRepository = (files) => {
  const cwd = mkdtempSync(join(tmpdir(), "linksim-repository-policy-"));
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

const classifyRepository = (cwd, base, head) => {
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
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return readFileSync(outputPath, "utf8");
};

describe("repository-policy-only change policy", () => {
  it("uses the exact seven-file activation bundle allowlist", () => {
    expect([...ACTIVATION_BUNDLE_PATHS]).toEqual([
      ".github/workflows/deploy-pages.yml",
      ".github/workflows/pr-branch-policy.yml",
      "scripts/repository-policy-only.mjs",
      "scripts/repository-policy-only.test.mjs",
      "functions/_lib/docsOnlyWorkflow.test.ts",
      "docs/release-flow.md",
      "docs/documentation-delivery.md",
    ]);
  });

  it("accepts only added or modified regular blobs in the allowlist", () => {
    const entries = [...ACTIVATION_BUNDLE_PATHS].map((path, index) => ({
      oldMode: index === 2 ? "000000" : "100644",
      newMode: index === 2 ? "100644" : "100755",
      status: index === 2 ? "A" : "M",
      path,
      newObjectType: "blob",
    }));

    expect(classifyRepositoryPolicyEntries(entries)).toEqual({
      repositoryPolicyOnly: true,
      changedPaths: [...ACTIVATION_BUNDLE_PATHS],
      rejectedEntries: [],
    });
  });

  it.each([
    ["empty", []],
    ["mixed", [{ oldMode: "100644", newMode: "100644", status: "M", path: "src/App.tsx", newObjectType: "blob" }]],
    ["deletion", [{ oldMode: "100644", newMode: "000000", status: "D", path: "docs/release-flow.md", newObjectType: null }]],
    ["rename", [{ oldMode: "100644", newMode: "100644", status: "R100", path: "docs/release-flow.md", newObjectType: "blob" }]],
    ["type change", [{ oldMode: "100644", newMode: "120000", status: "T", path: "docs/release-flow.md", newObjectType: "blob" }]],
    ["symlink", [{ oldMode: "000000", newMode: "120000", status: "A", path: "docs/release-flow.md", newObjectType: "blob" }]],
    ["gitlink", [{ oldMode: "000000", newMode: "160000", status: "A", path: "docs/release-flow.md", newObjectType: "commit" }]],
    ["non-blob", [{ oldMode: "100644", newMode: "100644", status: "M", path: "docs/release-flow.md", newObjectType: "tree" }]],
    ["unsafe path", [{ oldMode: "100644", newMode: "100644", status: "M", path: "../docs/release-flow.md", newObjectType: "blob" }]],
  ])("rejects a %s diff", (_label, entries) => {
    expect(classifyRepositoryPolicyEntries(entries).repositoryPolicyOnly).toBe(false);
  });

  it.each([
    "",
    ":100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb M",
    ":100644 100644 invalid bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb M\0docs/release-flow.md\0",
    ":100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb M\0docs/release-flow.md\0orphan\0",
  ])("rejects malformed raw diff data", (raw) => {
    expect(() => parseRawDiff(raw)).toThrow();
  });

  it("classifies the complete activation bundle from git metadata", () => {
    const existingPaths = ACTIVATION_BUNDLE_PATHS.filter(
      (path) => !path.startsWith("scripts/repository-policy-only"),
    );
    const cwd = createRepository(
      Object.fromEntries(existingPaths.map((path) => [path, "before\n"])),
    );
    try {
      const base = runGit(cwd, ["rev-parse", "HEAD"]);
      for (const path of existingPaths) {
        writeFileSync(resolve(cwd, path), "after\n");
      }
      for (const path of ACTIVATION_BUNDLE_PATHS.filter((candidate) =>
        candidate.startsWith("scripts/repository-policy-only"),
      )) {
        mkdirSync(resolve(cwd, path, ".."), { recursive: true });
        writeFileSync(resolve(cwd, path), "added\n");
      }
      runGit(cwd, ["add", "--all"]);
      runGit(cwd, ["commit", "-q", "-m", "activation"]);
      const head = runGit(cwd, ["rev-parse", "HEAD"]);

      expect(classifyRepository(cwd, base, head)).toContain(
        "repository_policy_only=true",
      );
      expect(classifyRepository(cwd, base, head)).toContain(
        "repository_policy_changed_count=7",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses a complete no-renames diff so a rename is rejected", () => {
    const cwd = createRepository({ "docs/release-flow.md": "before\n" });
    try {
      const base = runGit(cwd, ["rev-parse", "HEAD"]);
      mkdirSync(resolve(cwd, ".github/workflows"), { recursive: true });
      runGit(cwd, ["mv", "docs/release-flow.md", ".github/workflows/deploy-pages.yml"]);
      runGit(cwd, ["commit", "-q", "-m", "rename"]);
      const head = runGit(cwd, ["rev-parse", "HEAD"]);

      expect(classifyRepository(cwd, base, head)).toContain(
        "repository_policy_only=false",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects non-blob targets from a real git diff", () => {
    const cwd = createRepository({ "docs/release-flow.md": "before\n" });
    try {
      const base = runGit(cwd, ["rev-parse", "HEAD"]);
      rmSync(resolve(cwd, "docs/release-flow.md"));
      symlinkSync("../target", resolve(cwd, "docs/release-flow.md"));
      chmodSync(resolve(cwd, "docs"), 0o755);
      runGit(cwd, ["add", "--all"]);
      runGit(cwd, ["commit", "-q", "-m", "symlink"]);
      const head = runGit(cwd, ["rev-parse", "HEAD"]);

      expect(classifyRepository(cwd, base, head)).toContain(
        "repository_policy_only=false",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed and emits false when classification is unavailable", () => {
    const cwd = createRepository({ "docs/release-flow.md": "before\n" });
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
      expect(readFileSync(outputPath, "utf8")).toBe(
        "repository_policy_only=false\nrepository_policy_changed_count=0\n",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
