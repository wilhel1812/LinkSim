import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  fetchMe,
  fetchUsers,
  updateMyProfile,
  updateUserAdmin,
  updateUserApproval,
  updateUserProfile,
  type CloudUser,
} from "../lib/cloudUser";

const initialsFor = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
};

const resizeAvatarFileToDataUrl = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const maxSize = 192;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable for image resize.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const webp = canvas.toDataURL("image/webp", 0.82);
  if (webp.length > 240_000) {
    throw new Error("Profile image is still too large after resize.");
  }
  return webp;
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
  const [accessRequestNoteDraft, setAccessRequestNoteDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");

  const canAdmin = Boolean(me?.isAdmin);

  const load = async () => {
    setBusy(true);
    setStatus("");
    try {
      const current = await fetchMe();
      setMe(current);
      setNameDraft(current.username);
      setEmailDraft(current.email ?? "");
      setBioDraft(current.bio ?? "");
      setAccessRequestNoteDraft(current.accessRequestNote ?? "");
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
        accessRequestNote: accessRequestNoteDraft,
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

  const onUploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setBusy(true);
      setStatus("");
      const resized = await resizeAvatarFileToDataUrl(file);
      setAvatarDraft(resized);
      setStatus("Avatar resized locally. Click Save Profile to store it.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Avatar upload failed: ${message}`);
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

  const toggleApproval = async (user: CloudUser) => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserApproval(user.id, !user.isApproved);
      const all = await fetchUsers();
      setUsers(all);
      setStatus(`${user.isApproved ? "Revoked" : "Granted"} access for ${user.username}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Approval update failed: ${message}`);
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
                <label className="upload-button">
                  Upload Picture
                  <input accept="image/*" onChange={(event) => void onUploadAvatar(event)} type="file" />
                </label>
                <p className="field-help">ID: {me?.id ?? "-"}</p>
                <p className="field-help">Role: {me?.isAdmin ? "Admin" : "User"}</p>
                <p className="field-help">Access: {me?.isApproved ? "Approved" : "Pending approval"}</p>
                <p className="field-help">Created: {fmtDate(me?.createdAt)}</p>
              </div>

              <div className="user-settings-form-column">
                <label className="field-grid user-field-grid">
                  <span>Name</span>
                  <input onChange={(event) => setNameDraft(event.target.value)} type="text" value={nameDraft} />
                </label>
                <label className="field-grid user-field-grid">
                  <span>Email</span>
                  <input onChange={(event) => setEmailDraft(event.target.value)} type="email" value={emailDraft} />
                </label>
                <label className="field-grid user-field-grid">
                  <span>Profile image URL</span>
                  <input onChange={(event) => setAvatarDraft(event.target.value)} type="url" value={avatarDraft} />
                </label>
                <label className="field-grid user-bio-field user-field-grid">
                  <span>Bio</span>
                  <textarea maxLength={300} onChange={(event) => setBioDraft(event.target.value)} value={bioDraft} />
                </label>
                <label className="field-grid user-bio-field user-field-grid">
                  <span>Access request note</span>
                  <textarea
                    maxLength={1200}
                    onChange={(event) => setAccessRequestNoteDraft(event.target.value)}
                    placeholder="Optional private note to admins."
                    value={accessRequestNoteDraft}
                  />
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
                <p className="field-help">Admin: manage approvals, roles, and profile basics</p>
                {userRows.map((user) => (
                  <ManagedUserRow
                    key={user.id}
                    onSave={saveManagedProfile}
                    onToggleAdmin={toggleAdmin}
                    onToggleApproval={toggleApproval}
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
  onToggleApproval,
  onSave,
}: {
  user: CloudUser;
  onToggleAdmin: (user: CloudUser) => Promise<void>;
  onToggleApproval: (user: CloudUser) => Promise<void>;
  onSave: (user: CloudUser, patch: { username: string; email: string }) => Promise<void>;
}) {
  const [nameDraft, setNameDraft] = useState(user.username);
  const [emailDraft, setEmailDraft] = useState(user.email ?? "");

  useEffect(() => {
    setNameDraft(user.username);
    setEmailDraft(user.email ?? "");
  }, [user.username, user.email]);

  return (
    <div className="library-row">
      <div className="field-help">
        {user.id} | created {fmtDate(user.createdAt)} | access {user.isApproved ? "approved" : "pending"}
      </div>
      {user.accessRequestNote ? <p className="field-help">Request: {user.accessRequestNote}</p> : null}
      <label className="field-grid user-field-grid">
        <span>Name</span>
        <input onChange={(event) => setNameDraft(event.target.value)} type="text" value={nameDraft} />
      </label>
      <label className="field-grid user-field-grid">
        <span>Email</span>
        <input onChange={(event) => setEmailDraft(event.target.value)} type="email" value={emailDraft} />
      </label>
      <div className="chip-group">
        <button className="inline-action" onClick={() => void onSave(user, { username: nameDraft, email: emailDraft })} type="button">
          Save
        </button>
        <button className="inline-action" onClick={() => void onToggleApproval(user)} type="button">
          {user.isApproved ? "Revoke" : "Approve"}
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
