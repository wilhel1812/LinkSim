import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  fetchAuthDiagnostics,
  deleteUser,
  fetchDeletedUsers,
  fetchMe,
  fetchSchemaDiagnostics,
  fetchUsers,
  runMetadataRepair,
  restoreDeletedCloudUser,
  updateMyProfile,
  updateUserAdmin,
  updateUserApproval,
  updateUserProfile,
  type CloudUser,
  type DeletedCloudUser,
  type AuthDiagnostics,
  type SchemaDiagnostics,
} from "../lib/cloudUser";
import { fetchNotifications, type NotificationFeed } from "../lib/cloudNotifications";
import { getUiErrorMessage } from "../lib/uiError";
import { ModalOverlay } from "./ModalOverlay";

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

const NOTIFICATION_DISMISS_KEY = "linksim:dismissed-notifications";
const NOTIFICATION_POLL_MS = 30_000;

const readDismissedNotificationIds = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
};

const writeDismissedNotificationIds = (ids: Set<string>) => {
  try {
    window.localStorage.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify([...ids]));
  } catch {
    // Best effort only.
  }
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
  const [deletedUsers, setDeletedUsers] = useState<DeletedCloudUser[]>([]);
  const [authDiagnostics, setAuthDiagnostics] = useState<AuthDiagnostics | null>(null);
  const [schemaDiagnostics, setSchemaDiagnostics] = useState<SchemaDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [accessRequestNoteDraft, setAccessRequestNoteDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationFeed, setNotificationFeed] = useState<NotificationFeed>({ unreadCount: 0, items: [] });
  const [managedUser, setManagedUser] = useState<CloudUser | null>(null);
  const [managedNameDraft, setManagedNameDraft] = useState("");
  const [managedEmailDraft, setManagedEmailDraft] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "pending" | "approved" | "revoked">("all");
  const [userSearch, setUserSearch] = useState("");
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readDismissedNotificationIds(),
  );

  const canAdmin = Boolean(me?.isAdmin);
  const canEditAccessRequestNote = Boolean(me?.isAdmin || !me?.isApproved);

  const refreshAdminData = async () => {
    if (!canAdmin) return;
    const [all, deleted, authDiag, schemaDiag] = await Promise.all([
      fetchUsers(),
      fetchDeletedUsers(),
      fetchAuthDiagnostics(),
      fetchSchemaDiagnostics(),
    ]);
    setUsers(all);
    setDeletedUsers(deleted);
    setAuthDiagnostics(authDiag);
    setSchemaDiagnostics(schemaDiag);
    setManagedUser((current) => {
      if (!current) return null;
      return all.find((user) => user.id === current.id) ?? null;
    });
  };

  const repairMetadata = async () => {
    setBusy(true);
    setStatus("");
    try {
      const result = await runMetadataRepair();
      await refreshAdminData();
      setStatus(
        `Metadata repair completed. Sites updated: ${result.sitesUpdated}. Simulations updated: ${result.simulationsUpdated}.`,
      );
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Metadata repair failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const loadNotifications = async () => {
    if (!canAdmin) return;
    setNotificationBusy(true);
    setNotificationStatus("");
    try {
      const next = await fetchNotifications();
      setNotificationFeed(next);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setNotificationStatus(`Notifications unavailable: ${message}`);
    } finally {
      setNotificationBusy(false);
    }
  };

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
        const [all, deleted, authDiag, schemaDiag] = await Promise.all([
          fetchUsers(),
          fetchDeletedUsers(),
          fetchAuthDiagnostics(),
          fetchSchemaDiagnostics(),
        ]);
        setUsers(all);
        setDeletedUsers(deleted);
        setAuthDiagnostics(authDiag);
        setSchemaDiagnostics(schemaDiag);
      } else {
        setUsers([]);
        setDeletedUsers([]);
        setAuthDiagnostics(null);
        setSchemaDiagnostics(null);
      }
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`User load failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!canAdmin) {
      setNotificationFeed({ unreadCount: 0, items: [] });
      return;
    }
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), NOTIFICATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [canAdmin]);

  const userRows = useMemo(() => users.filter((user) => user.id !== me?.id), [users, me?.id]);
  const pendingUserCount = useMemo(
    () => userRows.filter((user) => (user.accountState ?? (user.isApproved ? "approved" : "pending")) === "pending").length,
    [userRows],
  );
  const revokedUserCount = useMemo(
    () => userRows.filter((user) => (user.accountState ?? (user.isApproved ? "approved" : "pending")) === "revoked").length,
    [userRows],
  );
  const filteredUserRows = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return userRows.filter((user) => {
      const state = user.accountState ?? (user.isApproved ? "approved" : "pending");
      if (userFilter === "pending" && state !== "pending") return false;
      if (userFilter === "approved" && state !== "approved") return false;
      if (userFilter === "revoked" && state !== "revoked") return false;
      if (!q) return true;
      return (
        user.username.toLowerCase().includes(q) ||
        (user.email ?? "").toLowerCase().includes(q) ||
        user.id.toLowerCase().includes(q)
      );
    });
  }, [userRows, userFilter, userSearch]);
  const unreadNotifications = useMemo(
    () => notificationFeed.items.filter((item) => !dismissedNotifications.has(item.id)),
    [notificationFeed.items, dismissedNotifications],
  );

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
        await refreshAdminData();
      }
    } catch (error) {
      const message = getUiErrorMessage(error);
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
      const message = getUiErrorMessage(error);
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
      await refreshAdminData();
      setStatus(`Role updated for ${user.username}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
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
      await refreshAdminData();
      setStatus(`${user.isApproved ? "Revoked" : "Granted"} access for ${user.username}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Approval update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const rejectUser = async (user: CloudUser) => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserApproval(user.id, false);
      await refreshAdminData();
      setStatus(`Set ${user.username} to pending access.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Reject failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteUserAccount = async (user: CloudUser) => {
    const confirmed = window.confirm(`Delete user ${user.username}? This will remove owned records.`);
    if (!confirmed) return;
    setBusy(true);
    setStatus("");
    try {
      await deleteUser(user.id);
      await refreshAdminData();
      setStatus(`Deleted user ${user.username}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Delete failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveManagedProfile = async (user: CloudUser, patch: { username: string; email: string }) => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserProfile(user.id, patch);
      await refreshAdminData();
      setStatus(`Profile updated for ${user.id}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Profile update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const restoreDeletedUser = async (userId: string) => {
    setBusy(true);
    setStatus("");
    try {
      await restoreDeletedCloudUser(userId);
      await refreshAdminData();
      setStatus(`Deleted-user lock removed for ${userId}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Restore failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const dismissNotification = (id: string) => {
    setDismissedNotifications((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissedNotificationIds(next);
      return next;
    });
  };

  const authWarnings = useMemo(() => {
    const warnings: string[] = [];
    const cfg = authDiagnostics?.auth?.config;
    if (!cfg) return warnings;
    if (!cfg.accessAudConfigured) warnings.push("ACCESS_AUD is not configured.");
    if (!cfg.accessTeamDomainConfigured) warnings.push("ACCESS_TEAM_DOMAIN is not configured.");
    if (cfg.insecureDevAuthEnabled) warnings.push("ALLOW_INSECURE_DEV_AUTH is enabled.");
    if (!cfg.authObservabilityEnabled) warnings.push("AUTH_OBSERVABILITY is disabled.");
    return warnings;
  }, [authDiagnostics]);

  const schemaWarnings = useMemo(() => {
    const missing = schemaDiagnostics?.schema?.missing ?? [];
    if (!missing.length) return [];
    return missing.map((entry) => `${entry.table}: ${entry.columns.join(", ")}`);
  }, [schemaDiagnostics]);

  useEffect(() => {
    if (!managedUser) return;
    setManagedNameDraft(managedUser.username);
    setManagedEmailDraft(managedUser.email ?? "");
  }, [managedUser]);

  const openManagedUser = (user: CloudUser) => {
    setManagedUser(user);
  };

  const closeManagedUser = () => {
    setManagedUser(null);
    setManagedNameDraft("");
    setManagedEmailDraft("");
  };

  return (
    <>
      <button className="user-chip" onClick={() => setOpen(true)} type="button">
        <ProfileAvatar avatarUrl={me?.avatarUrl ?? ""} name={me?.username ?? "User"} />
        <span className="user-chip-text">{me?.username ?? "Loading user..."}</span>
        {canAdmin && unreadNotifications.length > 0 ? (
          <span className="notification-badge">{unreadNotifications.length}</span>
        ) : null}
      </button>

      {open ? (
        <ModalOverlay aria-label="User Settings" onClose={() => setOpen(false)}>
          <div className="library-manager-card user-settings-modal">
            <div className="library-manager-header">
              <h2>User Settings</h2>
              <div className="chip-group">
                <button className="inline-action" onClick={() => (window.location.href = "/cdn-cgi/access/logout")} type="button">
                  Sign Out
                </button>
                <button className="inline-action" onClick={() => setOpen(false)} type="button">
                  Close
                </button>
              </div>
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
                <p className="field-help">
                  Access:{" "}
                  {me?.accountState === "revoked"
                    ? "Revoked"
                    : me?.isApproved
                      ? "Approved"
                      : "Pending approval"}
                </p>
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
                    disabled={!canEditAccessRequestNote}
                    onChange={(event) => setAccessRequestNoteDraft(event.target.value)}
                    placeholder={
                      canEditAccessRequestNote
                        ? "Optional private note to admins."
                        : "Request note is locked after approval."
                    }
                    readOnly={!canEditAccessRequestNote}
                    value={accessRequestNoteDraft}
                  />
                </label>
                {!canEditAccessRequestNote ? (
                  <p className="field-help">Access request note is read-only after your account is approved.</p>
                ) : null}
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
                <div className="section-heading">
                  <p className="field-help">System diagnostics</p>
                  <div className="chip-group">
                    <button className="inline-action" disabled={busy} onClick={() => void load()} type="button">
                      Refresh
                    </button>
                    <button className="inline-action" disabled={busy} onClick={() => void repairMetadata()} type="button">
                      Repair Metadata
                    </button>
                  </div>
                </div>
                {authWarnings.length ? (
                  <div className="notification-banner" role="status">
                    <strong>Auth warnings:</strong> {authWarnings.join(" | ")}
                  </div>
                ) : (
                  <p className="field-help">Auth configuration checks passed.</p>
                )}
                {schemaWarnings.length ? (
                  <div className="notification-banner" role="status">
                    <strong>Schema warnings:</strong> {schemaWarnings.join(" | ")}
                  </div>
                ) : (
                  <p className="field-help">Schema diagnostics passed.</p>
                )}
                <p className="field-help">
                  Schema version: {schemaDiagnostics?.schema.version ?? "-"} |{" "}
                  Auth source: {authDiagnostics?.auth.source ?? "-"} | JWT:{" "}
                  {authDiagnostics?.auth.signals.hasJwtAssertion ? "yes" : "no"} | Header email:{" "}
                  {authDiagnostics?.auth.signals.hasEmailHeader ? "yes" : "no"}
                </p>
              </div>
            ) : null}

            {canAdmin ? (
              <div className="user-manager-list notifications-center">
                {unreadNotifications.length > 0 ? (
                  <div className="notification-banner" role="status">
                    <strong>{unreadNotifications.length} admin notification(s)</strong> need your review.
                  </div>
                ) : null}
                <div className="section-heading">
                  <p className="field-help">Notification Center</p>
                  <div className="chip-group">
                    <button className="inline-action" onClick={() => setNotificationOpen((prev) => !prev)} type="button">
                      {notificationOpen ? "Hide" : "Open"}
                    </button>
                    <button className="inline-action" onClick={() => void loadNotifications()} type="button">
                      Refresh
                    </button>
                  </div>
                </div>
                {notificationOpen ? (
                  <>
                    {notificationBusy ? <p className="field-help">Loading notifications…</p> : null}
                    {notificationStatus ? <p className="field-help">{notificationStatus}</p> : null}
                    {notificationFeed.items.length ? (
                      <div className="notifications-list">
                        {notificationFeed.items.map((item) => {
                          const isDismissed = dismissedNotifications.has(item.id);
                          return (
                            <div className="library-row" key={item.id}>
                              <strong>{item.title}</strong>
                              <p className="field-help">{item.message}</p>
                              <p className="field-help">Updated: {fmtDate(item.createdAt)}</p>
                              <div className="chip-group">
                                <button
                                  className="inline-action"
                                  disabled={isDismissed}
                                  onClick={() => dismissNotification(item.id)}
                                  type="button"
                                >
                                  {isDismissed ? "Dismissed" : "Dismiss Badge"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="field-help">No notifications yet.</p>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            {canAdmin ? (
              <div className="user-manager-list">
                <div className="section-heading">
                  <p className="field-help">Users: open a profile to review and moderate.</p>
                  <p className="field-help">Pending: {pendingUserCount} | Revoked: {revokedUserCount}</p>
                </div>
                <label className="field-grid user-field-grid">
                  <span>Filter</span>
                  <select
                    className="locale-select"
                    onChange={(event) => setUserFilter(event.target.value as "all" | "pending" | "approved" | "revoked")}
                    value={userFilter}
                  >
                    <option value="all">All users</option>
                    <option value="pending">Pending only</option>
                    <option value="approved">Approved only</option>
                    <option value="revoked">Revoked only</option>
                  </select>
                </label>
                <label className="field-grid user-field-grid">
                  <span>Search</span>
                  <input onChange={(event) => setUserSearch(event.target.value)} placeholder="Name, email, or user ID" type="text" value={userSearch} />
                </label>
                {filteredUserRows.map((user) => (
                  <button className="library-row user-list-row-btn" key={user.id} onClick={() => openManagedUser(user)} type="button">
                    <div className="user-list-row">
                      <ProfileAvatar avatarUrl={user.avatarUrl} name={user.username} />
                      <div>
                        <p className="field-help">
                          <strong>{user.username}</strong>
                        </p>
                        <p className="field-help">
                          {user.accountState === "revoked"
                            ? "Revoked"
                            : user.isApproved
                              ? "Approved"
                              : "Pending"}
                        </p>
                        <p className="field-help">{user.email ?? "-"}</p>
                      </div>
                    </div>
                  </button>
                ))}
                {!filteredUserRows.length ? <p className="field-help">No users match this filter.</p> : null}
              </div>
            ) : null}

            {canAdmin ? (
              <div className="user-manager-list">
                <p className="field-help">Deleted users: remove lock to allow immediate re-creation.</p>
                {deletedUsers.map((entry) => (
                  <div className="library-row" key={entry.id}>
                    <p className="field-help">
                      <strong>{entry.id}</strong>
                    </p>
                    <p className="field-help">Deleted: {fmtDate(entry.deletedAt)}</p>
                    <p className="field-help">Deleted by: {entry.deletedByUserId ?? "-"}</p>
                    <div className="chip-group">
                      <button className="inline-action" onClick={() => void restoreDeletedUser(entry.id)} type="button">
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
                {!deletedUsers.length ? <p className="field-help">No deleted-user locks.</p> : null}
              </div>
            ) : null}

            {managedUser ? (
              <ModalOverlay aria-label="Managed User Profile" onClose={closeManagedUser} tier="raised">
                <div className="library-manager-card user-profile-popup">
                  <div className="library-manager-header">
                    <h2>User Profile</h2>
                    <button className="inline-action" onClick={closeManagedUser} type="button">
                      Close
                    </button>
                  </div>
                  <div className="user-list-row">
                    <ProfileAvatar avatarUrl={managedUser.avatarUrl} name={managedUser.username} size="large" />
                    <div>
                      <p className="field-help">
                        <strong>{managedUser.username}</strong> ({managedUser.id})
                      </p>
                      <p className="field-help">Created: {fmtDate(managedUser.createdAt)}</p>
                      <p className="field-help">
                        Access:{" "}
                        {managedUser.accountState === "revoked"
                          ? "Revoked"
                          : managedUser.isApproved
                            ? "Approved"
                            : "Pending"}{" "}
                        | Role: {managedUser.isAdmin ? "Admin" : "User"}
                      </p>
                    </div>
                  </div>
                  <label className="field-grid user-field-grid">
                    <span>Name</span>
                    <input onChange={(event) => setManagedNameDraft(event.target.value)} type="text" value={managedNameDraft} />
                  </label>
                  <label className="field-grid user-field-grid">
                    <span>Email</span>
                    <input onChange={(event) => setManagedEmailDraft(event.target.value)} type="email" value={managedEmailDraft} />
                  </label>
                  {managedUser.accessRequestNote ? (
                    <p className="field-help">Access request note: {managedUser.accessRequestNote}</p>
                  ) : (
                    <p className="field-help">No access request note.</p>
                  )}
                  <div className="chip-group">
                    <button
                      className="inline-action"
                      onClick={() => void saveManagedProfile(managedUser, { username: managedNameDraft, email: managedEmailDraft })}
                      type="button"
                    >
                      Save Profile
                    </button>
                    <button className="inline-action" onClick={() => void toggleApproval(managedUser)} type="button">
                      {managedUser.isApproved ? "Revoke Access" : "Approve Access"}
                    </button>
                    <button className="inline-action" onClick={() => void rejectUser(managedUser)} type="button">
                      Set Pending
                    </button>
                    <button className="inline-action" onClick={() => void toggleAdmin(managedUser)} type="button">
                      {managedUser.isAdmin ? "Set User" : "Set Admin"}
                    </button>
                    <button className="inline-action" onClick={() => void deleteUserAccount(managedUser)} type="button">
                      Delete User
                    </button>
                  </div>
                  <p className="field-help">
                    Set Pending removes approval only. It does not delete the account and the user can still update profile while pending.
                  </p>
                </div>
              </ModalOverlay>
            ) : null}

            {status ? <p className="field-help">{status}</p> : null}
          </div>
        </ModalOverlay>
      ) : null}
    </>
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
