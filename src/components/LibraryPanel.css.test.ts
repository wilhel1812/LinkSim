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
});
