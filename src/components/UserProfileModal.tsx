import type { CloudUser } from "../lib/cloudUser";
import { formatDate } from "../lib/locale";
import { AvatarBadge } from "./AvatarBadge";
import { InlineCloseIconButton } from "./InlineCloseIconButton";
import { ModalOverlay } from "./ModalOverlay";

type UserProfileModalProps = {
  busy?: boolean;
  onClose: () => void;
  status?: string;
  user: CloudUser | null;
};

const UserBadge = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
  <span className="user-list-row">
    <AvatarBadge avatarUrl={avatarUrl} imageClassName="profile-avatar" name={name} />
    <span>{name}</span>
  </span>
);

export function UserProfileModal({ busy = false, onClose, status = "", user }: UserProfileModalProps) {
  return (
    <ModalOverlay aria-label="User Profile" onClose={onClose} tier="raised">
      <div className="library-manager-card user-profile-popup">
        <div className="library-manager-header">
          <h2>User Profile</h2>
          <InlineCloseIconButton onClick={onClose} />
        </div>
        {busy ? <p className="field-help">Loading user...</p> : null}
        {user ? (
          <>
            <p className="field-help">
              <strong>
                <UserBadge avatarUrl={user.avatarUrl} name={user.username} />
              </strong>
            </p>
            {user.email ? <p className="field-help">Email: {user.email}</p> : null}
            <p className="field-help">Bio: {user.bio || "-"}</p>
            <p className="field-help">Created {formatDate(user.createdAt)}</p>
          </>
        ) : null}
        {status ? <p className="field-help">{status}</p> : null}
      </div>
    </ModalOverlay>
  );
}
