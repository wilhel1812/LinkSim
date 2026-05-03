import { useMemo, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { CollaboratorDirectoryUser } from "../lib/cloudUser";
import { Button } from "./ui/Button";
import { ActionButton } from "./ActionButton";
import { AvatarBadge } from "./AvatarBadge";
import { FloatingPopover } from "./ui/FloatingPopover";

export type AccessVisibility = "private" | "shared";
export type AccessRole = "viewer" | "editor";

export type AccessCollaborator = {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  role: AccessRole;
};

type AccessSettingsEditorProps = {
  visibility: AccessVisibility;
  collaborators: AccessCollaborator[];
  directory: CollaboratorDirectoryUser[];
  onVisibilityChange: (visibility: AccessVisibility) => void;
  onAddCollaborator: (userId: string) => void;
  onRemoveCollaborator: (userId: string) => void;
  onRoleChange: (userId: string, role: AccessRole) => void;
  canRemoveCollaborators?: boolean;
  disabled?: boolean;
  ownerUserId?: string;
  directoryBusy?: boolean;
  directoryStatus?: string;
  status?: string;
  showStatusFallback?: boolean;
  onOpenUserProfile?: (userId: string) => void;
};

export const accessVisibilityCaption = (visibility: AccessVisibility): string =>
  visibility === "shared" ? "Visible in the library for all users" : "Only visible to you and collaborators";

export function AccessSettingsEditor({
  visibility,
  collaborators,
  directory,
  onVisibilityChange,
  onAddCollaborator,
  onRemoveCollaborator,
  onRoleChange,
  canRemoveCollaborators = true,
  disabled = false,
  ownerUserId = "",
  directoryBusy = false,
  directoryStatus = "",
  status = "",
  showStatusFallback = false,
  onOpenUserProfile,
}: AccessSettingsEditorProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedIds = useMemo(() => new Set(collaborators.map((user) => user.id)), [collaborators]);
  const trimmedQuery = query.trim().toLowerCase();
  const candidates = useMemo(() => {
    if (!trimmedQuery) return [];
    return directory
      .filter((user) => {
        if (ownerUserId && user.id === ownerUserId) return false;
        if (selectedIds.has(user.id)) return false;
        return `${user.username} ${user.email}`.toLowerCase().includes(trimmedQuery);
      })
      .slice(0, 8);
  }, [directory, ownerUserId, selectedIds, trimmedQuery]);

  const openUserProfile = (userId: string) => {
    if (!onOpenUserProfile) return;
    onOpenUserProfile(userId);
  };

  return (
    <>
      <label className="field-grid access-settings-row">
        <span>Access level</span>
        <span className="access-settings-control">
          <select
            aria-label="Access level"
            className="locale-select"
            disabled={disabled}
            onChange={(event) => onVisibilityChange(event.target.value as AccessVisibility)}
            value={visibility}
          >
            <option value="private">Private</option>
            <option value="shared">Shared</option>
          </select>
          <span className="field-help access-settings-caption">{accessVisibilityCaption(visibility)}</span>
        </span>
      </label>
      <div className="field-grid access-settings-row access-collaborators-row">
        <span>Collaborators</span>
        <div className="access-collaborators-summary">
          <div className="access-collaborator-avatars" aria-label="Selected collaborators">
            {collaborators.length ? (
              collaborators.slice(0, 5).map((user) => {
                const label = user.username || user.id;
                return (
                  <button
                    aria-label={label}
                    className="row-avatar"
                    disabled={!onOpenUserProfile}
                    key={user.id}
                    onClick={() => openUserProfile(user.id)}
                    title={label}
                    type="button"
                  >
                    <AvatarBadge avatarUrl={user.avatarUrl} fallbackRawText imageClassName="row-avatar-image" name={label} />
                  </button>
                );
              })
            ) : (
              <span className="field-help access-collaborators-empty">No collaborators</span>
            )}
          </div>
           <Button
             aria-label="Edit collaborators"
             ref={triggerRef}
             disabled={disabled}
             onClick={() => setPopoverOpen((open) => !open)}
             size="icon"
             title="Edit collaborators"
             type="button"
           >
             <Pencil size={14} />
           </Button>
        </div>
      </div>
      <FloatingPopover
        className="access-collaborator-popover"
        estimatedHeight={360}
        estimatedWidth={420}
        onClose={() => setPopoverOpen(false)}
        open={popoverOpen}
        triggerRef={triggerRef}
      >
        <div aria-label="Edit collaborators" className="access-collaborator-popover-content" role="dialog">
          <label className="access-collaborator-search">
            <span className="sr-only">Search users</span>
            <input
              aria-label="Search users"
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search users by name or email"
              type="text"
              value={query}
            />
          </label>
          {trimmedQuery ? (
            <div className="collaborator-candidate-list access-collaborator-candidates">
              {directoryBusy ? (
                <p className="field-help">Loading users…</p>
              ) : candidates.length ? (
                candidates.map((user) => (
                  <button
                    aria-label={`Add ${user.username}`}
                    className="site-quick-item"
                    disabled={disabled}
                    key={user.id}
                    onClick={() => {
                      onAddCollaborator(user.id);
                      setQuery("");
                    }}
                    type="button"
                  >
                    <UserBadge avatarUrl={user.avatarUrl} name={user.username} />
                    <span className="field-help">{user.email}</span>
                    <span className="field-help">Add</span>
                  </button>
                ))
              ) : (
                <p className="field-help">No matching users.</p>
              )}
            </div>
          ) : null}
          <div className="access-collaborator-list">
            {collaborators.length ? (
              collaborators.map((user) => {
                const label = user.username || user.id;
                return (
                  <div className="access-collaborator-row" key={user.id}>
                    <UserBadge avatarUrl={user.avatarUrl} name={label} />
                    <select
                      aria-label={`Role for ${label}`}
                      disabled={disabled}
                      onChange={(event) => onRoleChange(user.id, event.target.value as AccessRole)}
                      value={user.role}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <ActionButton
                      aria-label={`Remove ${label}`}
                      className="access-collaborator-remove"
                      disabled={disabled || !canRemoveCollaborators}
                      onClick={() => onRemoveCollaborator(user.id)}
                      size="icon"
                      title={`Remove ${label}`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
                    </ActionButton>
                  </div>
                );
              })
            ) : (
              <p className="field-help">No collaborators yet.</p>
            )}
          </div>
          {directoryStatus ? <p className="field-help">{directoryStatus}</p> : null}
        </div>
      </FloatingPopover>
      {status ? <p className="field-help">{status}</p> : showStatusFallback ? <p className="field-help">Saved automatically.</p> : null}
    </>
  );
}

const UserBadge = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
  <span className="user-list-row">
    <AvatarBadge avatarUrl={avatarUrl} imageClassName="profile-avatar" name={name} />
    <span>{name}</span>
  </span>
);
