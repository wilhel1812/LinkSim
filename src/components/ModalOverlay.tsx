import { useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalOverlayProps = {
  "aria-label": string;
  children: ReactNode;
  onClose?: () => void;
  tier?: "base" | "raised";
  className?: string;
  suspended?: boolean;
};

let openModalCount = 0;
const openModalStack: string[] = [];
let modalLayerSeed = 0;

export function ModalOverlay({ children, onClose, tier = "base", className, suspended = false, ...rest }: ModalOverlayProps) {
  const modalId = useId();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const layer = useMemo(() => {
    modalLayerSeed += 1;
    return modalLayerSeed;
  }, []);
  const zIndex = useMemo(() => {
    const base = tier === "raised" ? 8000 : 2000;
    return base + layer;
  }, [layer, tier]);

  const focusableElements = useCallback(() =>
    Array.from(modalRef.current?.querySelectorAll<HTMLElement>([
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "iframe:not([tabindex='-1'])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",")) ?? []).filter(
      (element) => !element.hasAttribute("hidden")
        && element.getAttribute("aria-hidden") !== "true"
        && !element.hasAttribute("data-modal-focus-sentinel"),
    ), []);

  useEffect(() => {
    if (suspended) return;
    openModalCount += 1;
    openModalStack.push(modalId);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (focusableElements()[0] ?? modalRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const top = openModalStack[openModalStack.length - 1];
      if (top !== modalId) return;
      if (event.key === "Tab") {
        const focusable = focusableElements();
        if (!focusable.length) {
          event.preventDefault();
          modalRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      if (!onCloseRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openModalCount = Math.max(0, openModalCount - 1);
      const idx = openModalStack.lastIndexOf(modalId);
      if (idx >= 0) openModalStack.splice(idx, 1);
      if (openModalCount === 0) {
        document.body.style.overflow = previousOverflow;
      }
      if (!suspendedRef.current) previousFocusRef.current?.focus();
    };
  }, [focusableElements, modalId, suspended]);

  return createPortal(
    <div
      aria-hidden={suspended || undefined}
      aria-modal={suspended ? undefined : "true"}
      className={["library-manager-overlay", className].filter(Boolean).join(" ")}
      ref={modalRef}
      onMouseDown={(event) => {
        if (suspended) return;
        if (!onCloseRef.current) return;
        if (event.target !== event.currentTarget) return;
        const top = openModalStack[openModalStack.length - 1];
        if (top !== modalId) return;
        onCloseRef.current();
      }}
      role={suspended ? undefined : "dialog"}
      style={{ zIndex }}
      tabIndex={-1}
      {...rest}
    >
      <span
        aria-hidden="true"
        data-modal-focus-sentinel="start"
        onFocus={() => {
          const focusable = focusableElements();
          (focusable[focusable.length - 1] ?? modalRef.current)?.focus();
        }}
        tabIndex={suspended ? -1 : 0}
      />
      {children}
      <span
        aria-hidden="true"
        data-modal-focus-sentinel="end"
        onFocus={() => (focusableElements()[0] ?? modalRef.current)?.focus()}
        tabIndex={suspended ? -1 : 0}
      />
    </div>,
    document.body,
  );
}
