import { describe, expect, it } from "vitest";

import { canShowSaveSelectedLinkAction } from "./selectedPairActions";

describe("canShowSaveSelectedLinkAction", () => {
  it("returns true for editable workspace with a valid two-site pair", () => {
    expect(
      canShowSaveSelectedLinkAction({
        canPersist: true,
        fromSiteId: "site-a",
        toSiteId: "site-b",
      }),
    ).toBe(true);
  });

  it("returns false when workspace is read-only", () => {
    expect(
      canShowSaveSelectedLinkAction({
        canPersist: false,
        fromSiteId: "site-a",
        toSiteId: "site-b",
      }),
    ).toBe(false);
  });

  it("returns false when selection is missing one endpoint", () => {
    expect(
      canShowSaveSelectedLinkAction({
        canPersist: true,
        fromSiteId: "site-a",
        toSiteId: null,
      }),
    ).toBe(false);
  });

  it("returns false when both endpoints are the same site", () => {
    expect(
      canShowSaveSelectedLinkAction({
        canPersist: true,
        fromSiteId: "site-a",
        toSiteId: "site-a",
      }),
    ).toBe(false);
  });

  it("returns true when effective pair exists even if raw selection state is unreliable", () => {
    expect(
      canShowSaveSelectedLinkAction({
        canPersist: true,
        fromSiteId: "from-selected-link",
        toSiteId: "to-selected-link",
      }),
    ).toBe(true);
  });
});
