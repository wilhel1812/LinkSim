import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  bulkReassignOwnership,
  fetchAdminAuditEvents,
  fetchAuthDiagnostics,
  deleteUser,
  fetchDeletedUsers,
  fetchMe,
  fetchSchemaDiagnostics,
  fetchUsers,
  runMetadataRepair,
  reassignResourceOwner,
  restoreDeletedCloudUser,
  uploadAvatar,
  updateMyProfile,
  updateUserRole,
  updateUserProfile,
  type AdminAuditEvent,
  type CloudUser,
  type DeletedCloudUser,
  type AuthDiagnostics,
  type SchemaDiagnostics,
} from "../lib/cloudUser";
import { fetchNotifications, type NotificationFeed } from "../lib/cloudNotifications";
import { getUiErrorMessage } from "../lib/uiError";
import { useAppStore } from "../store/appStore";
import type { UiColorTheme } from "../themes/types";
import { InfoTip } from "./InfoTip";
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

const loadImageFromFile = async (file: File): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to decode image."));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const resizeAvatarFileToDataUrl = async (file: File): Promise<{ originalDataUrl: string; thumbDataUrl: string }> => {
  const image = await loadImageFromFile(file);
  const maxOriginal = 2048;
  const maxThumb = 320;
  const originalScale = Math.min(1, maxOriginal / Math.max(image.width, image.height));
  const thumbScale = Math.min(1, maxThumb / Math.max(image.width, image.height));
  const originalWidth = Math.max(1, Math.round(image.width * originalScale));
  const originalHeight = Math.max(1, Math.round(image.height * originalScale));
  const thumbWidth = Math.max(1, Math.round(image.width * thumbScale));
  const thumbHeight = Math.max(1, Math.round(image.height * thumbScale));

  const originalCanvas = document.createElement("canvas");
  originalCanvas.width = originalWidth;
  originalCanvas.height = originalHeight;
  const originalCtx = originalCanvas.getContext("2d");
  if (!originalCtx) throw new Error("Canvas unavailable for image resize.");
  originalCtx.drawImage(image, 0, 0, originalWidth, originalHeight);

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbWidth;
  thumbCanvas.height = thumbHeight;
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) throw new Error("Canvas unavailable for thumbnail resize.");
  thumbCtx.drawImage(image, 0, 0, thumbWidth, thumbHeight);

  const originalDataUrl = originalCanvas.toDataURL("image/webp", 0.86);
  const thumbDataUrl = thumbCanvas.toDataURL("image/webp", 0.8);
  if (originalDataUrl.length > 7_000_000) {
    throw new Error("Profile image is still too large after resize.");
  }
  if (thumbDataUrl.length > 1_400_000) {
    throw new Error("Profile thumbnail is still too large after resize.");
  }
  return { originalDataUrl, thumbDataUrl };
};

