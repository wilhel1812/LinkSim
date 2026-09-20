import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { fetchMe, updateMyProfile, type CloudUser, type CloudUserProfilePatch } from "../../../lib/cloudUser";
import { getUiErrorMessage } from "../../../lib/uiError";
import { useAppStore } from "../../../store/appStore";
import { formatDate } from "../../../lib/locale";
import { AutoSaveField } from "../AutoSaveField";
import { AvatarDropZone } from "../AvatarDropZone";
import { AutoSaveIndicator, type AutoSaveState } from "../../ui/AutoSaveIndicator";
import {
  addBetterAuthPasskey,
  getPasskeyUiErrorMessage,
  listBetterAuthPasskeys,
  removeBetterAuthPasskey,
  renameBetterAuthPasskey,
  type BetterAuthPasskey,
  type PasskeyOperation,
} from "../../../lib/betterAuthPilot";

type ProfileSectionProps = {
  me: CloudUser | null;
  onMeUpdated: (user: CloudUser, patch?: CloudUserProfilePatch) => void;
  onSignOut?: () => void;
  passkeysEnabled?: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProfileSection({ me, onMeUpdated, onSignOut, passkeysEnabled = false }: ProfileSectionProps) {
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setAuthState = useAppStore((state) => state.setAuthState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emailPublicState, setEmailPublicState] = useState<AutoSaveState>("idle");
  const [emailPublicError, setEmailPublicError] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<BetterAuthPasskey[]>([]);
  const [passkeyNames, setPasskeyNames] = useState<Record<string, string>>({});
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyStatus, setPasskeyStatus] = useState("");

  const refreshPasskeys = useCallback(async () => {
    const next = await listBetterAuthPasskeys();
    setPasskeys(next);
    setPasskeyNames(Object.fromEntries(next.map((passkey) => [passkey.id, passkey.name ?? ""])));
  }, []);

  useEffect(() => {
    if (!passkeysEnabled || !me) {
      setPasskeys([]);
      setPasskeyNames({});
      setPasskeyError(null);
      setPasskeyStatus("");
      return;
    }
    let cancelled = false;
    void listBetterAuthPasskeys()
      .then((next) => {
        if (cancelled) return;
        setPasskeys(next);
        setPasskeyNames(Object.fromEntries(next.map((passkey) => [passkey.id, passkey.name ?? ""])));
      })
      .catch((error) => {
        if (!cancelled) setPasskeyError(getPasskeyUiErrorMessage(error, "load"));
      });
    return () => {
      cancelled = true;
    };
  }, [me, passkeysEnabled]);

  const runPasskeyMutation = useCallback(async (
    operation: Exclude<PasskeyOperation, "sign-in" | "load">,
    mutation: () => Promise<void>,
    pendingMessage: string,
    successMessage: string,
  ) => {
    if (passkeyBusy) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    setPasskeyStatus(pendingMessage);
    try {
      if (operation === "add") {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      await mutation();
      await refreshPasskeys();
      setPasskeyStatus(successMessage);
    } catch (error) {
      setPasskeyStatus("");
      setPasskeyError(getPasskeyUiErrorMessage(error, operation));
    } finally {
      setPasskeyBusy(false);
    }
  }, [passkeyBusy, refreshPasskeys]);

  useEffect(() => {
    if (me) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await fetchMe();
        if (cancelled) return;
        onMeUpdated(current);
        setCurrentUser(current);
        setAuthState("signed_in");
      } catch (error) {
        if (cancelled) return;
        setLoadError(getUiErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, onMeUpdated, setAuthState, setCurrentUser]);

  const applyUpdate = useCallback(
    (user: CloudUser, patch?: CloudUserProfilePatch) => {
      onMeUpdated(user, patch);
      setAuthState("signed_in");
    },
    [onMeUpdated, setAuthState],
  );

  const saveField = useCallback(
    async (patch: Parameters<typeof updateMyProfile>[0]) => {
      const updated = await updateMyProfile(patch);
      applyUpdate(updated, patch);
    },
    [applyUpdate],
  );

  const saveEmailPublic = useCallback(
    async (nextValue: boolean) => {
      setEmailPublicState("saving");
      setEmailPublicError(null);
      try {
        const updated = await updateMyProfile({ emailPublic: nextValue });
        applyUpdate(updated, { emailPublic: nextValue });
        setEmailPublicState("saved");
        window.setTimeout(() => {
          setEmailPublicState((current) => (current === "saved" ? "idle" : current));
        }, 1800);
      } catch (error) {
        setEmailPublicState("error");
        setEmailPublicError(getUiErrorMessage(error));
      }
    },
    [applyUpdate],
  );

  if (loadError) {
    return (
      <section className="settings-section" aria-labelledby="settings-profile-heading">
        <h2 id="settings-profile-heading">Profile</h2>
        <p className="field-help field-help-error">Could not load profile: {loadError}</p>
      </section>
    );
  }

  if (!me) {
    return (
      <section className="settings-section" aria-labelledby="settings-profile-heading">
        <h2 id="settings-profile-heading">Profile</h2>
        <p className="field-help">Loading profile…</p>
      </section>
    );
  }

  const displayName = me.username || "User";

  return (
    <section className="settings-section" aria-labelledby="settings-profile-heading">
      <header className="settings-section-header">
        <h2 id="settings-profile-heading">Profile</h2>
        <p className="field-help">
          Changes save automatically as you leave each field.
        </p>
      </header>

      {passkeysEnabled ? (
        <section className="passkey-manager" aria-labelledby="settings-passkeys-heading">
          <header className="settings-section-header">
            <div className="passkey-heading">
              <KeyRound aria-hidden="true" size={22} strokeWidth={1.8} />
              <h2 id="settings-passkeys-heading">Passkeys</h2>
            </div>
            <div className="passkey-guidance field-help">
              <p>Use a fingerprint, face, PIN, or screen lock to sign in without a password.</p>
              <p>
                Your passkey is saved by your device or password manager and may sync to your other devices.
                Signing in from another device may show a QR code. GitHub remains your account-creation and recovery method.
              </p>
              <p>
                Adding, renaming, or removing a passkey requires a recent sign-in. Availability depends on your browser,
                device, screen lock, and password manager. <a href="https://www.passkeycentral.org/introduction-to-passkeys/" rel="noreferrer" target="_blank">Learn more about passkeys</a>.
              </p>
            </div>
          </header>

          <div className="passkey-create-row">
            <label className="sr-only" htmlFor="new-passkey-name">New passkey name</label>
            <input
              id="new-passkey-name"
              aria-label="New passkey name"
              autoComplete="off"
              maxLength={80}
              onChange={(event) => setNewPasskeyName(event.target.value)}
              placeholder="Passkey name, e.g. MacBook"
              type="text"
              value={newPasskeyName}
            />
            <button
              className="btn-ghost"
              disabled={passkeyBusy || !newPasskeyName.trim()}
              onClick={() => void runPasskeyMutation("add", async () => {
                await addBetterAuthPasskey(newPasskeyName.trim());
                setNewPasskeyName("");
              }, "Follow your device or password manager prompt to create the passkey.", "Passkey added.")}
              type="button"
            >
              Add passkey
            </button>
          </div>

          {passkeys.length ? (
            <ul className="passkey-list">
              {passkeys.map((passkey, index) => {
                const label = passkey.name?.trim() || "Unnamed passkey";
                const inputId = `passkey-name-${index}`;
                return (
                  <li className="passkey-row" key={passkey.id}>
                    <div className="passkey-row-copy">
                      <strong><KeyRound aria-hidden="true" size={16} strokeWidth={1.8} />{label}</strong>
                      {passkey.createdAt ? <span className="field-help">Added {formatDate(String(passkey.createdAt))}</span> : null}
                    </div>
                    <div className="passkey-row-actions">
                      <label className="sr-only" htmlFor={inputId}>Rename {label}</label>
                      <input
                        id={inputId}
                        aria-label={`Rename ${label}`}
                        autoComplete="off"
                        maxLength={80}
                        onChange={(event) => setPasskeyNames((current) => ({
                          ...current,
                          [passkey.id]: event.target.value,
                        }))}
                        type="text"
                        value={passkeyNames[passkey.id] ?? ""}
                      />
                      <button
                        aria-label={`Save ${label} name`}
                        className="btn-ghost"
                        disabled={passkeyBusy || !(passkeyNames[passkey.id] ?? "").trim()}
                        onClick={() => void runPasskeyMutation("rename", () => renameBetterAuthPasskey(
                          passkey.id,
                          (passkeyNames[passkey.id] ?? "").trim(),
                        ), "Renaming passkey…", "Passkey renamed.")}
                        type="button"
                      >
                        Save name
                      </button>
                      <button
                        aria-label={`Remove ${label}`}
                        className="btn-ghost btn-danger"
                        disabled={passkeyBusy}
                        onClick={() => void runPasskeyMutation(
                          "remove",
                          () => removeBetterAuthPasskey(passkey.id),
                          "Removing passkey…",
                          "Passkey removed.",
                        )}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="field-help">No passkeys registered.</p>
          )}
          <p aria-label="Passkey operation status" aria-live="polite" className="field-help passkey-operation-status" role="status">{passkeyStatus}</p>
          {passkeyError ? <p className="field-help field-help-error" role="alert">{passkeyError}</p> : null}
        </section>
      ) : null}

      <div className="settings-profile-grid">
        <div className="settings-profile-avatar">
          <AvatarDropZone name={displayName} avatarUrl={me.avatarUrl} onUpdated={(user) => applyUpdate(user, { avatarUrl: user.avatarUrl })} />
          <dl className="settings-profile-meta">
            <div>
              <dt>ID</dt>
              <dd>{me.id}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>
                {me.role ?? (me.isAdmin ? "admin" : me.isModerator ? "moderator" : "user")}
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {me.accountState === "revoked"
                  ? "Revoked"
                  : "Approved"}
              </dd>
            </div>
            {me.createdAt ? (
              <div>
                <dt>Member since</dt>
                <dd>{formatDate(me.createdAt)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="settings-profile-fields">
          <AutoSaveField
            id="profile-name"
            label="Name"
            value={me.username ?? ""}
            validate={(value) => (value.trim() ? null : "A name is required.")}
            onSave={(value) => saveField({ username: value.trim() })}
            inputProps={{ type: "text", autoComplete: "name", maxLength: 60 }}
          />

          <AutoSaveField
            id="profile-email"
            label="Email"
            value={me.email ?? ""}
            validate={(value) => {
              const trimmed = value.trim();
              if (!trimmed) return "A valid email is required.";
              if (!EMAIL_PATTERN.test(trimmed)) return "Enter a valid email address.";
              return null;
            }}
            onSave={(value) => saveField({ email: value.trim() })}
            inputProps={{ type: "email", autoComplete: "email" }}
          />

          <div className="autosave-field">
            <div className="autosave-field-label">
              <span>Email visibility</span>
              <AutoSaveIndicator
                state={emailPublicState}
                errorMessage={emailPublicError}
                fieldLabel="Email visibility"
              />
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={me.emailPublic ?? true}
                onChange={(event) => void saveEmailPublic(event.target.checked)}
              />
              <span>Visible to all users in profile popover (admins always see it)</span>
            </label>
          </div>

          <AutoSaveField
            as="textarea"
            id="profile-bio"
            label="Bio"
            value={me.bio ?? ""}
            onSave={(value) => saveField({ bio: value })}
            textareaProps={{ maxLength: 300, rows: 4, placeholder: "A short bio (up to 300 characters)." }}
            help={<>Up to 300 characters.</>}
          />
        </div>
      </div>



      {onSignOut ? (
        <div className="settings-section-footer">
          <button className="btn-ghost btn-danger" onClick={onSignOut} type="button">
            Sign out
          </button>
        </div>
      ) : null}
    </section>
  );
}
