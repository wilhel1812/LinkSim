export type AccessUserLike = {
  id: string;
  isAdmin: boolean;
  isModerator?: boolean;
  isApproved: boolean;
  approvedAt?: string | null;
  approvedByUserId?: string | null;
};

export type AccountState = "pending" | "approved" | "revoked";
export type UserRole = "admin" | "moderator" | "user" | "pending";

export const deriveAccountState = (user: AccessUserLike): AccountState => {
  if (user.isAdmin || user.isModerator || user.isApproved) return "approved";
  if (user.approvedAt || user.approvedByUserId) return "revoked";
  return "pending";
};

export const deriveUserRole = (user: AccessUserLike): UserRole => {
  if (user.isAdmin) return "admin";
  if (user.isModerator) return "moderator";
  if (user.isApproved) return "user";
  return "pending";
};

export const canListUsers = (user: AccessUserLike): boolean => user.isAdmin || Boolean(user.isModerator);

const canModeratePendingOrUser = (actor: AccessUserLike, target: AccessUserLike): boolean => {
  if (actor.id === target.id) return false;
  if (actor.isAdmin) return true;
  if (!actor.isModerator) return false;
  if (target.isAdmin || target.isModerator) return false;
  return true;
};

export const canUpdateUserRole = (actor: AccessUserLike, targetUserId: string): boolean =>
  actor.isAdmin && actor.id !== targetUserId;

export const canUpdateUserApproval = (actor: AccessUserLike, targetUserId: string): boolean =>
  (actor.isAdmin || Boolean(actor.isModerator)) && actor.id !== targetUserId;

export const canAssignRole = (
  actor: AccessUserLike,
  target: AccessUserLike,
  nextRole: UserRole,
): boolean => {
  if (actor.id === target.id) return false;
  if (actor.isAdmin) return true;
  if (!actor.isModerator) return false;
  if (target.isAdmin || target.isModerator) return false;
  return target.isApproved ? nextRole === "pending" : nextRole === "user";
};

export const canSetPendingOrUser = (actor: AccessUserLike, target: AccessUserLike): boolean =>
  canModeratePendingOrUser(actor, target);

export const canDeleteUserAccount = (actor: AccessUserLike, targetUserId: string): boolean =>
  actor.isAdmin && actor.id !== targetUserId;
