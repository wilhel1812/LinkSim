import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { ModalOverlay } from "./ModalOverlay";

export type LegacyMigrationStage = "opening-cloudflare" | "github" | "passkey" | "finishing" | "failed";

type LegacyMigrationModalProps = {
  autoStartGithub: boolean;
  error: string | null;
  existingProfileUsername: string | null;
  githubBusy: boolean;
  passkeyBusy?: boolean;
  passkeyRecovery?: boolean;
  onAutoGithub: (challengeContainer: HTMLElement) => void;
  onContinueExistingProfile: () => void;
  onGithub: (challengeContainer: HTMLElement) => void;
  onPasskey?: () => void;
  onRestart: () => void;
  stage: LegacyMigrationStage;
};

const statusFor = (
  step: "cloudflare" | "github" | "linksim",
  stage: LegacyMigrationStage,
  hasError: boolean,
  methodBusy: boolean,
): string => {
  if (step === "cloudflare") return stage === "opening-cloudflare" ? "Opening…" : "Confirmed";
  if (step === "github") {
    if (stage === "opening-cloudflare") return "Waiting";
    if (stage === "github" || stage === "passkey") return hasError ? "Needs attention" : methodBusy ? "In progress" : "Ready";
    return "Confirmed";
  }
  if (stage === "finishing") return "Connecting…";
  if (stage === "failed") return "Needs attention";
  return "Waiting";
};

export function LegacyMigrationModal({
  autoStartGithub,
  error,
  existingProfileUsername,
  githubBusy,
  passkeyBusy = false,
  passkeyRecovery = false,
  onAutoGithub,
  onContinueExistingProfile,
  onGithub,
  onPasskey,
  onRestart,
  stage,
}: LegacyMigrationModalProps) {
  const [challengeContainer, setChallengeContainer] = useState<HTMLDivElement | null>(null);
  const autoStartRequestedRef = useRef(false);
  const methodBusy = passkeyRecovery ? passkeyBusy : githubBusy;

  useEffect(() => {
    if (!autoStartGithub || stage !== "github" || error || !challengeContainer || autoStartRequestedRef.current) return;
    autoStartRequestedRef.current = true;
    onAutoGithub(challengeContainer);
  }, [autoStartGithub, challengeContainer, error, onAutoGithub, stage]);

  return (
    <ModalOverlay aria-label="Move your LinkSim account" tier="raised">
      <div className="library-manager-card legacy-migration-card">
        <div className="library-manager-header">
          <h2>Move your LinkSim account</h2>
        </div>
        <p className="field-help">
          {passkeyRecovery
            ? "Keep this window open while LinkSim confirms the authorized administrator account, creates its passkey, and preserves its existing profile and saved work."
            : "Keep this window open while LinkSim confirms your previous Cloudflare account, connects GitHub, and preserves your existing profile and saved work."}
        </p>
        <ol aria-label="Migration progress" className="legacy-migration-progress">
          <li>
            <span><span aria-hidden="true">1. </span>Cloudflare account</span>
            <strong>{statusFor("cloudflare", stage, Boolean(error), methodBusy)}</strong>
          </li>
          <li>
            <span><span aria-hidden="true">2. </span>{passkeyRecovery ? "Passkey" : "GitHub"}</span>
            <strong>{statusFor("github", stage, Boolean(error), methodBusy)}</strong>
          </li>
          <li>
            <span><span aria-hidden="true">3. </span>LinkSim account</span>
            <strong>{statusFor("linksim", stage, Boolean(error), methodBusy)}</strong>
          </li>
        </ol>
        <div
          aria-label="Anti-bot check"
          className={`auth-sign-in-challenge legacy-migration-challenge ${githubBusy ? "is-active" : ""}`.trim()}
          ref={setChallengeContainer}
        />
        {error ? <p className="field-help field-help-error" role="alert">{error}</p> : null}
        {stage === "opening-cloudflare" ? (
          <>
            <p aria-live="polite" className="field-help" role="status">Opening Cloudflare sign-in…</p>
            <div className="chip-group">
              <ActionButton onClick={onRestart} type="button">Open Cloudflare sign-in again</ActionButton>
            </div>
          </>
        ) : null}
        {stage === "github" ? (
          <div className="chip-group">
            <ActionButton
              disabled={githubBusy}
              onClick={() => {
                if (challengeContainer) onGithub(challengeContainer);
              }}
              type="button"
            >
              {githubBusy ? "Connecting GitHub…" : error ? "Try GitHub again" : "Continue with GitHub"}
            </ActionButton>
          </div>
        ) : null}
        {stage === "passkey" ? (
          <div className="chip-group">
            <ActionButton disabled={passkeyBusy} onClick={onPasskey} type="button">
              {passkeyBusy ? "Creating passkey…" : error ? "Try passkey again" : "Create administrator passkey"}
            </ActionButton>
          </div>
        ) : null}
        {stage === "finishing" ? (
          <p aria-live="polite" className="field-help" role="status">
            {passkeyRecovery
              ? "Connecting the passkey to your existing administrator account…"
              : "Connecting GitHub to your existing LinkSim account…"}
          </p>
        ) : null}
        {stage === "failed" ? (
          <div className="chip-group">
            {existingProfileUsername !== null ? (
              <ActionButton onClick={onContinueExistingProfile} type="button">
                {existingProfileUsername ? `Continue as ${existingProfileUsername}` : "Continue with this account"}
              </ActionButton>
            ) : null}
            <ActionButton onClick={onRestart} type="button">Start migration again</ActionButton>
          </div>
        ) : null}
      </div>
    </ModalOverlay>
  );
}
