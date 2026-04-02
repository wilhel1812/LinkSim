import { describe, expect, it } from "vitest";
import { canRunDeepLinkApply } from "./deepLinkApplyGate";

describe("canRunDeepLinkApply", () => {
  it("allows readonly guest deep links without cloud init settle", () => {
    expect(
      canRunDeepLinkApply({
        accessState: "readonly",
        deepLinkAlreadyApplied: false,
        isInitializing: false,
        cloudInitSettled: false,
      }),
    ).toBe(true);
  });

  it("requires cloud init settled for granted users", () => {
    expect(
      canRunDeepLinkApply({
        accessState: "granted",
        deepLinkAlreadyApplied: false,
        isInitializing: false,
        cloudInitSettled: false,
      }),
    ).toBe(false);
  });

  it("blocks while checking, pending, or locked", () => {
    expect(
      canRunDeepLinkApply({
        accessState: "checking",
        deepLinkAlreadyApplied: false,
        isInitializing: false,
        cloudInitSettled: true,
      }),
    ).toBe(false);
    expect(
      canRunDeepLinkApply({
        accessState: "pending",
        deepLinkAlreadyApplied: false,
        isInitializing: false,
        cloudInitSettled: true,
      }),
    ).toBe(false);
    expect(
      canRunDeepLinkApply({
        accessState: "locked",
        deepLinkAlreadyApplied: false,
        isInitializing: false,
        cloudInitSettled: true,
      }),
    ).toBe(false);
  });
});
