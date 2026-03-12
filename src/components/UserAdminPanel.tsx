import { useEffect, useMemo, useState } from "react";
import {
  fetchMe,
  fetchUsers,
  updateMyUsername,
  updateUserAdmin,
  updateUserUsername,
  type CloudUser,
} from "../lib/cloudUser";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
};

export function UserAdminPanel() {
  const [me, setMe] = useState<CloudUser | null>(null);
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [myNameDraft, setMyNameDraft] = useState("");

  const canAdmin = Boolean(me?.isAdmin);

  const load = async () => {
    setBusy(true);
    setStatus("");
    try {
      const current = await fetchMe();
      setMe(current);
      setMyNameDraft(current.username);
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

  const saveMyUsername = async () => {
    setBusy(true);
    setStatus("");
    try {
      const updated = await updateMyUsername(myNameDraft);
      setMe(updated);
      setStatus("Your username has been updated.");
      if (canAdmin) {
        const all = await fetchUsers();
        setUsers(all);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Update failed: ${message}`);
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
      setStatus(`Updated role for ${user.username}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Role update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveManagedUsername = async (user: CloudUser, nextName: string) => {
    setBusy(true);
    setStatus("");
    try {
      await updateUserUsername(user.id, nextName);
      const all = await fetchUsers();
      setUsers(all);
      setStatus(`Updated username for ${user.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Username update failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="user-admin-panel">
      <div className="section-heading">
        <p className="field-help">User & Access</p>
      </div>
      <div className="field-grid">
        <span>User ID</span>
        <code className="field-help">{me?.id ?? "Loading..."}</code>
      </div>
      <label className="field-grid">
        <span>Username</span>
        <input onChange={(event) => setMyNameDraft(event.target.value)} type="text" value={myNameDraft} />
      </label>
      <div className="chip-group">
        <button className="inline-action" disabled={busy || !myNameDraft.trim()} onClick={() => void saveMyUsername()} type="button">
          Save Username
        </button>
        <button className="inline-action" disabled={busy} onClick={() => void load()} type="button">
          Refresh User Data
        </button>
      </div>
      <p className="field-help">Role: {me?.isAdmin ? "Admin" : "User"}</p>

      {canAdmin ? (
        <div className="user-manager-list">
          <p className="field-help">Admin: manage user roles and names</p>
          {userRows.map((user) => (
            <ManagedUserRow key={user.id} onSaveName={saveManagedUsername} onToggleAdmin={toggleAdmin} user={user} />
          ))}
          {!userRows.length ? <p className="field-help">No other users yet.</p> : null}
        </div>
      ) : null}

      {status ? <p className="field-help">{status}</p> : null}
    </div>
  );
}

function ManagedUserRow({
  user,
  onToggleAdmin,
  onSaveName,
}: {
  user: CloudUser;
  onToggleAdmin: (user: CloudUser) => Promise<void>;
  onSaveName: (user: CloudUser, nextName: string) => Promise<void>;
}) {
  const [nameDraft, setNameDraft] = useState(user.username);

  useEffect(() => {
    setNameDraft(user.username);
  }, [user.username]);

  return (
    <div className="library-row">
      <div className="field-help">
        {user.id} | created {fmtDate(user.createdAt)}
      </div>
      <label className="field-grid">
        <span>Username</span>
        <input onChange={(event) => setNameDraft(event.target.value)} type="text" value={nameDraft} />
      </label>
      <div className="chip-group">
        <button className="inline-action" onClick={() => void onSaveName(user, nameDraft)} type="button">
          Save Name
        </button>
        <button className="inline-action" onClick={() => void onToggleAdmin(user)} type="button">
          {user.isAdmin ? "Set User" : "Set Admin"}
        </button>
      </div>
    </div>
  );
}
