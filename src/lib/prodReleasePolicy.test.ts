/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/validate-prod-release.mjs");

const evaluatePolicy = (expression: string) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { validateReleaseVersionInputs } from ${JSON.stringify(scriptPath)};
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

describe("production release version policy", () => {
  it("accepts a version selected before the final release commit", () => {
    expect(
      evaluatePolicy(`validateReleaseVersionInputs({
        version: "0.27.0",
        previousProductionVersion: "0.26.2",
        hasMatchingHeadTag: true,
      })`),
    ).toEqual({ ok: true, value: "v0.27.0" });
  });

  it.each([
    ["0.26.2", "0.26.2", true],
    ["0.26.1", "0.26.2", true],
    ["0.27.0", "0.26.2", false],
    ["0.27.0-beta", "0.26.2", true],
  ])("rejects invalid release transition %s after %s", (version, previousProductionVersion, hasMatchingHeadTag) => {
    expect(
      evaluatePolicy(`validateReleaseVersionInputs({
        version: ${JSON.stringify(version)},
        previousProductionVersion: ${JSON.stringify(previousProductionVersion)},
        hasMatchingHeadTag: ${hasMatchingHeadTag},
      })`).ok,
    ).toBe(false);
  });
});
