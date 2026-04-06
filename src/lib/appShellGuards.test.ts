import { describe, expect, it } from "vitest";
import {
  isAuthSignInRequiredMessage,
  shouldCloseSimulationLibraryOnLoad,
  shouldRewritePathAfterDeepLinkApply,
  shouldUseReadonlyFallbackForAuthBootstrap,
} from "./appShellGuards";

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
    expect(isAuthSignInRequiredMessage("NetworkError when attempting to fetch resource.")).toBe(false);
    expect(isAuthSignInRequiredMessage("This shared simulation is unavailable.")).toBe(false);
  });
});

describe("shouldUseReadonlyFallbackForAuthBootstrap", () => {
  it("uses readonly fallback for Firefox auth bootstrap network failure", () => {
    expect(
      shouldUseReadonlyFallbackForAuthBootstrap({
        message: "NetworkError when attempting to fetch resource.",
        deepLinkMode: false,
        isLocalRuntime: false,
        isOnline: true,
        userAgent: "Mozilla/5.0 Firefox/124.0",
      }),
    ).toBe(true);
  });

  it("does not use readonly fallback for unrelated failures", () => {
    expect(
      shouldUseReadonlyFallbackForAuthBootstrap({
        message: "Network timeout",
        deepLinkMode: false,
        isLocalRuntime: false,
        isOnline: true,
        userAgent: "Mozilla/5.0 Firefox/124.0",
      }),
    ).toBe(false);

    expect(
      shouldUseReadonlyFallbackForAuthBootstrap({
        message: "NetworkError when attempting to fetch resource.",
        deepLinkMode: false,
        isLocalRuntime: false,
        isOnline: true,
        userAgent: "Mozilla/5.0 AppleWebKit Safari/605.1.15",
      }),
    ).toBe(false);
  });

  it("keeps deep-link flow unchanged", () => {
    expect(
      shouldUseReadonlyFallbackForAuthBootstrap({
        message: "NetworkError when attempting to fetch resource.",
        deepLinkMode: true,
        isLocalRuntime: false,
        isOnline: true,
        userAgent: "Mozilla/5.0 Firefox/124.0",
      }),
    ).toBe(false);
  });
});

describe("shouldCloseSimulationLibraryOnLoad", () => {
  it("closes the simulation library modal after selecting a simulation", () => {
    expect(shouldCloseSimulationLibraryOnLoad({ presetId: "sim-123" })).toBe(true);
  });

  it("does not close for empty simulation selection", () => {
    expect(shouldCloseSimulationLibraryOnLoad({ presetId: "" })).toBe(false);
    expect(shouldCloseSimulationLibraryOnLoad({ presetId: "   " })).toBe(false);
  });
});
