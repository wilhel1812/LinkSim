import { describe, expect, it } from "vitest";
import { getOnboardingSeenKey } from "./useOnboardingFlow";

describe("getOnboardingSeenKey", () => {
  it("uses the onboarding key prefix", () => {
    expect(getOnboardingSeenKey("user-123")).toBe("linksim:onboarding-seen:v1:user-123");
  });
});
