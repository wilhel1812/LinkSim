import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  canDeleteUserAccount,
  canListUsers,
  canSetPendingOrUser,
  deriveAccountState,
  deriveUserRole,
  type AccessUserLike,
} from "./access";

const makeUser = (patch: Partial<AccessUserLike>): AccessUserLike => ({
  id: patch.id ?? "u1",
  isAdmin: patch.isAdmin ?? false,
  isModerator: patch.isModerator ?? false,
  isApproved: patch.isApproved ?? false,
  approvedAt: patch.approvedAt ?? null,
  approvedByUserId: patch.approvedByUserId ?? null,
});

describe("access matrix", () => {
  it("derives account lifecycle deterministically", () => {
    expect(deriveAccountState(makeUser({ isApproved: false, approvedAt: null }))).toBe("pending");
    expect(deriveAccountState(makeUser({ isApproved: true }))).toBe("approved");
    expect(deriveAccountState(makeUser({ isAdmin: true, isApproved: false }))).toBe("approved");
    expect(deriveAccountState(makeUser({ isModerator: true, isApproved: false }))).toBe("approved");
    expect(deriveAccountState(makeUser({ isApproved: false, approvedAt: "2026-01-01T00:00:00Z" }))).toBe(
      "revoked",
    );
  });

  it("enforces admin/moderator list and role assignment limits", () => {
    const admin = makeUser({ id: "admin", isAdmin: true, isApproved: true });
    const moderator = makeUser({ id: "mod", isModerator: true, isApproved: true });
    const normal = makeUser({ id: "user", isAdmin: false, isApproved: true });
    const pending = makeUser({ id: "pending", isApproved: false });

    expect(canListUsers(admin)).toBe(true);
    expect(canListUsers(moderator)).toBe(true);
    expect(canListUsers(normal)).toBe(false);

    expect(deriveUserRole(admin)).toBe("admin");
    expect(deriveUserRole(moderator)).toBe("moderator");
    expect(deriveUserRole(normal)).toBe("user");
    expect(deriveUserRole(pending)).toBe("pending");

    expect(canAssignRole(admin, normal, "moderator")).toBe(true);
    expect(canAssignRole(admin, admin, "user")).toBe(false);
    expect(canAssignRole(moderator, normal, "pending")).toBe(true);
    expect(canAssignRole(moderator, normal, "admin")).toBe(false);
    expect(canAssignRole(moderator, admin, "pending")).toBe(false);
    expect(canAssignRole(normal, pending, "user")).toBe(false);

    expect(canSetPendingOrUser(admin, normal)).toBe(true);
    expect(canSetPendingOrUser(moderator, normal)).toBe(true);
    expect(canSetPendingOrUser(moderator, admin)).toBe(false);

    expect(canDeleteUserAccount(admin, "user")).toBe(true);
    expect(canDeleteUserAccount(admin, "admin")).toBe(false);
    expect(canDeleteUserAccount(normal, "admin")).toBe(false);
  });
});
