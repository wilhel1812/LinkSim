import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Panorama chart responsive styling", () => {
  const stylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

  it("keeps expanded chart sizing off panorama label icons", () => {
    expect(stylesheet).toMatch(/\.chart-svg-wrap\s*>\s*svg\s*\{/);
    expect(stylesheet).toMatch(/\.chart-panel\.is-expanded\s+\.chart-svg-wrap\s*>\s*svg\s*\{/);
    expect(stylesheet).toMatch(
      /\.panorama-label-overlay svg\s*\{[^}]*width:\s*10px[^}]*height:\s*10px[^}]*min-height:\s*unset/s,
    );
    expect(stylesheet).not.toMatch(/\.chart-panel\.is-expanded\s+\.chart-svg-wrap\s+svg\s*\{/);
  });
});
