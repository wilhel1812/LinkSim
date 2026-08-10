/// <reference types="node" />

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const scriptPath = resolve(process.cwd(), "scripts/validate-prod-promotion.mjs");

const evaluatePolicy = (expression: string) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { validatePromotionInputs } from ${JSON.stringify(scriptPath)};
       try {
         const result = ${expression};
         console.log(JSON.stringify({ ok: true, value: result }));
       } catch (error) {
         console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
       }`,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as { ok: true; value: unknown } | { ok: false; message: string };
};

describe("prod promotion policy", () => {
  it("accepts a release tag whose tree matches main HEAD", () => {
    const result = evaluatePolicy(`validatePromotionInputs({
        version: "0.19.0",
        tagCommit: "15269c7682a0671824a7dfe532f67e30b3b052da",
        treesMatch: true,
      })`);

    expect(result).toEqual({ ok: true, value: "v0.19.0" });
  });

  it("rejects missing release tags", () => {
    const result = evaluatePolicy(`validatePromotionInputs({
        version: "0.19.0",
        tagCommit: "",
        treesMatch: true,
      })`);

    expect(result).toEqual({ ok: false, message: "Prod promotion gate failed: release tag v0.19.0 does not exist." });
  });

  it("rejects non-base SemVer package versions", () => {
    const result = evaluatePolicy(`validatePromotionInputs({
        version: "0.27.0-beta",
        tagCommit: "15269c7682a0671824a7dfe532f67e30b3b052da",
        treesMatch: true,
      })`);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("valid base SemVer");
  });

  it("rejects production-only tree changes", () => {
    const result = evaluatePolicy(`validatePromotionInputs({
        version: "0.19.0",
        tagCommit: "15269c7682a0671824a7dfe532f67e30b3b052da",
        treesMatch: false,
      })`);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("main HEAD tree differs from release tag v0.19.0");
  });
});
