import { describe, expect, it } from "vitest";
import { isAuthSignInRequiredMessage, shouldRewritePathAfterDeepLinkApply } from "./appShellGuards";

describe("shouldRewritePathAfterDeepLinkApply", () => {
  it("rewrites only after successful deep-link apply", () => {
    expect(
      shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: true,
        deepLinkParseOk: true,
        deepLinkApplyOutcome: "succeeded",
      }),
    ).toBe(true);

    expect(
      shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: true,
        deepLinkParseOk: true,
        deepLinkApplyOutcome: "failed",
      }),
    ).toBe(false);
  });

  it("allows non-deeplink rewrites once applied", () => {
    expect(
      shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: true,
        deepLinkParseOk: false,
        deepLinkApplyOutcome: "idle",
      }),
    ).toBe(true);
  });
});

describe("isAuthSignInRequiredMessage", () => {
  it("detects unauthorized or auth-required messages", () => {
    expect(isAuthSignInRequiredMessage("Unauthorized")).toBe(true);
    expect(isAuthSignInRequiredMessage("401 Unauthorized")).toBe(true);
    expect(isAuthSignInRequiredMessage("Authentication required")).toBe(true);
    expect(isAuthSignInRequiredMessage("Load failed")).toBe(true);
    expect(isAuthSignInRequiredMessage("Failed to fetch")).toBe(true);
    expect(isAuthSignInRequiredMessage("Sign in · Cloudflare Access")).toBe(true);
    expect(isAuthSignInRequiredMessage("You are signed out. Sign in to continue.")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isAuthSignInRequiredMessage("Network timeout")).toBe(false);
    expect(isAuthSignInRequiredMessage("This shared simulation is unavailable.")).toBe(false);
  });
});
