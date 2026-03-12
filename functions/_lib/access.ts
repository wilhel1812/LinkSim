export type AccessUserLike = {
  id: string;
  isAdmin: boolean;
  isApproved: boolean;
  approvedAt?: string | null;
  approvedByUserId?: string | null;
};

export type AccountState = "pending" | "approved" | "revoked";

export const deriveAccountState = (user: AccessUserLike): AccountState => {
  if (user.isAdmin || user.isApproved) return "approved";
  if (user.approvedAt || user.approvedByUserId) return "revoked";
  return "pending";
};

export const canListUsers = (user: AccessUserLike): boolean => user.isAdmin;

export const canUpdateUserRole = (actor: AccessUserLike, targetUserId: string): boolean =>
  actor.isAdmin && actor.id !== targetUserId;

export const canUpdateUserApproval = (actor: AccessUserLike, targetUserId: string): boolean =>
  actor.isAdmin && actor.id !== targetUserId;

export const canDeleteUserAccount = (actor: AccessUserLike, targetUserId: string): boolean =>
  actor.isAdmin && actor.id !== targetUserId;

