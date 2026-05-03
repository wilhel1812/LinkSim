import { useCallback, useEffect, useState } from "react";
import { fetchMe, updateMyProfile, type CloudUser } from "../../../lib/cloudUser";
import { getUiErrorMessage } from "../../../lib/uiError";
import { useAppStore } from "../../../store/appStore";
import { formatDate } from "../../../lib/locale";
import { AutoSaveField } from "../AutoSaveField";
import { AvatarDropZone } from "../AvatarDropZone";
import { AutoSaveIndicator, type AutoSaveState } from "../../ui/AutoSaveIndicator";

type ProfileSectionProps = {
  me: CloudUser | null;
  onMeUpdated: (user: CloudUser) => void;
  onSignOut?: () => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProfileSection({ me, onMeUpdated, onSignOut }: ProfileSectionProps) {
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setAuthState = useAppStore((state) => state.setAuthState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emailPublicState, setEmailPublicState] = useState<AutoSaveState>("idle");
  const [emailPublicError, setEmailPublicError] = useState<string | null>(null);

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
    (user: CloudUser) => {
      onMeUpdated(user);
      setCurrentUser(user);
      setAuthState("signed_in");
    },
    [onMeUpdated, setAuthState, setCurrentUser],
  );

  const saveField = useCallback(
    async (patch: Parameters<typeof updateMyProfile>[0]) => {
      const updated = await updateMyProfile(patch);
      applyUpdate(updated);
    },
    [applyUpdate],
  );

  const saveEmailPublic = useCallback(
    async (nextValue: boolean) => {
      setEmailPublicState("saving");
      setEmailPublicError(null);
      try {
        const updated = await updateMyProfile({ emailPublic: nextValue });
        applyUpdate(updated);
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

      <div className="settings-profile-grid">
        <div className="settings-profile-avatar">
          <AvatarDropZone name={displayName} avatarUrl={me.avatarUrl} onUpdated={applyUpdate} />
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
