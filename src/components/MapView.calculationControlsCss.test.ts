import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared ghost button styling", () => {
  it("keeps every ghost button flat without scoped shadow overrides", () => {
    const stylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const ghostRules = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1]?.includes(".btn-ghost") && match[2]?.includes("box-shadow"))
      .map((match) => ({ selector: match[1]?.trim(), declarations: match[2] }));

    expect(ghostRules).toHaveLength(1);
    expect(ghostRules[0]?.selector).toBe(".btn-ghost");
    expect(ghostRules[0]?.declarations).toMatch(/box-shadow:\s*none;/);
  });
});
