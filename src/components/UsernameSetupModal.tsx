import { useState } from "react";
import { updateMyProfile, type CloudUser } from "../lib/cloudUser";
import { getUiErrorMessage } from "../lib/uiError";
import { ActionButton } from "./ActionButton";
import { ModalOverlay } from "./ModalOverlay";

type UsernameSetupModalProps = {
  onComplete: (user: CloudUser) => void;
};

export function UsernameSetupModal({ onComplete }: UsernameSetupModalProps) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = username.trim();

  const save = async () => {
    if (!trimmed) {
      setError("Enter a username to continue.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const user = await updateMyProfile({ username: trimmed });
      onComplete(user);
    } catch (saveError) {
      setError(getUiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay aria-label="Choose username" onClose={() => {}} tier="raised">
      <div className="library-manager-card">
        <div className="library-manager-header">
          <h2>Choose your username</h2>
        </div>
        <p className="field-help">
          This name appears on your simulations and shared links. Use your real name or a pseudonym.
        </p>
        <label className="field-grid user-field-grid" htmlFor="username-setup-input">
          <span>Username</span>
          <input
            autoComplete="nickname"
            autoFocus
            id="username-setup-input"
            maxLength={60}
            onChange={(event) => {
              setUsername(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            type="text"
            value={username}
          />
        </label>
        {error ? <p className="field-help field-help-error">{error}</p> : null}
        <div className="chip-group">
          <ActionButton disabled={saving || !trimmed} onClick={() => void save()} type="button">
            {saving ? "Saving..." : "Continue"}
          </ActionButton>
        </div>
      </div>
    </ModalOverlay>
  );
}
