import { useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalOverlayProps = {
  "aria-label": string;
  children: ReactNode;
};

let modalStackCounter = 0;
let openModalCount = 0;

const nextModalZIndex = (): number => {
  modalStackCounter += 1;
  return 2000 + modalStackCounter * 10;
};

export function ModalOverlay({ children, ...rest }: ModalOverlayProps) {
  const zIndex = useMemo(() => nextModalZIndex(), []);

  useEffect(() => {
    openModalCount += 1;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, []);

  return createPortal(
    <div aria-modal="true" className="library-manager-overlay" role="dialog" style={{ zIndex }} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
