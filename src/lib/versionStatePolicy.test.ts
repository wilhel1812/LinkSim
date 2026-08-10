/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/version-state.mjs");

const evaluatePolicy = (expression: string) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { validatePackageVersionParity, validateStagingVersionState } from ${JSON.stringify(scriptPath)};
       try {
         const result = ${expression};
         console.log(JSON.stringify({ ok: true, value: result }));
       } catch (error) {
         console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
       }`,
    ],
    { encoding: "utf8" },
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

  it.each(["0.28.0", "0.26.4", "0.25.9", "1.0.0", "0.27.0-beta"])(
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
