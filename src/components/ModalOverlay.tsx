import { useEffect, useId, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalOverlayProps = {
  "aria-label": string;
  children: ReactNode;
  onClose?: () => void;
  tier?: "base" | "raised";
};

let openModalCount = 0;
const openModalStack: string[] = [];
let modalLayerSeed = 0;

export function ModalOverlay({ children, onClose, tier = "base", ...rest }: ModalOverlayProps) {
  const modalId = useId();
  const layer = useMemo(() => {
    modalLayerSeed += 1;
    return modalLayerSeed;
  }, []);
  const zIndex = useMemo(() => {
    const base = tier === "raised" ? 8000 : 2000;
    return base + layer;
  }, [layer, tier]);

  useEffect(() => {
    openModalCount += 1;
    openModalStack.push(modalId);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const top = openModalStack[openModalStack.length - 1];
      if (top !== modalId) return;
      if (!onClose) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
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
    };
  }, [modalId, onClose]);

  return createPortal(
    <div
      aria-modal="true"
      className="library-manager-overlay"
      onMouseDown={(event) => {
        if (!onClose) return;
        if (event.target !== event.currentTarget) return;
        const top = openModalStack[openModalStack.length - 1];
        if (top !== modalId) return;
        onClose();
      }}
      role="dialog"
      style={{ zIndex }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
