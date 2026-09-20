import { useCallback, useEffect, type RefObject } from "react";
import { ActionButton } from "./ActionButton";
import { FloatingPopover } from "./ui/FloatingPopover";

export type AuthSignInMethod = "github" | "passkey";

type AuthSignInPopoverProps = {
  busyMethod: AuthSignInMethod | null;
  onClose: () => void;
  onGithub: () => void;
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

  return (
    <FloatingPopover
      className="auth-sign-in-popover"
      estimatedHeight={260}
      estimatedWidth={360}
      onClose={busy ? () => undefined : onClose}
      open={open}
      pointerTail
      tier="raised"
      triggerRef={triggerRef}
    >
      <div aria-busy={busy || undefined} aria-label="Sign in or sign up" className="auth-sign-in-popover-content" ref={focusContent} role="dialog">
        <div>
          <h2>Sign in or sign up</h2>
          <p className="field-help">Use GitHub to create an account or recover access.</p>
        </div>
        <ActionButton disabled={busy} onClick={onGithub} type="button">
          {busyMethod === "github" ? "Opening GitHub…" : "Continue with GitHub"}
        </ActionButton>
        <div>
          <p className="field-help">Use a passkey only if you added one previously.</p>
          <ActionButton disabled={busy} onClick={onPasskey} type="button" variant="ghost">
            {busyMethod === "passkey" ? "Using passkey…" : "Use a passkey"}
          </ActionButton>
        </div>
        <ActionButton disabled={busy} onClick={onClose} type="button" variant="ghost">
          Cancel
        </ActionButton>
      </div>
    </FloatingPopover>
  );
}
