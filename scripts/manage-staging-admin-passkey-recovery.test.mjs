import { describe, expect, it } from "vitest";

import { parseRecoveryAuthorization } from "./manage-staging-admin-passkey-recovery.mjs";

describe("staging administrator passkey recovery operator output", () => {
  const authorizationId = "67eef596-ce53-4c91-918d-54f200cabee9";

  it("returns the exact authorization row created by D1", () => {
    const stdout = `Wrangler output\n${JSON.stringify([{
      results: [{ id: authorizationId, linksim_user_id: "legacy-admin" }],
      success: true,
    }])}`;
    expect(parseRecoveryAuthorization(stdout, authorizationId)).toEqual({
      id: authorizationId,
      linksim_user_id: "legacy-admin",
    });
  });

  it("fails when an ineligible account creates no authorization row", () => {
    expect(() => parseRecoveryAuthorization(JSON.stringify([{
      results: [], success: true,
    }]), authorizationId)).toThrow("D1 recovery authorization returned no rows.");
  });

  it("fails when D1 returns a different authorization row", () => {
    expect(() => parseRecoveryAuthorization(JSON.stringify([{
      results: [{ id: "78d2594f-6ef2-4d59-b8de-d42366a4c420" }], success: true,
    }]), authorizationId)).toThrow("Recovery authorization was not created");
  });
});
