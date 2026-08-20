import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

const declarationsFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  return match?.[1] ?? "";
};

describe("site notice route layout", () => {
  it("makes the content area a containing block for mobile fixed controls", () => {
    const content = declarationsFor(".site-notice-app-content");
    expect(content).toContain("position: relative");
    expect(content).toContain("contain: layout paint");

    const mobileShell = declarationsFor(".app-shell.is-mobile-shell");
    expect(mobileShell).toContain("height: 100%");
    expect(mobileShell).toContain("min-height: 100%");

    const mobileMap = declarationsFor(".app-shell.is-mobile-shell .map-panel");
    expect(mobileMap).toContain("position: fixed");
    expect(mobileMap).toContain("inset: 0");
    expect(mobileMap).toContain("height: 100%");
  });

  it("keeps the composed UI gallery route vertically scrollable", () => {
    const gallery = declarationsFor(".site-notice-app-content > .ui-gallery-page");
    expect(gallery).toContain("height: 100%");
    expect(gallery).toContain("overflow-y: auto");
  });

  it("keeps the site notice below the top device safe area", () => {
    const banner = declarationsFor(".site-notice-banner");
    expect(banner).toContain("calc(6px + env(safe-area-inset-top))");
    expect(banner).toContain("env(safe-area-inset-right)");
    expect(banner).toContain("env(safe-area-inset-left)");
  });
});
