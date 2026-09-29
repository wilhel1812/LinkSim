import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";

type AppNotificationTone = "info" | "warning" | "error" | "success";

type AppNotificationItemProps = {
  children: ReactNode;
  dismissKind?: "manual" | "auto";
  onDismiss?: () => void;
  onPauseChange?: (isPaused: boolean) => void;
  static?: boolean;
  tone: AppNotificationTone;
};

export function AppNotificationItem({
  children,
  dismissKind,
  onDismiss,
  onPauseChange,
  static: isStatic = false,
  tone,
}: AppNotificationItemProps) {
  const copyRef = useRef<HTMLSpanElement>(null);
  const [isWrapped, setIsWrapped] = useState(false);

  useLayoutEffect(() => {
    const copy = copyRef.current;
    if (!copy) return;

    const measure = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(copy).lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        setIsWrapped(false);
        return;
      }
      const nextIsWrapped = copy.scrollHeight > lineHeight + 1;
      setIsWrapped((current) => (current === nextIsWrapped ? current : nextIsWrapped));
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(copy);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);

  const role = tone === "error" ? "alert" : "status";

  return (
    <div
      aria-atomic="true"
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={[
        "app-notification-item",
        `app-notification-item-${tone}`,
        isStatic ? "app-notification-item-static" : "",
        isWrapped ? "app-notification-item-wrapped" : "",
        dismissKind ? "is-dismissing" : "",
      ].filter(Boolean).join(" ")}
      data-dismiss-kind={dismissKind}
      onBlurCapture={onPauseChange ? () => onPauseChange(false) : undefined}
      onFocusCapture={onPauseChange ? () => onPauseChange(true) : undefined}
      onMouseEnter={onPauseChange ? () => onPauseChange(true) : undefined}
      onMouseLeave={onPauseChange ? () => onPauseChange(false) : undefined}
      role={role}
    >
      <span className="app-notification-glyph" aria-hidden="true">
        {tone === "warning" ? <CircleAlert size={14} strokeWidth={2} /> : null}
        {tone === "error" ? <CircleX size={14} strokeWidth={2} /> : null}
        {tone === "success" ? <CircleCheck size={14} strokeWidth={2} /> : null}
        {tone === "info" ? <Info size={14} strokeWidth={2} /> : null}
      </span>
      <div className="app-notification-copy">
        <span ref={copyRef}>{children}</span>
      </div>
      {onDismiss ? (
        <button
          aria-label="Dismiss notification"
          className="app-notification-dismiss"
          onClick={onDismiss}
          title="Dismiss"
          type="button"
        >
          <X aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
