import { useEffect, useMemo, useState } from "react";
import {
  fetchMe,
  fetchUsers,
  updateMyProfile,
  updateUserAdmin,
  updateUserProfile,
  type CloudUser,
} from "../lib/cloudUser";

const initialsFor = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
};

export function UserAdminPanel() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<CloudUser | null>(null);
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");

  const canAdmin = Boolean(me?.isAdmin);

  const load = async () => {
    setBusy(true);
    setStatus("");
    try {
      const current = await fetchMe();
      setMe(current);
      setNameDraft(current.username);
      setEmailDraft(current.email);
      setBioDraft(current.bio ?? "");
      setAvatarDraft(current.avatarUrl ?? "");
      if (current.isAdmin) {
        const all = await fetchUsers();
        setUsers(all);
      } else {
        setUsers([]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`User load failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const userRows = useMemo(() => users.filter((user) => user.id !== me?.id), [users, me?.id]);

  const saveMyProfile = async () => {
    setBusy(true);
    setStatus("");
    try {
      const updated = await updateMyProfile({
        username: nameDraft,
        email: emailDraft,
        bio: bioDraft,
        avatarUrl: avatarDraft,
      });
      setMe(updated);
      setStatus("Profile updated.");
      if (canAdmin) {
        const all = await fetchUsers();
        setUsers(all);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Profile update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAdmin = async (user: CloudUser) => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserAdmin(user.id, !user.isAdmin);
      const all = await fetchUsers();
      setUsers(all);
      setStatus(`Role updated for ${user.username}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Role update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveManagedProfile = async (user: CloudUser, patch: { username: string; email: string }) => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserProfile(user.id, patch);
      const all = await fetchUsers();
      setUsers(all);
      setStatus(`Profile updated for ${user.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Profile update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="user-chip" onClick={() => setOpen(true)} type="button">
        <ProfileAvatar avatarUrl={me?.avatarUrl ?? ""} name={me?.username ?? "User"} />
        <span className="user-chip-text">{me?.username ?? "Loading user..."}</span>
      </button>

      {open ? (
        <div aria-label="User Settings" aria-modal="true" className="library-manager-overlay" role="dialog">
          <div className="library-manager-card user-settings-modal">
            <div className="library-manager-header">
              <h2>User Settings</h2>
              <button className="inline-action" onClick={() => setOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="user-settings-layout">
              <div className="user-settings-avatar-column">
                <ProfileAvatar avatarUrl={avatarDraft} name={nameDraft || "User"} size="large" />
                <p className="field-help">ID: {me?.id ?? "-"}</p>
                <p className="field-help">Role: {me?.isAdmin ? "Admin" : "User"}</p>
                <p className="field-help">Created: {fmtDate(me?.createdAt ?? null)}</p>
              </div>

              <div className="user-settings-form-column">
                <label className="field-grid">
                  <span>Name</span>
                  <input onChange={(event) => setNameDraft(event.target.value)} type="text" value={nameDraft} />
                </label>
                <label className="field-grid">
                  <span>Email</span>
                  <input onChange={(event) => setEmailDraft(event.target.value)} type="email" value={emailDraft} />
                </label>
                <label className="field-grid">
                  <span>Profile image URL</span>
                  <input onChange={(event) => setAvatarDraft(event.target.value)} type="url" value={avatarDraft} />
                </label>
                <label className="field-grid user-bio-field">
                  <span>Bio</span>
                  <textarea maxLength={300} onChange={(event) => setBioDraft(event.target.value)} value={bioDraft} />
                </label>
                <div className="chip-group">
                  <button
                    className="inline-action"
                    disabled={busy || !nameDraft.trim() || !emailDraft.trim()}
                    onClick={() => void saveMyProfile()}
                    type="button"
                  >
                    Save Profile
                  </button>
                  <button className="inline-action" disabled={busy} onClick={() => void load()} type="button">
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {canAdmin ? (
              <div className="user-manager-list">
                <p className="field-help">Admin: manage other users</p>
                {userRows.map((user) => (
                  <ManagedUserRow
                    key={user.id}
                    onSave={saveManagedProfile}
                    onToggleAdmin={toggleAdmin}
                    user={user}
                  />
                ))}
                {!userRows.length ? <p className="field-help">No other users yet.</p> : null}
              </div>
            ) : null}

            {status ? <p className="field-help">{status}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ManagedUserRow({
  user,
  onToggleAdmin,
  onSave,
}: {
  user: CloudUser;
  onToggleAdmin: (user: CloudUser) => Promise<void>;
  onSave: (user: CloudUser, patch: { username: string; email: string }) => Promise<void>;
}) {
  const [nameDraft, setNameDraft] = useState(user.username);
  const [emailDraft, setEmailDraft] = useState(user.email);

  useEffect(() => {
    setNameDraft(user.username);
    setEmailDraft(user.email);
  }, [user.username, user.email]);

  return (
    <div className="library-row">
      <div className="field-help">
        {user.id} | created {fmtDate(user.createdAt)}
      </div>
      <label className="field-grid">
        <span>Name</span>
        <input onChange={(event) => setNameDraft(event.target.value)} type="text" value={nameDraft} />
      </label>
      <label className="field-grid">
        <span>Email</span>
        <input onChange={(event) => setEmailDraft(event.target.value)} type="email" value={emailDraft} />
      </label>
      <div className="chip-group">
        <button className="inline-action" onClick={() => void onSave(user, { username: nameDraft, email: emailDraft })} type="button">
          Save
        </button>
        <button className="inline-action" onClick={() => void onToggleAdmin(user)} type="button">
          {user.isAdmin ? "Set User" : "Set Admin"}
        </button>
      </div>
    </div>
  );
}

function ProfileAvatar({
  avatarUrl,
  name,
  size = "small",
}: {
  avatarUrl: string;
  name: string;
  size?: "small" | "large";
}) {
  const className = size === "large" ? "profile-avatar profile-avatar-large" : "profile-avatar";
  if (avatarUrl.trim()) {
    return <img alt={name} className={className} src={avatarUrl} />;
  }
  return <div className={className}>{initialsFor(name)}</div>;
}
