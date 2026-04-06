import { describe, expect, it } from "vitest";
import { isProfileSelectionEligible, nextProfileHiddenForSelectionChange } from "./profilePanelVisibility";

describe("isProfileSelectionEligible", () => {
  it("returns true for single-site selection", () => {
    expect(isProfileSelectionEligible(1)).toBe(true);
  });

  it("returns true for two-site selection", () => {
    expect(isProfileSelectionEligible(2)).toBe(true);
  });

  it("returns false when no site is selected", () => {
    expect(isProfileSelectionEligible(0)).toBe(false);
  });

  it("returns false when more than two sites are selected", () => {
    expect(isProfileSelectionEligible(3)).toBe(false);
  });
});

describe("nextProfileHiddenForSelectionChange", () => {
  it("auto-hides profile when selection transitions from two to three sites", () => {
    expect(
      nextProfileHiddenForSelectionChange({
        nextSelectedSiteCount: 3,
      }),
    ).toBe(true);
  });

  it("auto-hides profile when selection transitions from two sites to zero", () => {
    expect(
      nextProfileHiddenForSelectionChange({
        nextSelectedSiteCount: 0,
      }),
    ).toBe(true);
  });

  it("auto-unhides profile when selection becomes valid", () => {
    expect(
      nextProfileHiddenForSelectionChange({
        nextSelectedSiteCount: 1,
      }),
    ).toBe(false);
  });

  it("keeps profile open for valid selection when it is already visible", () => {
    expect(
      nextProfileHiddenForSelectionChange({
        nextSelectedSiteCount: 2,
      }),
    ).toBe(false);
  });
});
