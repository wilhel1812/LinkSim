import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { fetchUserById, type CloudUser } from "../lib/cloudUser";
import { formatDate } from "../lib/locale";
import { getUiErrorMessage } from "../lib/uiError";
import { ActionButton } from "./ActionButton";
import { AvatarBadge } from "./AvatarBadge";
import { FloatingPopover } from "./ui/FloatingPopover";

export type UserProfilePopoverTarget = {
  anchor: HTMLElement;
  userId: string;
};

type ProfileRole = NonNullable<CloudUser["role"]>;

type UserProfilePopoverProps = {
  management?: boolean;
  onClose: () => void;
  onRoleChange?: (user: CloudUser, role: ProfileRole) => Promise<CloudUser>;
  target: UserProfilePopoverTarget | null;
  viewer?: CloudUser | null;
};

const resolveRole = (user: CloudUser): ProfileRole =>
  user.role ?? (user.isAdmin ? "admin" : user.isModerator ? "moderator" : user.isApproved ? "user" : "pending");

const resolveAccess = (user: CloudUser): "approved" | "pending" | "revoked" =>
  user.accountState === "revoked" ? "revoked" : user.isApproved ? "approved" : "pending";

export function UserProfilePopover({
  management = false,
  onClose,
  onRoleChange,
  target,
  viewer = null,
}: UserProfilePopoverProps) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({ current: target?.anchor ?? null }),
    [target?.anchor],
  );
  const privileged = Boolean(viewer?.isAdmin || viewer?.isModerator);
  const canManage = privileged && management && Boolean(onRoleChange) && viewer?.id !== user?.id;

  useEffect(() => {
    if (!target) {
      setUser(null);
      setBusy(false);
      setStatus("");
      return;
    }
    let cancelled = false;
    setUser(null);
    setStatus("");
    setBusy(true);
    fetchUserById(target.userId)
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser);
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Failed loading user: ${getUiErrorMessage(error)}`);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target?.userId]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, target]);

  const changeRole = async (role: ProfileRole) => {
    if (!user || !onRoleChange) return;
    setBusy(true);
    setStatus("");
    try {
      const updated = await onRoleChange(user, role);
      setUser(updated);
      setStatus(`Updated role for ${updated.username}.`);
    } catch (error) {
      setStatus(`Role update failed: ${getUiErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingPopover
      className="user-profile-popover"
      estimatedHeight={management ? 310 : 230}
      estimatedWidth={320}
      onClose={onClose}
      open={Boolean(target)}
      pointerTail
      triggerRef={triggerRef}
    >
      <div
        aria-label={user ? `User profile for ${user.username}` : "User profile"}
        className="user-profile-popover-content"
        role="dialog"
      >
        {busy && !user ? <p className="field-help user-profile-popover-status">Loading user…</p> : null}
        {user ? (
          <>
            <div className="user-profile-popover-identity">
              <AvatarBadge
                avatarUrl={user.avatarUrl}
                imageClassName="profile-avatar user-profile-popover-avatar"
                name={user.username}
              />
              <div>
                <strong>{user.username}</strong>
                {user.email ? <p className="field-help">{user.email}</p> : null}
              </div>
            </div>
            {user.bio ? <p className="user-profile-popover-bio">{user.bio}</p> : null}
            <p className="field-help user-profile-popover-joined">Joined {formatDate(user.createdAt)}</p>
            {privileged ? (
              <dl className="user-profile-popover-private-meta">
                <div><dt>ID</dt><dd>{user.id}</dd></div>
                <div><dt>Role</dt><dd>{resolveRole(user)}</dd></div>
                <div><dt>Access</dt><dd>{resolveAccess(user)}</dd></div>
              </dl>
            ) : null}
            {canManage ? (
              <div className="user-profile-popover-management">
                <label>
                  <span>Role</span>
                  <select
                    aria-label={`Role for ${user.username}`}
                    className="locale-select"
                    disabled={busy}
                    onChange={(event) => void changeRole(event.target.value as ProfileRole)}
                    value={resolveRole(user)}
                  >
                    <option value="pending">Pending</option>
                    <option value="user">User</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                {!user.isApproved ? (
                  <ActionButton disabled={busy} onClick={() => void changeRole("user")} type="button">
                    Approve Access
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {status ? <p className="field-help user-profile-popover-status" role={user ? "status" : "alert"}>{status}</p> : null}
      </div>
    </FloatingPopover>
  );
}
