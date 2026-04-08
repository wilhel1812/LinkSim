import { describe, expect, it } from "vitest";
import { isActiveMobilePanelTab } from "./MobileWorkspaceTabs";

describe("isActiveMobilePanelTab", () => {
  it("returns true for active panel when mode is visible", () => {
    expect(isActiveMobilePanelTab("normal", "navigator", "navigator")).toBe(true);
  });

  it("returns false for inactive panel", () => {
    expect(isActiveMobilePanelTab("full", "navigator", "inspector")).toBe(false);
  });

  it("returns false when mode is hidden", () => {
    expect(isActiveMobilePanelTab("hidden", "navigator", "navigator")).toBe(false);
  });
});
