import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Surface } from "./Surface";
import type { CSSProperties, ReactNode } from "react";

type FloatingPopoverPlacement = "trigger" | "centered";

type FloatingPopoverPosition = {
  left: number;
  top: number;
  direction: "up" | "down";
};

const POPOVER_VIEWPORT_MARGIN = 8;

const clampHorizontalAnchor = (anchor: number, estimatedWidth: number): number => {
  const viewportMargin = Math.min(POPOVER_VIEWPORT_MARGIN, window.innerWidth / 2);
  const availableWidth = Math.max(window.innerWidth - viewportMargin * 2, 0);
  const effectiveWidth = Math.min(estimatedWidth, availableWidth);
  const halfWidth = effectiveWidth / 2;

  return Math.min(
    Math.max(anchor, halfWidth + viewportMargin),
    window.innerWidth - halfWidth - viewportMargin,
  );
};

type FloatingPopoverProps = {
  open: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  containerRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  placement?: FloatingPopoverPlacement;
  className?: string;
  style?: CSSProperties;
  estimatedHeight?: number;
  estimatedWidth?: number;
  pointerTail?: boolean;
  pointerTone?: "accent" | "selection" | "temporary";
};

export function FloatingPopover({
  open,
  onClose,
  triggerRef,
  containerRef,
  children,
  placement = "trigger",
  className,
  style,
  estimatedHeight = 200,
  estimatedWidth = 360,
  pointerTail = false,
  pointerTone = "accent",
}: FloatingPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<FloatingPopoverPosition | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      if (placement === "centered") {
        const container = containerRef?.current;
        if (!container) {
          setPosition(null);
          return;
        }
        const rect = container.getBoundingClientRect();
        const containerWidth = rect.width;
        const containerLeft = rect.left;
        const containerTop = rect.top;
        const left = clampHorizontalAnchor(containerLeft + containerWidth / 2, estimatedWidth);
        const spaceAbove = containerTop;
        const spaceBelow = window.innerHeight - rect.bottom;
        const direction: "up" | "down" =
          spaceAbove >= estimatedHeight + 12 || spaceAbove >= spaceBelow ? "up" : "down";
        const top = direction === "up" ? containerTop - 12 : rect.bottom + 12;
        setPosition({ left, top, direction });
        return;
      }

      const trigger = triggerRef?.current;
      if (!trigger) {
        setPosition(null);
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const direction: "up" | "down" =
        spaceAbove >= estimatedHeight + 12 || spaceAbove >= spaceBelow ? "up" : "down";
      const left = clampHorizontalAnchor(rect.left + rect.width / 2, estimatedWidth);
      setPosition({
        left,
        top: direction === "up" ? rect.top - 8 : rect.bottom + 8,
        direction,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, placement, triggerRef, containerRef, estimatedHeight, estimatedWidth]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef?.current;
    const container = containerRef?.current;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if (trigger?.contains(target)) return;
      if (container?.contains(target)) return;
      onClose();
    };
    const onFocusIn = (event: Event) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if (trigger?.contains(target)) return;
      if (container?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, onClose, triggerRef, containerRef]);

  if (!open || !position) return null;

  return createPortal(
    <Surface
      ref={popoverRef}
      variant="card"
      className={`ui-action-popover ${className ?? ""} ${position.direction === "down" ? "is-down" : ""}`}
      pointerTail={pointerTail}
      pointerTone={pointerTone}
      style={{
        left: position.left,
        top: position.top,
        ...style,
      }}
    >
      {children}
    </Surface>,
    document.body,
  );
}
