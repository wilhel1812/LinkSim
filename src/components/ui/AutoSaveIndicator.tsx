import { Check, CircleAlert, Loader2 } from "lucide-react";

export type AutoSaveState = "idle" | "saving" | "saved" | "error";

type AutoSaveIndicatorProps = {
  state: AutoSaveState;
  errorMessage?: string | null;
  /** Optional label announced for screen readers alongside field status. */
  fieldLabel?: string;
  className?: string;
};

/**
 * Small, reusable save-status chip for auto-saving form fields.
 * Visually shows idle (invisible), saving (spinner), saved (check), or error (icon + text).
 * Announces status changes via an `aria-live="polite"` region.
 * Intentionally decoupled from the Settings panel so future forms can reuse it.
 */
export function AutoSaveIndicator({ state, errorMessage, fieldLabel, className }: AutoSaveIndicatorProps) {
  const classes = ["autosave-indicator", `autosave-indicator-${state}`];
  if (className) classes.push(className);

  const liveMessage = (() => {
    if (state === "saving") return fieldLabel ? `Saving ${fieldLabel}…` : "Saving…";
    if (state === "saved") return fieldLabel ? `${fieldLabel} saved` : "Saved";
    if (state === "error") return errorMessage ?? "Save failed";
    return "";
  })();

  return (
    <span className={classes.join(" ")}>
      <span className="autosave-indicator-visual" aria-hidden="true">
        {state === "saving" ? <Loader2 className="autosave-spin" size={14} strokeWidth={2} /> : null}
        {state === "saved" ? <Check size={14} strokeWidth={2.5} /> : null}
        {state === "error" ? <CircleAlert size={14} strokeWidth={2} /> : null}
      </span>
      {state === "error" && errorMessage ? (
        <span className="autosave-indicator-text">{errorMessage}</span>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </span>
  );
}
