import { describe, expect, it } from "vitest";
import {
  canDeleteUserAccount,
  canListUsers,
  canUpdateUserApproval,
  canUpdateUserRole,
  deriveAccountState,
  type AccessUserLike,
} from "./access";

const makeUser = (patch: Partial<AccessUserLike>): AccessUserLike => ({
  id: patch.id ?? "u1",
  isAdmin: patch.isAdmin ?? false,
  isApproved: patch.isApproved ?? false,
  approvedAt: patch.approvedAt ?? null,
  approvedByUserId: patch.approvedByUserId ?? null,
});

describe("access matrix", () => {
  it("derives account lifecycle deterministically", () => {
    expect(deriveAccountState(makeUser({ isApproved: false, approvedAt: null }))).toBe("pending");
    expect(deriveAccountState(makeUser({ isApproved: true }))).toBe("approved");
    expect(deriveAccountState(makeUser({ isAdmin: true, isApproved: false }))).toBe("approved");
    expect(deriveAccountState(makeUser({ isApproved: false, approvedAt: "2026-01-01T00:00:00Z" }))).toBe(
      "revoked",
    );
  });

  it("enforces admin-only list and disallows self-moderation", () => {
    const admin = makeUser({ id: "admin", isAdmin: true, isApproved: true });
    const normal = makeUser({ id: "user", isAdmin: false, isApproved: true });

    expect(canListUsers(admin)).toBe(true);
    expect(canListUsers(normal)).toBe(false);

    expect(canUpdateUserRole(admin, "user")).toBe(true);
    expect(canUpdateUserRole(admin, "admin")).toBe(false);
    expect(canUpdateUserRole(normal, "admin")).toBe(false);

    expect(canUpdateUserApproval(admin, "user")).toBe(true);
    expect(canUpdateUserApproval(admin, "admin")).toBe(false);
    expect(canUpdateUserApproval(normal, "admin")).toBe(false);

    expect(canDeleteUserAccount(admin, "user")).toBe(true);
    expect(canDeleteUserAccount(admin, "admin")).toBe(false);
    expect(canDeleteUserAccount(normal, "admin")).toBe(false);
  });
});

