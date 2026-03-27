import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export function InfoTip({ text }: { text: string }) {
  const tipId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const boxWidth = boxRef.current?.offsetWidth ?? 240;
    const boxHeight = boxRef.current?.offsetHeight ?? 80;
    const openUpward = rect.bottom + gap + boxHeight > window.innerHeight - 8 && rect.top - gap - boxHeight >= 8;
    const top = openUpward ? rect.top - gap - boxHeight : rect.bottom + gap;
    const left = Math.min(Math.max(8, rect.right - boxWidth), Math.max(8, window.innerWidth - boxWidth - 8));
    setPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onRelayout = () => updatePosition();
    window.addEventListener("resize", onRelayout);
    window.addEventListener("scroll", onRelayout, true);
    return () => {
      window.removeEventListener("resize", onRelayout);
      window.removeEventListener("scroll", onRelayout, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        aria-describedby={open ? tipId : undefined}
        aria-label={text}
        className="info-tip"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        ref={triggerRef}
        type="button"
      >
        <Info aria-hidden="true" strokeWidth={1.9} />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              className="info-tip-box is-open"
              id={tipId}
              ref={boxRef}
              role="tooltip"
              style={{ top: `${position.top}px`, left: `${position.left}px` }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
