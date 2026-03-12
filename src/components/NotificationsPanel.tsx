import { useEffect, useMemo, useState } from "react";
import { fetchNotifications, type NotificationFeed, type PendingApprovalUser } from "../lib/cloudNotifications";
import { getUiErrorMessage } from "../lib/uiError";

const POLL_MS = 30_000;

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
};

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [feed, setFeed] = useState<NotificationFeed>({ unreadCount: 0, items: [] });

  const load = async () => {
    setBusy(true);
    setStatus("");
    try {
      const next = await fetchNotifications();
      setFeed(next);
    } catch (error) {
      const message = getUiErrorMessage(error);
      setStatus(`Notifications unavailable: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const pendingUsers = useMemo(() => {
    const pending = feed.items.find((item) => item.type === "pending_users")?.meta?.pendingUsers;
    return Array.isArray(pending) ? pending : [];
  }, [feed.items]);

  return (
    <div className="notifications-panel">
      {feed.unreadCount > 0 ? (
        <div className="notification-banner" role="status">
          <strong>{feed.unreadCount} pending user(s)</strong> need review.
        </div>
      ) : null}

      <button className="notification-bell" onClick={() => setOpen((prev) => !prev)} type="button">
        Notifications
        {feed.unreadCount > 0 ? <span className="notification-badge">{feed.unreadCount}</span> : null}
      </button>

      {open ? (
        <div className="notifications-popover">
          <div className="section-heading">
            <p className="field-help">Admin notifications</p>
            <button className="inline-action" onClick={() => void load()} type="button">
              Refresh
            </button>
          </div>
          {busy ? <p className="field-help">Loading…</p> : null}
          {status ? <p className="field-help">{status}</p> : null}

          {pendingUsers.length ? (
            <div className="notifications-list">
              {pendingUsers.map((user) => (
                <PendingUserRow key={user.id} user={user} />
              ))}
            </div>
          ) : (
            <p className="field-help">No pending notifications.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PendingUserRow({ user }: { user: PendingApprovalUser }) {
  return (
    <div className="library-row">
      <strong>{user.username}</strong>
      <p className="field-help">{user.email || "No verified email from IdP"}</p>
      <p className="field-help">Created: {fmt(user.createdAt)}</p>
      {user.accessRequestNote ? <p className="field-help">Request: {user.accessRequestNote}</p> : null}
    </div>
  );
}
