import { describe, expect, it } from "vitest";
import {
  parseWranglerRows,
  validateIdentityLifecycleProbe,
} from "../../scripts/verify-identity-lifecycle-d1.mjs";

describe("identity lifecycle D1 deployment probe", () => {
  it("parses Wrangler JSON and accepts a complete post-migration state", () => {
    const [row] = parseWranglerRows(`warning\n[{"results":[{"duplicate_verified_emails":0,"unresolved_tombstones":0,"missing_verified_claims":0,"missing_current_subjects":0,"invalid_active_claims":0,"unconsumed_existing_bootstraps":0,"version":"2026-08-12-identity-lifecycle-v1"}]}]`);
    expect(() => validateIdentityLifecycleProbe("post", row)).not.toThrow();
  });

  it("fails closed for historical tombstones, collisions, or incomplete backfill", () => {
    expect(() => validateIdentityLifecycleProbe("pre", { duplicate_verified_emails: 0, unresolved_tombstones: 1 })).toThrow("unresolved_tombstones=1");
    expect(() => validateIdentityLifecycleProbe("pre", { duplicate_verified_emails: 1, unresolved_tombstones: 0 })).toThrow("duplicate_verified_emails=1");
    expect(() => validateIdentityLifecycleProbe("post", {
      duplicate_verified_emails: 0,
      unresolved_tombstones: 0,
      missing_verified_claims: 1,
      missing_current_subjects: 0,
      invalid_active_claims: 0,
      unconsumed_existing_bootstraps: 0,
      version: "2026-08-12-identity-lifecycle-v1",
    })).toThrow("missing_verified_claims=1");
  });
});
