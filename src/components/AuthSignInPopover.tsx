import { useCallback, useEffect, useRef, type RefObject } from "react";
import { KeyRound } from "lucide-react";
import { siGithub } from "simple-icons";
import { FloatingPopover } from "./ui/FloatingPopover";

export type AuthSignInMethod = "github" | "passkey";

type AuthSignInPopoverProps = {
  busyMethod: AuthSignInMethod | null;
  onClose: () => void;
  onGithub: (challengeContainer: HTMLElement) => void;
  onPasskey: () => void;
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
};

export function AuthSignInPopover({
  busyMethod,
  onClose,
  onGithub,
  onPasskey,
  open,
  triggerRef,
}: AuthSignInPopoverProps) {
  const focusContent = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    window.setTimeout(() => {
      if (node.isConnected) node.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!busyMethod) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busyMethod, onClose, open]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    return () => {
      window.setTimeout(() => trigger?.focus(), 0);
    };
  }, [open, triggerRef]);

  const busy = busyMethod !== null;
  const challengeRef = useRef<HTMLDivElement | null>(null);

  return (
    <FloatingPopover
      className="auth-sign-in-popover"
      estimatedHeight={280}
      estimatedWidth={328}
      onClose={busy ? () => undefined : onClose}
      open={open}
      pointerTail
      tier="raised"
      triggerRef={triggerRef}
    >
      <div aria-busy={busyMethod === "github" || undefined} aria-label="Sign in or sign up" className="auth-sign-in-popover-content" ref={focusContent} role="dialog">
        <ul className="ui-settings-popover-list">
          <li className="ui-settings-popover-row">
            <button
              aria-label={busyMethod === "github" ? "Opening GitHub…" : "GitHub"}
              className="ui-settings-row-toggle auth-sign-in-option"
              disabled={busy}
              onClick={() => {
                if (challengeRef.current) onGithub(challengeRef.current);
              }}
              type="button"
            >
              <span className="ui-settings-toggle-label">
                {busyMethod === "github" ? "Opening GitHub…" : "GitHub"}
              </span>
              <span className="ui-settings-toggle-icon">
                <svg aria-hidden="true" height="18" viewBox="0 0 24 24" width="18">
                  <path d={siGithub.path} fill="currentColor" />
                </svg>
              </span>
            </button>
          </li>
          <li className={`ui-settings-popover-row auth-sign-in-challenge-row ${busyMethod === "github" ? "is-active" : ""}`.trim()}>
            <div className="auth-sign-in-challenge" ref={challengeRef} aria-label="Anti-bot check" />
          </li>
          <li className="ui-settings-popover-row">
            <button
              aria-label={busyMethod === "passkey" ? "Using passkey…" : "Passkey"}
              className="ui-settings-row-toggle auth-sign-in-option"
              disabled={busy}
              onClick={onPasskey}
              type="button"
            >
              <span className="ui-settings-toggle-label">
                {busyMethod === "passkey" ? "Using passkey…" : "Passkey"}
              </span>
              <span className="ui-settings-toggle-icon">
                <KeyRound aria-hidden="true" size={18} strokeWidth={1.8} />
              </span>
            </button>
          </li>
          <li
            aria-live={busyMethod === "passkey" ? "polite" : undefined}
            className="ui-settings-popover-row auth-sign-in-note"
            role={busyMethod === "passkey" ? "status" : undefined}
          >
            {busyMethod === "passkey"
              ? "Follow your browser or device prompt to use your passkey."
              : "New accounts start with GitHub. Passkey works after you add one in Settings."}
          </li>
        </ul>
      </div>
    </FloatingPopover>
  );
}
