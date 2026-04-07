import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("LinkProfileChart startup sizing regression guard", () => {
  it("does not contain hardcoded fallback chart dimensions", () => {
    const sourcePath = path.join(process.cwd(), "src/components/LinkProfileChart.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("useState({ width: 1200, height: 190 })");
    expect(source).not.toContain("{ width: 1200, height: 190 }");
  });
});

