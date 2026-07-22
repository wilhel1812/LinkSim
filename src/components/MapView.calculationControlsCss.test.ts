import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MapView calculation control styling", () => {
  it("keeps the labeled calculation controls shadow-free", () => {
    const stylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const controlRule = stylesheet.match(/\.map-calculation-control\.btn-ghost\s*\{([^}]*)\}/)?.[1];

    expect(controlRule).toMatch(/box-shadow:\s*none;/);
  });
});
