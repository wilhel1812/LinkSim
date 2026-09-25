import { describe, expect, it } from "vitest";

import {
  parseRecoveryAuthorization,
  parseRecoveryRevocation,
  resolveRecoveryDatabase,
} from "./manage-admin-passkey-recovery.mjs";

describe("administrator passkey recovery operator output", () => {
  const authorizationId = "67eef596-ce53-4c91-918d-54f200cabee9";

  it("requires an explicit, allowlisted environment", () => {
    expect(resolveRecoveryDatabase("staging")).toBe("linksim_staging");
    expect(resolveRecoveryDatabase("production")).toBe("linksim");
    expect(() => resolveRecoveryDatabase("preview")).toThrow("exactly staging or production");
    expect(() => resolveRecoveryDatabase(undefined)).toThrow("exactly staging or production");
  });

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

  it("returns the exact revoked authorization row", () => {
    const row = {
      id: authorizationId,
      revoked_at: "2026-09-23T15:00:00.000Z",
    };
    expect(parseRecoveryRevocation(JSON.stringify([{
      results: [row], success: true,
    }]), authorizationId)).toEqual(row);
  });

  it("fails when a revocation UUID returns no row", () => {
    expect(() => parseRecoveryRevocation(JSON.stringify([{
      results: [], success: true,
    }]), authorizationId)).toThrow("D1 recovery revocation returned no rows.");
  });

  it("fails when the returned authorization remains active", () => {
    expect(() => parseRecoveryRevocation(JSON.stringify([{
      results: [{ id: authorizationId, revoked_at: null }], success: true,
    }]), authorizationId)).toThrow("Recovery authorization was not revoked");
  });
});
