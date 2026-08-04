import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Library panel responsive styling", () => {
  const stylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

  it("uses opaque Settings surfaces for the Library shell and results", () => {
    expect(stylesheet).toMatch(/\.library-panel\s*\{[^}]*background:\s*var\(--surface\)/s);
    expect(stylesheet).toMatch(/\.library-panel-sidebar\s*\{[^}]*background:\s*var\(--surface-2\)/s);
    expect(stylesheet).toMatch(/\.library-unified-list\s*\{[^}]*background:\s*var\(--surface-2\)/s);
  });

  it("sizes desktop Site selection checkboxes to 28 pixels", () => {
    expect(stylesheet).toMatch(/\.library-site-select\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/s);
  });

  it("keeps metadata left aligned and centers row actions in the right column", () => {
    expect(stylesheet).toMatch(/\.library-unified-item\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto[^}]*align-items:\s*center/s);
    expect(stylesheet).toMatch(/\.library-simulation-item\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
    expect(stylesheet).toMatch(/\.library-item-meta\s*\{[^}]*justify-content:\s*flex-start/s);
    expect(stylesheet).toMatch(/\.library-item-actions\s*\{[^}]*align-self:\s*center/s);
  });
});