export function UserAdminPanel() {
  const uiThemePreference = useAppStore((state) => state.uiThemePreference);
  const setUiThemePreference = useAppStore((state) => state.setUiThemePreference);
  const uiColorTheme = useAppStore((state) => state.uiColorTheme);
  const setUiColorTheme = useAppStore((state) => state.setUiColorTheme);
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
  const [avatarStatus, setAvatarStatus] = useState("");
  const [emailPublicDraft, setEmailPublicDraft] = useState(true);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationFeed, setNotificationFeed] = useState<NotificationFeed>({ unreadCount: 0, items: [] });
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [ownershipKind, setOwnershipKind] = useState<"site" | "simulation">("site");
  const [ownershipResourceId, setOwnershipResourceId] = useState("");
  const [ownershipNewOwnerId, setOwnershipNewOwnerId] = useState("");
  const [bulkFromOwnerId, setBulkFromOwnerId] = useState("");
  const [bulkToOwnerId, setBulkToOwnerId] = useState("");
  const [managedUser, setManagedUser] = useState<CloudUser | null>(null);
  const [managedNameDraft, setManagedNameDraft] = useState("");
  const [managedEmailDraft, setManagedEmailDraft] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "pending" | "approved" | "revoked">("all");
  const [userSearch, setUserSearch] = useState("");
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readDismissedNotificationIds(),
  );

  const canAdmin = Boolean(me?.isAdmin);
  const canModerate = Boolean(me?.isAdmin || me?.isModerator);
  const myRole: "admin" | "moderator" | "user" | "pending" = me?.role
    ? me.role
    : me?.isAdmin
      ? "admin"
      : me?.isModerator
        ? "moderator"
        : me?.isApproved
          ? "user"
          : "pending";
  const canEditAccessRequestNote = Boolean(canModerate || !me?.isApproved);
  const showAccessRequestNoteField = Boolean(canModerate || !me?.isApproved);

  const refreshAdminData = async () => {
    if (!canModerate) return;
    let allUsers: CloudUser[] = [];
    if (canAdmin) {
      const [all, deleted] = await Promise.all([fetchUsers(), fetchDeletedUsers()]);
      allUsers = all;
      setUsers(allUsers);
      setDeletedUsers(deleted);
    } else {
      const all = await fetchUsers();
      allUsers = all;
      setUsers(allUsers);
      setDeletedUsers([]);
    }
    if (canAdmin) {
      const [authDiag, schemaDiag, events] = await Promise.all([
        fetchAuthDiagnostics(),
        fetchSchemaDiagnostics(),
        fetchAdminAuditEvents(80),
      ]);
      setAuthDiagnostics(authDiag);
      setSchemaDiagnostics(schemaDiag);
      setAuditEvents(events);
    } else {
      setAuthDiagnostics(null);
      setSchemaDiagnostics(null);
      setAuditEvents([]);
    }
    setManagedUser((current) => {
      if (!current) return null;
      return allUsers.find((user) => user.id === current.id) ?? null;
    });
  };

  const repairMetadata = async () => {
    if (!canAdmin) return;
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

  const loadNotifications = useCallback(async () => {
    if (!canModerate) return;
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
  }, [canModerate]);

  const loadAdminAudit = useCallback(async () => {
    if (!canAdmin) return;
    setAuditBusy(true);
    try {
      const events = await fetchAdminAuditEvents(80);
      setAuditEvents(events);
    } finally {
      setAuditBusy(false);
    }
  }, [canAdmin]);

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
      setEmailPublicDraft(current.emailPublic ?? true);
      if (current.isAdmin) {
        const [all, deleted, authDiag, schemaDiag, events] = await Promise.all([
          fetchUsers(),
          fetchDeletedUsers(),
          fetchAuthDiagnostics(),
          fetchSchemaDiagnostics(),
          fetchAdminAuditEvents(80),
        ]);
        setUsers(all);
        setDeletedUsers(deleted);
        setAuthDiagnostics(authDiag);
        setSchemaDiagnostics(schemaDiag);
        setAuditEvents(events);
      } else if (current.isModerator) {
        const all = await fetchUsers();
        setUsers(all);
        setDeletedUsers([]);
        setAuthDiagnostics(null);
        setSchemaDiagnostics(null);
        setAuditEvents([]);
      } else {
        setUsers([]);
        setDeletedUsers([]);
        setAuthDiagnostics(null);
        setSchemaDiagnostics(null);
        setAuditEvents([]);
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
    if (!canModerate) {
      setNotificationFeed({ unreadCount: 0, items: [] });
      return;
    }
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), NOTIFICATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [canModerate, loadNotifications]);

  useEffect(() => {
    if (!canModerate) return;
    void loadAdminAudit();
  }, [canModerate, loadAdminAudit]);

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
        emailPublic: emailPublicDraft,
      });
      setMe(updated);
      setStatus("Profile updated.");
      if (canModerate) {
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
      setAvatarStatus("Processing image…");
      const resized = await resizeAvatarFileToDataUrl(file);
      setAvatarStatus("Uploading avatar…");
      const uploaded = await uploadAvatar(resized.originalDataUrl, resized.thumbDataUrl);
      setAvatarDraft(uploaded.user.avatarUrl ?? "");
      setMe(uploaded.user);
      setAvatarStatus("Avatar uploaded and saved.");
      setStatus("Avatar uploaded and saved.");
    } catch (error) {
      const message = getUiErrorMessage(error);
      setAvatarStatus(`Upload failed: ${message}`);
      setStatus(`Avatar upload failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async (user: CloudUser, role: "admin" | "moderator" | "user" | "pending") => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserRole(user.id, role);
      await refreshAdminData();
      setStatus(`Role updated for ${user.username}.`);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Role update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteUserAccount = async (user: CloudUser) => {
    if (!canAdmin) {
      setStatus("Only admins can delete users.");
      return;
    }
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

  const runOwnerReassign = async () => {
    const resourceId = ownershipResourceId.trim();
    const newOwnerUserId = ownershipNewOwnerId.trim();
    if (!resourceId || !newOwnerUserId) {
      setStatus("Ownership reassignment requires resource ID and target owner user ID.");
      return;
    }
    const confirmed = window.confirm(
      `Reassign ${ownershipKind} ${resourceId} to ${newOwnerUserId}? This is logged in admin audit events.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await reassignResourceOwner(ownershipKind, resourceId, newOwnerUserId);
      await refreshAdminData();
      setStatus(
        `Ownership reassigned for ${ownershipKind} ${resourceId}: ${result.previousOwnerUserId} -> ${result.newOwnerUserId}.`,
      );
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Ownership reassignment failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const runBulkOwnerReassign = async () => {
    const fromUserId = bulkFromOwnerId.trim();
    const toUserId = bulkToOwnerId.trim();
    if (!fromUserId || !toUserId) {
      setStatus("Bulk ownership reassignment requires source and target owner user IDs.");
      return;
    }
    const confirmed = window.confirm(
      `Bulk reassign all owned sites/simulations from ${fromUserId} to ${toUserId}? This is logged in admin audit events.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await bulkReassignOwnership(fromUserId, toUserId);
      await refreshAdminData();
      setStatus(
        `Bulk ownership reassignment done. Sites: ${result.sitesUpdated}, Simulations: ${result.simulationsUpdated}.`,
      );
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Bulk ownership reassignment failed: ${message}`);
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

  const resolveRole = (user: CloudUser): "admin" | "moderator" | "user" | "pending" =>
    user.role ?? (user.isAdmin ? "admin" : user.isModerator ? "moderator" : user.isApproved ? "user" : "pending");

  const canAssignManagedRole = (
    user: CloudUser,
    nextRole: "admin" | "moderator" | "user" | "pending",
  ): boolean => {
    if (!me || me.id === user.id) return false;
    if (myRole === "admin") return true;
    if (myRole !== "moderator") return false;
    const targetRole = resolveRole(user);
    if (targetRole === "admin" || targetRole === "moderator") return false;
    if (targetRole === "pending") return nextRole === "user";
    if (targetRole === "user") return nextRole === "pending";
    return false;
  };

  return (
    <>
      <button className="user-chip" onClick={() => setOpen(true)} type="button">
        <ProfileAvatar avatarUrl={me?.avatarUrl ?? ""} name={me?.username ?? "User"} />
        <span className="user-chip-text">{me?.username ?? "Loading user..."}</span>
        {canModerate && unreadNotifications.length > 0 ? (
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
                {avatarStatus ? <p className="field-help">{avatarStatus}</p> : null}
                <p className="field-help">ID: {me?.id ?? "-"}</p>
                <p className="field-help">Role: {me?.role ?? (me?.isAdmin ? "admin" : me?.isModerator ? "moderator" : me?.isApproved ? "user" : "pending")}</p>
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
                <div className="field-grid user-field-grid">
                  <span>
                    UI theme <InfoTip text="Choose whether LinkSim follows your system theme, or force light/dark mode." />
                  </span>
                  <select
                    className="locale-select"
                    onChange={(event) => setUiThemePreference(event.target.value as "system" | "light" | "dark")}
                    value={uiThemePreference}
                  >
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <div className="field-grid user-field-grid">
                  <span>
                    Color theme <InfoTip text="Select the app accent palette. More palettes can be added later." />
                  </span>
                  <select
                    className="locale-select"
                    onChange={(event) => setUiColorTheme(event.target.value as UiColorTheme)}
                    value={uiColorTheme}
                  >
                    <option value="blue">Blue</option>
                    <option value="pink">Pink</option>
                    <option value="red">Red</option>
                    <option value="green">Green</option>
                  </select>
                </div>
                <div className="field-grid user-field-grid">
                  <span>
                    Email visibility{" "}
                    <InfoTip text="If enabled, your email is visible in user profile popovers and collaborator search. Admins always see emails for moderation." />
                  </span>
                  <label className="checkbox-field">
                    <input
                      checked={emailPublicDraft}
                      onChange={(event) => setEmailPublicDraft(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Visible to all users in profile popover (admins always see it)</span>
                  </label>
                </div>
                <label className="field-grid user-bio-field user-field-grid">
                  <span>Bio</span>
                  <textarea maxLength={300} onChange={(event) => setBioDraft(event.target.value)} value={bioDraft} />
                </label>
                {showAccessRequestNoteField ? (
                  <label className="field-grid user-bio-field user-field-grid">
                    <span>Access request note</span>
                    <textarea
                      maxLength={1200}
                      disabled={!canEditAccessRequestNote}
                      onChange={(event) => setAccessRequestNoteDraft(event.target.value)}
                      placeholder={
                        canEditAccessRequestNote
                          ? "Optional private note to moderators/admins."
                          : "Request note is locked after approval."
                      }
                      readOnly={!canEditAccessRequestNote}
                      value={accessRequestNoteDraft}
                    />
                  </label>
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
              <div className="user-manager-list">
                <div className="section-heading">
                  <p className="field-help">Admin ownership tools</p>
                  <div className="chip-group">
                    <button className="inline-action" disabled={busy || auditBusy} onClick={() => void loadAdminAudit()} type="button">
                      Refresh Audit
                    </button>
                  </div>
                </div>
                <label className="field-grid user-field-grid">
                  <span>Resource type</span>
                  <select
                    className="locale-select"
                    onChange={(event) => setOwnershipKind(event.target.value as "site" | "simulation")}
                    value={ownershipKind}
                  >
                    <option value="site">Site</option>
                    <option value="simulation">Simulation</option>
                  </select>
                </label>
                <label className="field-grid user-field-grid">
                  <span>Resource ID</span>
                  <input
                    onChange={(event) => setOwnershipResourceId(event.target.value)}
                    placeholder="site-id or simulation-id"
                    type="text"
                    value={ownershipResourceId}
                  />
                </label>
                <label className="field-grid user-field-grid">
                  <span>New owner ID</span>
                  <input
                    list="admin-user-ids"
                    onChange={(event) => setOwnershipNewOwnerId(event.target.value)}
                    placeholder="target user ID"
                    type="text"
                    value={ownershipNewOwnerId}
                  />
                </label>
                <button className="inline-action" disabled={busy} onClick={() => void runOwnerReassign()} type="button">
                  Reassign Owner
                </button>

                <label className="field-grid user-field-grid">
                  <span>Bulk from owner ID</span>
                  <input
                    list="admin-user-ids"
                    onChange={(event) => setBulkFromOwnerId(event.target.value)}
                    placeholder="source owner user ID"
                    type="text"
                    value={bulkFromOwnerId}
                  />
                </label>
                <label className="field-grid user-field-grid">
                  <span>Bulk to owner ID</span>
                  <input
                    list="admin-user-ids"
                    onChange={(event) => setBulkToOwnerId(event.target.value)}
                    placeholder="target owner user ID"
                    type="text"
                    value={bulkToOwnerId}
                  />
                </label>
                <button className="inline-action" disabled={busy} onClick={() => void runBulkOwnerReassign()} type="button">
                  Bulk Reassign Ownership
                </button>

                <p className="field-help">Recent admin audit events</p>
                {auditBusy ? <p className="field-help">Loading audit events…</p> : null}
                <div className="notifications-list">
                  {auditEvents.slice(0, 12).map((event) => (
                    <div className="library-row" key={event.id}>
                      <strong>{event.eventType}</strong>
                      <p className="field-help">
                        actor: {event.actorUserId ?? "-"} | target: {event.targetUserId}
                      </p>
                      <p className="field-help">
                        source: {event.sourceUserId ?? "-"} | at: {fmtDate(event.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
                {!auditEvents.length ? <p className="field-help">No admin audit events yet.</p> : null}
                <datalist id="admin-user-ids">
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username}
                    </option>
                  ))}
                </datalist>
              </div>
            ) : null}

            {canModerate ? (
              <div className="user-manager-list notifications-center">
                {unreadNotifications.length > 0 ? (
                  <div className="notification-banner" role="status">
                    <strong>{unreadNotifications.length} moderator/admin notification(s)</strong> need your review.
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

            {canModerate ? (
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
                        | Role: {managedUser.role ?? (managedUser.isAdmin ? "admin" : managedUser.isModerator ? "moderator" : managedUser.isApproved ? "user" : "pending")}
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
                    <label className="field-grid user-field-grid">
                      <span>
                        Role{" "}
                        <InfoTip text="Role changes are audited. Admins can assign all roles except their own. Moderators can only approve pending users to User, or move existing users back to Pending." />
                      </span>
                      <select
                        className="locale-select"
                        onChange={(event) => {
                          const nextRole = event.target.value as "admin" | "moderator" | "user" | "pending";
                          if (!canAssignManagedRole(managedUser, nextRole)) return;
                          void updateRole(managedUser, nextRole);
                        }}
                        value={
                          managedUser.role ??
                          (managedUser.isAdmin
                            ? "admin"
                            : managedUser.isModerator
                              ? "moderator"
                              : managedUser.isApproved
                                ? "user"
                                : "pending")
                        }
                      >
                        <option disabled={!canAssignManagedRole(managedUser, "pending")} value="pending">Pending</option>
                        <option disabled={!canAssignManagedRole(managedUser, "user")} value="user">User</option>
                        <option disabled={!canAssignManagedRole(managedUser, "moderator")} value="moderator">Moderator</option>
                        <option disabled={!canAssignManagedRole(managedUser, "admin")} value="admin">Admin</option>
                      </select>
                    </label>
                    {!managedUser.isApproved ? (
                      <button
                        className="inline-action"
                        onClick={() => void updateRole(managedUser, "user")}
                        type="button"
                      >
                        Approve Access
                      </button>
                    ) : null}
                    {canAdmin ? (
                      <button
                        className="inline-action"
                        disabled={managedUser.id === me?.id || resolveRole(managedUser) === "admin"}
                        onClick={() => void deleteUserAccount(managedUser)}
                        type="button"
                      >
                        Delete User
                      </button>
                    ) : null}
                  </div>
                  <p className="field-help">
                    Role and approval changes are audited. Moderators can only approve pending users to User, or
                    move existing users back to Pending.
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
