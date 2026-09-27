/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/version-state.mjs");

const evaluatePolicy = (expression: string, cwd?: string) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { validatePackageVersionParity, validateStagingVersionState, validateCurrentStagingVersionState, isTaggedSkippedPatchCandidate, isTagInStagingHistory } from ${JSON.stringify(scriptPath)};
       try {
         const result = ${expression};
         console.log(JSON.stringify({ ok: true, value: result }));
       } catch (error) {
         console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
       }`,
    ],
    { encoding: "utf8", cwd },
  );
  return JSON.parse(output) as
    | { ok: true; value: unknown }
    | { ok: false; message: string };
};

describe("staging version-state policy", () => {
  it.each([
    ["0.26.2", "0.27.0"],
    ["0.27.0", "0.26.2"],
  ])(
    "rejects package-lock versions %s / %s that differ from package.json",
    (lockfileVersion, lockfileRootVersion) => {
      const result = evaluatePolicy(`validatePackageVersionParity({
        packageVersion: "0.27.0",
        lockfileVersion: ${JSON.stringify(lockfileVersion)},
        lockfileRootVersion: ${JSON.stringify(lockfileRootVersion)},
        label: "staging",
      })`);

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toContain("package-lock.json");
    },
  );

  it("permits the production version while the trees are identical", () => {
    expect(
      evaluatePolicy(`validateStagingVersionState({
        productionVersion: "0.26.2",
        stagingVersion: "0.26.2",
        treesMatch: true,
      })`),
    ).toEqual({ ok: true, value: "same-release-tree" });
  });

  it("requires an explicit development version when staging diverges", () => {
    const result = evaluatePolicy(`validateStagingVersionState({
      productionVersion: "0.26.2",
      stagingVersion: "0.26.2",
      treesMatch: false,
    })`);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(
      "diverged from production without selecting",
    );
  });

  it.each([
    ["0.27.0", "next-minor"],
    ["0.26.3", "next-patch"],
    ["1.0.0", "next-major"],
  ])("accepts the explicit %s development line", (stagingVersion, progression) => {
    expect(
      evaluatePolicy(`validateStagingVersionState({
        productionVersion: "0.26.2",
        stagingVersion: ${JSON.stringify(stagingVersion)},
        treesMatch: false,
      })`),
    ).toEqual({
      ok: true,
      value: { state: "development-line", progression },
    });
  });

  it("accepts a later patch only when every skipped candidate has a tag", () => {
    expect(
      evaluatePolicy(`validateStagingVersionState({
        productionVersion: "0.26.2",
        stagingVersion: "0.26.4",
        treesMatch: false,
        skippedPatchTags: ["v0.26.3"],
      })`),
    ).toEqual({
      ok: true,
      value: { state: "development-line", progression: "tagged-skipped-patch" },
    });

    expect(
      evaluatePolicy(`validateStagingVersionState({
        productionVersion: "0.26.2",
        stagingVersion: "0.26.5",
        treesMatch: false,
        skippedPatchTags: ["v0.26.3"],
      })`).ok,
    ).toBe(false);
  });

  it("requires a skipped tag to declare its own version in both package files", () => {
    const packageContent = JSON.stringify({ version: "0.26.2" });
    const lockfileContent = JSON.stringify({
      version: "0.26.2",
      packages: { "": { version: "0.26.2" } },
    });
    expect(
      evaluatePolicy(`isTaggedSkippedPatchCandidate({
        expectedVersion: "0.26.3",
        packageContent: ${JSON.stringify(packageContent)},
        lockfileContent: ${JSON.stringify(lockfileContent)},
      })`),
    ).toEqual({ ok: true, value: false });

    expect(
      evaluatePolicy(`isTaggedSkippedPatchCandidate({
        expectedVersion: "0.26.2",
        packageContent: ${JSON.stringify(packageContent)},
        lockfileContent: ${JSON.stringify(lockfileContent)},
      })`),
    ).toEqual({ ok: true, value: true });
  });

  it("accepts an exact-tree release tag only when its tree is in staging history", () => {
    expect(
      evaluatePolicy(`isTagInStagingHistory({
        taggedCommit: "release-commit",
        taggedCommitIsAncestor: false,
        taggedTree: "verified-tree",
        stagingHistoryTrees: ["older-tree", "verified-tree"],
      })`),
    ).toEqual({ ok: true, value: true });

    expect(
      evaluatePolicy(`isTagInStagingHistory({
        taggedCommit: "release-commit",
        taggedCommitIsAncestor: false,
        taggedTree: "unrelated-tree",
        stagingHistoryTrees: ["older-tree", "verified-tree"],
      })`),
    ).toEqual({ ok: true, value: false });

    expect(
      evaluatePolicy(`isTagInStagingHistory({
        taggedCommit: "",
        taggedCommitIsAncestor: false,
        taggedTree: "verified-tree",
        stagingHistoryTrees: ["verified-tree"],
      })`),
    ).toEqual({ ok: true, value: false });
  });

  it("accepts a commit-valued exact-tree tag but rejects a tree-valued skipped tag", () => {
    const directory = mkdtempSync(join(tmpdir(), "linksim-version-state-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
    const writeVersion = (version: string) => {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
      writeFileSync(join(directory, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
      git("add", "package.json", "package-lock.json");
      git("commit", "-qm", `prepare ${version}`);
    };

    try {
      git("init", "-q", "-b", "staging");
      git("config", "user.name", "Version State Test");
      git("config", "user.email", "version-state@example.invalid");
      writeVersion("0.29.5");
      git("branch", "production");

      git("checkout", "-q", "-b", "release");
      writeVersion("0.29.6");
      const releaseCommit = git("rev-parse", "HEAD");
      const releaseTree = git("rev-parse", "HEAD^{tree}");

      git("checkout", "-q", "staging");
      writeVersion("0.29.6");
      expect(git("rev-parse", "HEAD^{tree}")).toBe(releaseTree);
      writeVersion("0.29.7");

      git("tag", "v0.29.6", releaseCommit);
      expect(evaluatePolicy(
        'validateCurrentStagingVersionState({ productionRef: "production" })',
        directory,
      )).toEqual({
        ok: true,
        value: {
          productionVersion: "0.29.5",
          stagingVersion: "0.29.7",
          result: { state: "development-line", progression: "tagged-skipped-patch" },
        },
      });

      git("tag", "-f", "v0.29.6", releaseTree);
      const malformed = evaluatePolicy(
        'validateCurrentStagingVersionState({ productionRef: "production" })',
        directory,
      );
      expect(malformed.ok).toBe(false);
      expect(malformed.ok ? "" : malformed.message).toContain("skipped patch candidate");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["0.28.0", "0.26.4", "0.25.9", "2.0.0", "0.27.0-beta"])(
    "rejects implicit, skipped, or malformed line %s",
    (stagingVersion) => {
      expect(
        evaluatePolicy(`validateStagingVersionState({
          productionVersion: "0.26.2",
          stagingVersion: ${JSON.stringify(stagingVersion)},
          treesMatch: false,
        })`).ok,
      ).toBe(false);
    },
  );
});
